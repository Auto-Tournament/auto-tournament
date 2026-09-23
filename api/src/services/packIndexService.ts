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
import { installedPack, validatePack, type GamePackDefinition } from './gamePackService';

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

export interface PackIndexEntry {
  slug: string;
  name: string;
  version: string | null;
  engine: string;
  description: string | null;
  file: string;
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
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve an entry's `file` against the index's base, refusing anything that
 * would leave it.
 */
export function resolveEntryUrl(base: string, file: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return null; // a scheme of any kind
  if (file.startsWith('//') || file.startsWith('/')) return null;
  if (file.split('/').includes('..')) return null;

  const url = new URL(file, base);
  const root = new URL(base);
  if (url.origin !== root.origin) return null;
  if (!url.pathname.startsWith(root.pathname)) return null;
  return url.toString();
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
    entries.push({
      slug,
      name,
      version,
      engine,
      description: asString(row.description),
      file,
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
  { ok: true; pack: GamePackDefinition; origin: string } | { ok: false; error: string }
> {
  const wanted = slug.trim().toLowerCase();
  const index = await readPackIndex();
  const entry = index.entries.find((candidate) => candidate.slug === wanted);
  if (!entry) return { ok: false, error: `The index does not list '${wanted}'` };

  const url = resolveEntryUrl(packIndexBase(), entry.file);
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
  return { ok: true, pack: result.pack, origin: url };
}
