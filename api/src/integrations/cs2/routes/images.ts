/**
 * Map and skin pictures, served by the platform itself (no CDN on the page).
 *
 *   GET /api/game/cs2/img/maps-1280/:file   map screenshots (headers, veto)
 *   GET /api/game/cs2/img/maps-480/:file    map cards and lists
 *   GET /api/game/cs2/img/map-icons/:file   map icons (SVG)
 *   GET /api/game/cs2/img/skins-256/:file   skin cards and inventories
 *   GET /api/game/cs2/img/skins/:file       skins at full size (inspect), wear looks too
 *
 * Where a picture comes from, first hit wins:
 *   1. the module's own `assets/` folder: csm's `web_assets/`, compressed and bundled by
 *      scripts/modules/cs2/build.ts (maps and 256 px skins);
 *   2. the disk cache, DATA_DIR/cache/cs2-images;
 *   3. csm's repository through jsDelivr, once, kept in the cache (never with CATALOG_OFFLINE;
 *      a miss is not asked for again for 10 minutes). A size csm has not made yet
 *      (a map or skin newer than the module) falls back to the extracted original.
 *
 * Full-size skins are not bundled (csm's skin_images/ is about 100 MB): `prefetchSkinImages`
 * fills the cache in the background at start, unless CS2_IMAGE_PREFETCH=off.
 */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { DATA_DIR } from '../../../config/dataDir';
import { log } from '../../../utils/logger';

const router = Router();

const CDN = 'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master';
const RAW = 'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master';
const CACHE_DIR = path.join(DATA_DIR, 'cache', 'cs2-images');
const FILE = /^[A-Za-z0-9_.-]{1,160}\.(webp|png|svg)$/;
const FETCH_TIMEOUT_MS = 4_000;
/** A picture csm does not have (or that could not be fetched) is not asked for again this long. */
const MISS_TTL_MS = 10 * 60 * 1000;
const misses = new Map<string, number>();

/** No network for pictures: the catalogue's offline switch (CI, air-gapped installs). */
function offline(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.CATALOG_OFFLINE || '').trim().toLowerCase());
}

/** A set: its folder in csm's repository, and where to look when that size is missing. */
const SETS: Record<string, { dir: string; original?: string }> = {
  'maps-1280': { dir: 'web_assets/maps/1280', original: 'map_thumbnails' },
  'maps-480': { dir: 'web_assets/maps/480', original: 'map_thumbnails' },
  'map-icons': { dir: 'web_assets/maps/icons', original: 'map_thumbnails' },
  'skins-256': { dir: 'web_assets/skins/256', original: 'skin_images' },
  skins: { dir: 'skin_images' },
};

/**
 * The module's bundled pictures: `<module>/assets/` next to `<module>/server/index.mjs`. Running
 * from the source tree (dev, tests) there is none, and every picture comes through the cache.
 */
const BUNDLED_DIR = path.resolve(__dirname, '..', 'assets');

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  svg: 'image/svg+xml',
};

function contentType(file: string): string {
  return TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}

function existing(file: string): string | null {
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function download(repoPath: string): Promise<Buffer | null> {
  if (offline()) return null;
  const missed = misses.get(repoPath);
  if (missed && missed > Date.now()) return null;
  const data = await fetchFirst(repoPath);
  if (!data) misses.set(repoPath, Date.now() + MISS_TTL_MS);
  return data;
}

async function fetchFirst(repoPath: string): Promise<Buffer | null> {
  for (const base of [CDN, RAW]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/${repoPath}`, { signal: controller.signal });
      if (res.status === 404) return null;
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // the next base, then give up
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Downloads one of csm's files into the cache (once at a time per file). */
const inFlight = new Map<string, Promise<string | null>>();
function cacheFrom(repoPath: string): Promise<string | null> {
  const target = path.join(CACHE_DIR, repoPath);
  const hit = existing(target);
  if (hit) return Promise.resolve(hit);
  let job = inFlight.get(repoPath);
  if (!job) {
    job = (async () => {
      const data = await download(repoPath);
      if (!data) return null;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, target);
      return target;
    })()
      .catch((error: unknown) => {
        log.warn(`[CS2 images] ${repoPath}: ${(error as Error).message}`);
        return null;
      })
      .finally(() => inFlight.delete(repoPath));
    inFlight.set(repoPath, job);
  }
  return job;
}

/** The file on disk for a picture, fetching it into the cache when needed. */
async function resolvePicture(set: string, file: string): Promise<string | null> {
  const spec = SETS[set];
  if (!spec) return null;
  const bundled = existing(path.join(BUNDLED_DIR, spec.dir.replace(/^web_assets\//, ''), file));
  if (bundled) return bundled;
  const cached = await cacheFrom(`${spec.dir}/${file}`);
  if (cached) return cached;
  return spec.original ? cacheFrom(`${spec.original}/${file}`) : null;
}

/**
 * @openapi
 * /api/game/cs2/img/{set}/{file}:
 *   get:
 *     tags: [CS2]
 *     summary: A map or skin picture (public)
 *     description: >-
 *       set is maps-1280, maps-480, map-icons, skins-256 or skins. Served from the CS2
 *       module's bundled pictures, else a disk cache filled from cs2-server-manager once.
 *     parameters:
 *       - { in: path, name: set, required: true, schema: { type: string } }
 *       - { in: path, name: file, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The picture (WebP, PNG or SVG) }
 *       404: { description: No such set or picture }
 */
router.get('/img/:set/:file', async (req: Request, res: Response) => {
  const { set, file } = req.params;
  if (!SETS[set] || !FILE.test(file) || file.includes('..')) {
    return res.status(404).end();
  }
  const found = await resolvePicture(set, file);
  if (!found) return res.status(404).end();
  res.setHeader('Content-Type', contentType(file));
  // Pictures change only with a CS2 update; a day is short enough to pick that up.
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  return res.sendFile(found);
});

/**
 * Fills the cache with every full-size skin picture (and its wear looks) in the background, a few
 * at a time, so the inspect view never waits on the internet. Files already cached are skipped.
 */
export async function prefetchSkinImages(files: string[]): Promise<void> {
  if ((process.env.CS2_IMAGE_PREFETCH ?? '').toLowerCase() === 'off') return;
  const todo = [...new Set(files)].filter(
    (f) => FILE.test(f) && !existing(path.join(CACHE_DIR, 'skin_images', f))
  );
  if (todo.length === 0) return;
  log.info(`[CS2 images] fetching ${todo.length} skin picture(s) into the cache`);
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < todo.length) {
      const file = todo[next++];
      if (!(await cacheFrom(`skin_images/${file}`))) failed++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  log.info(`[CS2 images] skin pictures cached (${todo.length - failed} new, ${failed} failed)`);
}

export default router;
