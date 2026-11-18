/**
 * Map and skin pictures, served by the platform itself (no CDN on the page).
 *
 *   GET /api/game/cs2/img/maps-1280/:file   map screenshots (headers, veto)
 *   GET /api/game/cs2/img/maps-480/:file    map cards and lists
 *   GET /api/game/cs2/img/map-icons/:file   map icons (SVG)
 *   GET /api/game/cs2/img/skins-256/:file   skin cards and inventories
 *   GET /api/game/cs2/img/skins/:file       skins at full size (inspect), wear looks too
 *
 * They are Valve's, so neither the platform nor csm ships them: a connected csm host reads
 * each from its own CS2 install the first time it is asked for (fleet/hosts/assets.ts), and
 * the platform keeps it in DATA_DIR/cache/cs2-pictures. With no host, a picture is a 404.
 */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { DATA_DIR } from '../../../config/dataDir';
import { log } from '../../../utils/logger';
import { fetchHostAsset } from '../fleet/hosts/assets';
import type { HostAssetSet } from '../fleet/protocol/host/v1';

const router = Router();

const CACHE_DIR = path.join(DATA_DIR, 'cache', 'cs2-pictures');
const SETS = new Set<HostAssetSet>(['maps-1280', 'maps-480', 'map-icons', 'skins-256', 'skins']);
const FILE = /^[a-z0-9_-]{1,150}\.(webp|png|svg)$/;
/** A picture no host had (or with no host connected) is not asked for again this long. */
const MISS_TTL_MS = 10 * 60 * 1000;
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

/** What a cached file is, from its first bytes: the name keeps the .webp the pages ask for. */
function sniff(head: Buffer): string {
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/svg+xml';
}

function cached(target: string): string | null {
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/** The file on disk for a picture, asking a csm host for it once when needed. */
function resolvePicture(set: HostAssetSet, file: string): Promise<string | null> {
  const key = `${set}/${file}`;
  const target = path.join(CACHE_DIR, set, file);
  const hit = cached(target);
  if (hit) return Promise.resolve(hit);
  if ((misses.get(key) ?? 0) > Date.now()) return Promise.resolve(null);
  let job = inFlight.get(key);
  if (!job) {
    job = (async () => {
      const asset = await fetchHostAsset(set, file);
      if (!asset) {
        misses.set(key, Date.now() + MISS_TTL_MS);
        return null;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, asset.data);
      fs.renameSync(tmp, target);
      return target;
    })()
      .catch((error: unknown) => {
        log.warn(`[CS2 images] ${key}: ${(error as Error).message}`);
        return null;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  return job;
}

/**
 * @openapi
 * /api/game/cs2/img/{set}/{file}:
 *   get:
 *     tags: [CS2]
 *     summary: A map or skin picture (public)
 *     description: >-
 *       set is maps-1280, maps-480, map-icons, skins-256 or skins. Read from a connected
 *       csm host's CS2 install the first time, then from the platform's disk cache.
 *     parameters:
 *       - { in: path, name: set, required: true, schema: { type: string } }
 *       - { in: path, name: file, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The picture (JPEG, PNG or SVG) }
 *       404: { description: No such set or picture, or no csm host to read it from }
 */
router.get('/img/:set/:file', async (req: Request, res: Response) => {
  const set = req.params.set as HostAssetSet;
  const file = req.params.file;
  if (!SETS.has(set) || !FILE.test(file)) return res.status(404).end();
  const found = await resolvePicture(set, file);
  if (!found) return res.status(404).end();
  const head = Buffer.alloc(4);
  const fd = fs.openSync(found, 'r');
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  res.setHeader('Content-Type', sniff(head));
  // Pictures change only with a CS2 update; a day is short enough to pick that up.
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  return res.sendFile(found);
});

export default router;
