/**
 * App icons for games no module or pack ships one for.
 *
 * A game pill draws the game's own square app icon. Modules and packs carry
 * theirs, and `gameCatalogService.linkBuiltin` finds them for any stored
 * game that is one of those games. Everything else a player can pick — any
 * game a Wikidata search finds — gets its **Steam client icon** here, when
 * the game is on Steam, with no key and no account:
 *
 *   Steam app id (Wikidata P1733)
 *     → `https://api.steamcmd.net/v1/info/<appid>` → `common.clienticon`
 *     → `https://shared.fastly.steamstatic.com/community_assets/images/apps/<appid>/<hash>.ico`
 *       (the older `cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/…`
 *       path is tried second: it 404s for newer games such as Battlefield 6)
 *     → the largest frame, scaled to 128 px, stored as PNG under
 *       `DATA_DIR/game-icons/<content hash>.png` and served from
 *       `/api/games/icons/<file>` with a year-long cache.
 *
 * The file name is the hash of its bytes, so a URL never changes meaning and
 * can be cached forever; the row records it (`games.icon_url`,
 * `icon_source = 'steam'`).
 *
 * A game with no Steam app id, or whose Steam icon is missing or too small,
 * keeps `icon_url` null and its pill draws the game's monogram. Never a
 * cover: a cropped box art is not the picture a player knows the game by.
 *
 * All of it runs in the background — after a search, after a player saves
 * their games, at startup — rate-limited, one pass at a time, with short
 * timeouts. A request never waits on it; a failure is logged and the row is
 * retried after `RECHECK_MS`.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { DATA_DIR } from '../config/dataDir';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { toGameIconPng } from '../utils/iconImage';
import { buildGameLinks, linkBuiltin } from './gameCatalogService';
import { enrichmentDisabled } from './gameEnrichmentService';
import { getWikidataSteamAppIds } from './wikidataService';

/** Where fetched icons are kept: the data volume, so they survive an upgrade. */
export const GAME_ICON_DIR = path.join(DATA_DIR, 'game-icons');
/** The URL prefix `routes/games.ts` serves `GAME_ICON_DIR` on. */
export const GAME_ICON_URL_PREFIX = '/api/games/icons/';
/** A cached icon's file name: 16 hex characters of its SHA-256, then `.png`. */
export const GAME_ICON_FILE_RE = /^[a-f0-9]{16}\.png$/;

/** Rows looked at per pass; the rest wait for the next one. */
const PASS_BATCH = 40;
/** Between two rows' requests. Steam's CDN is generous; steamcmd.net is one person's service. */
const REQUEST_GAP_MS = 1000;
const REQUEST_TIMEOUT_MS = 6000;
/** A Steam `.ico` with a 512 px frame is a few hundred KB. */
const MAX_ICON_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_INFO_BYTES = 2 * 1024 * 1024;
/** Look again at a row that found nothing after this long. */
const RECHECK_MS = 14 * 24 * 60 * 60 * 1000;
/** Searches come in bursts; one pass a little after the burst covers them. */
const SCHEDULE_DELAY_MS = 3000;

interface Endpoints {
  /** `…/v1/info`, answered as `<base>/<appid>`. */
  steamInfoBase: string;
  /** Tried in order: `<base>/<appid>/<hash>.ico`. */
  steamIconBases: string[];
}

const DEFAULT_ENDPOINTS: Endpoints = {
  steamInfoBase: 'https://api.steamcmd.net/v1/info',
  steamIconBases: [
    'https://shared.fastly.steamstatic.com/community_assets/images/apps',
    'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps',
  ],
};

let endpointOverride: Endpoints | null = null;

/** Test hook: point the Steam lookups at the E2E fakes (null restores). */
export function setGameIconEndpointOverride(endpoints: Endpoints | null): void {
  endpointOverride = endpoints;
}

function endpoints(): Endpoints {
  return endpointOverride ?? DEFAULT_ENDPOINTS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url: string, maxBytes: number): Promise<Buffer | null> {
  const response = await fetch(url, {
    timeout: REQUEST_TIMEOUT_MS,
    size: maxBytes,
    headers: { 'User-Agent': 'AutoTournament (game icons)' },
  });
  if (!response.ok) return null;
  return response.buffer();
}

/**
 * The client icon hash Steam lists for an app (`common.clienticon`), or null.
 * steamcmd.net answers `{ data: { "<appid>": { common: { clienticon } } } }`.
 */
export function clientIconHash(info: unknown, appId: number): string | null {
  const data = (info as { data?: Record<string, { common?: { clienticon?: unknown } }> } | null)
    ?.data;
  const hash = data?.[String(appId)]?.common?.clienticon;
  return typeof hash === 'string' && /^[a-f0-9]{40}$/i.test(hash) ? hash.toLowerCase() : null;
}

/**
 * A Steam game's client icon as the pill's 128 px PNG, or null when Steam
 * has none worth using. Throws only on a network failure of the info lookup
 * (so a pass can tell "Steam is unreachable" from "this game has none").
 */
export async function fetchSteamClientIcon(appId: number): Promise<Buffer | null> {
  const { steamInfoBase, steamIconBases } = endpoints();
  const infoBytes = await download(`${steamInfoBase}/${appId}`, MAX_INFO_BYTES);
  if (!infoBytes) return null;
  let info: unknown;
  try {
    info = JSON.parse(infoBytes.toString('utf8'));
  } catch {
    return null;
  }
  const hash = clientIconHash(info, appId);
  if (!hash) return null;

  for (const base of steamIconBases) {
    let bytes: Buffer | null;
    try {
      bytes = await download(`${base}/${appId}/${hash}.ico`, MAX_ICON_DOWNLOAD_BYTES);
    } catch {
      continue;
    }
    const png = bytes ? toGameIconPng(bytes) : null;
    if (png) return png;
  }
  return null;
}

/** Store an icon under its content hash; returns the URL the row records. */
export async function storeGameIcon(png: Buffer): Promise<string> {
  const file = `${crypto.createHash('sha256').update(png).digest('hex').slice(0, 16)}.png`;
  const target = path.join(GAME_ICON_DIR, file);
  await fs.mkdir(GAME_ICON_DIR, { recursive: true });
  try {
    await fs.access(target);
  } catch {
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, png);
    await fs.rename(temporary, target);
  }
  return `${GAME_ICON_URL_PREFIX}${file}`;
}

/** The path of a cached icon file, or null for a name that is not one. */
export function gameIconPath(file: string): string | null {
  return GAME_ICON_FILE_RE.test(file) ? path.join(GAME_ICON_DIR, file) : null;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

interface IconCandidate {
  id: number;
  igdb_id: number | null;
  wikidata_id: string | null;
  slug: string;
  name: string;
  steam_app_id: number | null;
}

/**
 * Candidates stored without a Steam app id get one from Wikidata P1733, for
 * rows with a Wikidata id (it needs no key). A failed lookup is logged; the
 * row is simply looked at again next time.
 */
async function fillSteamAppIds(rows: IconCandidate[]): Promise<void> {
  const record = async (row: IconCandidate, steamAppId: number | undefined) => {
    if (!steamAppId) return;
    row.steam_app_id = steamAppId;
    await db.runAsync('UPDATE games SET steam_app_id = ? WHERE id = ?', [steamAppId, row.id]);
  };

  const byWikidata = rows.filter((row) => !row.steam_app_id && row.wikidata_id !== null);
  if (byWikidata.length > 0) {
    try {
      const found = await getWikidataSteamAppIds(byWikidata.map((row) => row.wikidata_id as string));
      for (const row of byWikidata) await record(row, found.get(row.wikidata_id as string));
    } catch (err) {
      log.warn(`[Games] Wikidata Steam id lookup failed: ${(err as Error).message}`);
    }
  }
}

let running: Promise<number> | null = null;
let scheduled: NodeJS.Timeout | null = null;

/**
 * Look up app icons for games that have none: the ones players picked first,
 * then the rest. Returns how many icons were stored. One pass at a time; a
 * second call joins the running one. Never throws.
 *
 * Off in CI and tests (`enrichmentDisabled`) unless `force` is set, which the
 * E2E suite does with its fake Steam.
 */
export function refreshGameIcons(options: { force?: boolean } = {}): Promise<number> {
  if (running) return running;
  if (!options.force && enrichmentDisabled()) return Promise.resolve(0);
  running = (async () => {
    try {
      return await iconPass();
    } catch (err) {
      log.warn(`[Games] App icon lookup failed, will retry: ${(err as Error).message}`);
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Run a pass shortly, once, however many times this is called meanwhile —
 * for request handlers, which must never wait on it.
 */
export function scheduleGameIconRefresh(): void {
  if (scheduled || enrichmentDisabled()) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    void refreshGameIcons();
  }, SCHEDULE_DELAY_MS);
  scheduled.unref?.();
}

async function iconPass(): Promise<number> {
  const cutoff = Math.floor((Date.now() - RECHECK_MS) / 1000);
  const rows = await db.queryAsync<IconCandidate>(
    `SELECT g.id, g.igdb_id, g.wikidata_id, g.slug, g.name, g.steam_app_id FROM games g
      WHERE g.icon_url IS NULL AND (g.icon_checked_at IS NULL OR g.icon_checked_at < ?)
      ORDER BY EXISTS (SELECT 1 FROM player_games pg WHERE pg.game_id = g.id) DESC, g.id
      LIMIT ?`,
    [cutoff, PASS_BATCH]
  );
  if (rows.length === 0) return 0;

  // A module or pack already draws these games: nothing to fetch.
  const links = buildGameLinks();
  const markChecked = (id: number) =>
    db.runAsync('UPDATE games SET icon_checked_at = ? WHERE id = ?', [
      Math.floor(Date.now() / 1000),
      id,
    ]);
  const open: IconCandidate[] = [];
  for (const row of rows) {
    if (linkBuiltin(row, links)?.appIcon) await markChecked(row.id);
    else open.push(row);
  }

  await fillSteamAppIds(open);

  let stored = 0;
  let requested = false;
  for (const row of open) {
    if (!row.steam_app_id) {
      await markChecked(row.id);
      continue;
    }

    if (requested) await sleep(REQUEST_GAP_MS);
    requested = true;
    let png: Buffer | null;
    try {
      png = await fetchSteamClientIcon(row.steam_app_id);
    } catch (err) {
      // Steam (or the network) is down: stop here, leave the rest for later.
      log.warn(`[Games] Steam icon lookup stopped at "${row.name}": ${(err as Error).message}`);
      break;
    }
    if (!png) {
      await markChecked(row.id);
      continue;
    }

    const url = await storeGameIcon(png);
    const now = Math.floor(Date.now() / 1000);
    await db.runAsync(
      `UPDATE games SET icon_url = ?, icon_source = 'steam', icon_checked_at = ?, updated_at = ?
        WHERE id = ?`,
      [url, now, now, row.id]
    );
    stored += 1;
  }
  if (stored > 0) log.info(`[Games] Stored ${stored} game app icon(s) from Steam`);
  return stored;
}
