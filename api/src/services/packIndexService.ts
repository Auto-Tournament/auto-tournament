/**
 * The community pack index: the list of games an admin can add without
 * writing a file themselves.
 *
 * `Auto-Tournament/packs` holds one JSON file per game and an `index.json`
 * naming them. This fetches that index, and on request the pack file behind
 * one of its entries, which then goes through the same validation an uploaded
 * file does. Nothing is trusted because it came from the index.
 *
 * ## Nothing is fetched until an admin asks
 *
 * No install contacts GitHub on its own. The index is read when someone opens
 * Browse on the Modules page, and the answer is cached under `DATA_DIR` so a
 * host who has seen it once can still read it with no network at all. A
 * self-hosted instance should not phone anywhere the person running it did
 * not ask it to.
 *
 * ## What the index may point at
 *
 * An entry's `file` is a path *inside the index's own base*, not a URL. A
 * scheme, a host, a leading slash or a `..` is refused. Otherwise an index —
 * which is a file in a repo anyone may open a pull request against — could
 * name any URL on the internet and have this server fetch it.
 */

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { DATA_DIR } from '../config/dataDir';
import { log } from '../utils/logger';
import {
  checkTileMarkup,
  installedPack,
  validatePack,
  type GamePackDefinition,
} from './gamePackService';

/** Where the index lives, unless a host or a test says otherwise. */
const DEFAULT_PACK_INDEX_URL = 'https://raw.githubusercontent.com/Auto-Tournament/packs/main/';

let baseOverride: string | null = null;

/**
 * The index base: a test's fixture, the host's own `PACK_INDEX_URL`, or the
 * community repo. Always ends in a slash, so `new URL('index.json', base)`
 * resolves inside it rather than beside it.
 */
export function packIndexBase(): string {
  const base = baseOverride || process.env.PACK_INDEX_URL || DEFAULT_PACK_INDEX_URL;
  return base.endsWith('/') ? base : `${base}/`;
}

/** Test-only, the same shape `setIgdbEndpointOverride` has. */
export function setPackIndexBaseOverride(base: string | null): void {
  baseOverride = base;
}

const CACHE_FILE = path.join(DATA_DIR, 'pack-index.json');
const FETCH_TIMEOUT_MS = 10_000;
const MAX_INDEX_BYTES = 2_000_000;
const MAX_PACK_BYTES = 2_000_000;
const MAX_TILE_BYTES = 1_000_000;

export interface PackIndexEntry {
  slug: string;
  name: string;
  version: string | null;
  engine: string;
  description: string | null;
  file: string;
  /**
   * The tile the index names for this game, as it declared it — relative to
   * the index itself. Null when it names none, or names one outside the
   * index. Served by this instance at `/api/packs/index/<slug>/icon.svg`.
   */
  icon: string | null;
  /** True when this instance already has the pack. */
  installed: boolean;
  /** True when it is installed at a different version than the index lists. */
  updatable: boolean;
}

export interface PackIndexResult {
  entries: PackIndexEntry[];
  /** The index came from the cache because the fetch failed. */
  stale: boolean;
  /** Why it is stale, for the page to show. */
  error?: string;
}

interface RawEntry {
  slug?: unknown;
  name?: unknown;
  version?: unknown;
  engine?: unknown;
  description?: unknown;
  file?: unknown;
  icon?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve a relative path from somewhere inside the index, refusing anything
 * that would leave it.
 *
 * `from` is what the path is relative to: the index base for an entry's
 * `file`, the pack's own URL for the `icon` it names. Either way the answer
 * must still sit under the base, so a file written by whoever opened the pull
 * request cannot send this server anywhere else. A `..` is allowed inside the
 * path — that is how a pack in `packs/` reaches `icons/` — and caught here if
 * it climbs too far.
 */
export function resolveInsideIndex(base: string, from: string, relative: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative)) return null; // a scheme of any kind
  if (relative.startsWith('//') || relative.startsWith('/')) return null;

  const root = new URL(base);
  let url: URL;
  try {
    url = new URL(relative, from);
  } catch {
    return null;
  }
  if (url.origin !== root.origin) return null;
  if (!url.pathname.startsWith(root.pathname)) return null;
  return url.toString();
}

/** An index entry's `file`, relative to the index itself. */
export function resolveEntryUrl(base: string, file: string): string | null {
  return resolveInsideIndex(base, base, file);
}

async function fetchText(url: string, limit: number): Promise<string> {
  // `node-fetch`'s own timeout, the same one `igdbService` uses, rather than
  // an AbortController: this runs in the API bundle, not in a browser.
  const response = await fetch(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('the file is too large');
  return text;
}

function parseIndex(text: string): RawEntry[] {
  const parsed = JSON.parse(text) as { schema?: unknown; packs?: unknown };
  if (parsed.schema !== 1) throw new Error('the index is written for a newer Auto Tournament');
  if (!Array.isArray(parsed.packs)) throw new Error('the index has no packs');
  return parsed.packs as RawEntry[];
}

function toEntries(raw: RawEntry[]): PackIndexEntry[] {
  const entries: PackIndexEntry[] = [];
  for (const row of raw) {
    const slug = asString(row.slug)?.toLowerCase();
    const name = asString(row.name);
    const file = asString(row.file);
    const engine = asString(row.engine);
    // A row missing any of these describes nothing importable. Skipping it
    // keeps one bad line in a community file from hiding every other game.
    if (!slug || !name || !file || !engine) continue;
    if (!resolveEntryUrl(packIndexBase(), file)) continue;

    const version = asString(row.version);
    const installed = installedPack(slug);
    // The tile is named relative to the index itself here, so Browse can draw
    // a card without downloading the pack first. An entry naming one outside
    // the index simply has no tile, the same way a malformed one is skipped.
    const declared = asString(row.icon);
    const icon = declared && resolveEntryUrl(packIndexBase(), declared) ? declared : null;
    entries.push({
      slug,
      name,
      version,
      engine,
      description: asString(row.description),
      file,
      icon,
      installed: Boolean(installed),
      updatable: Boolean(installed && version && installed.version !== version),
    });
  }
  return entries;
}

async function readCache(): Promise<RawEntry[] | null> {
  try {
    return parseIndex(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(text: string): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, text, 'utf8');
  } catch (error) {
    // A cache that cannot be written costs the next offline read, nothing else.
    log.warn(`[PACKS] Could not cache the pack index: ${(error as Error).message}`);
  }
}

/**
 * The index, fetched now, or the last copy seen if the fetch fails.
 *
 * Only ever called from the admin's Browse action.
 */
export async function readPackIndex(): Promise<PackIndexResult> {
  try {
    const text = await fetchText(
      new URL('index.json', packIndexBase()).toString(),
      MAX_INDEX_BYTES
    );
    const raw = parseIndex(text);
    await writeCache(text);
    return { entries: toEntries(raw), stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the index could not be read';
    const cached = await readCache();
    if (!cached) return { entries: [], stale: true, error: message };
    log.warn(`[PACKS] Serving the cached pack index: ${message}`);
    return { entries: toEntries(cached), stale: true, error: message };
  }
}

/**
 * The pack behind one index entry, validated the same way an uploaded file
 * is. Returns the definition and the URL it came from, for the caller to
 * install.
 */
export async function fetchIndexedPack(
  slug: string
): Promise<
  | { ok: true; pack: GamePackDefinition; origin: string; tile: string | null }
  | { ok: false; error: string }
> {
  const wanted = slug.trim().toLowerCase();
  const index = await readPackIndex();
  const entry = index.entries.find((candidate) => candidate.slug === wanted);
  if (!entry) return { ok: false, error: `The index does not list '${wanted}'` };
  return fetchPackAt(packIndexBase(), wanted, entry.file);
}

/**
 * The pack file `file` names, relative to `base` (an index or the game
 * catalog), validated the same way an uploaded file is, with its tile. The
 * pack must be `slug`, and neither it nor its tile may leave `base`.
 */
export async function fetchPackAt(
  base: string,
  slug: string,
  file: string
): Promise<
  | { ok: true; pack: GamePackDefinition; origin: string; tile: string | null }
  | { ok: false; error: string }
> {
  const wanted = slug.trim().toLowerCase();
  const url = resolveEntryUrl(base, file);
  if (!url) return { ok: false, error: 'That entry points outside the index' };

  let text: string;
  try {
    text = await fetchText(url, MAX_PACK_BYTES);
  } catch (error) {
    return {
      ok: false,
      error: `Could not download that pack: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That pack is not valid JSON' };
  }

  // The same validation an uploaded file gets. Being listed in the index
  // earns a pack nothing.
  const result = validatePack(parsed);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.pack.slug !== wanted) {
    return { ok: false, error: `The index lists '${wanted}' but the file is '${result.pack.slug}'` };
  }

  // The tile is a file beside the pack, named by a path relative to it —
  // `../icons/call-of-duty.svg`. Resolved against the *pack's* URL, then
  // checked against the same base as everything else: a pack file is written
  // by whoever opened the pull request, so its paths are a claim, not a
  // permission.
  let tile: string | null = null;
  if (result.pack.icon) {
    const iconUrl = resolveInsideIndex(base, url, result.pack.icon);
    if (!iconUrl) return { ok: false, error: "That pack's icon points outside the index" };
    try {
      const markup = await fetchText(iconUrl, MAX_TILE_BYTES);
      const problem = checkTileMarkup(markup);
      if (problem) return { ok: false, error: problem };
      tile = markup;
    } catch (error) {
      return {
        ok: false,
        error: `Could not download that pack's icon: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      };
    }
  }

  return { ok: true, pack: result.pack, origin: url, tile };
}

/**
 * The tile the index names for one of its entries, for Browse to draw before
 * anything is installed.
 *
 * Fetched by *this server* and served from our own origin, rather than
 * letting the page load it from wherever the index lives: a browse list
 * should not hand every admin's address to whoever hosts the index, and a
 * tile has to be same-origin before `ModuleIcon` will inline it and let the
 * theme reach it.
 *
 * Kept briefly in memory. Browse draws a handful of cards at once and an
 * admin who closes and reopens it should not re-fetch them all.
 */
const previewCache = new Map<string, { markup: string; at: number }>();
const PREVIEW_TTL_MS = 10 * 60 * 1000;

export async function fetchIndexedTile(
  slug: string
): Promise<{ ok: true; markup: string } | { ok: false; error: string }> {
  const wanted = slug.trim().toLowerCase();
  const cached = previewCache.get(wanted);
  if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) {
    return { ok: true, markup: cached.markup };
  }

  const index = await readPackIndex();
  const entry = index.entries.find((candidate) => candidate.slug === wanted);
  if (!entry?.icon) return { ok: false, error: 'No tile for that game' };

  const url = resolveEntryUrl(packIndexBase(), entry.icon);
  if (!url) return { ok: false, error: 'That tile points outside the index' };

  try {
    const markup = await fetchText(url, MAX_TILE_BYTES);
    const problem = checkTileMarkup(markup);
    if (problem) return { ok: false, error: problem };
    previewCache.set(wanted, { markup, at: Date.now() });
    return { ok: true, markup };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}
