/* global AbortController */
/**
 * The CS2 map catalogue: `map_thumbnails/maps.json` in cs2-server-manager.
 *
 * `csm extract-map-data` writes it from the game files: every map with its
 * display name, game mode and images, and Valve's current Active Duty list.
 * It is fetched raw (no GitHub API, so no rate limit and no token), with a
 * timeout and one retry on a new connection. When that fails, or
 * `CATALOG_OFFLINE` is set, the copy committed next to this file is used
 * (`bundled-maps.json`, refreshed by `scripts/sync-cs2-maps.mjs`), so an
 * air-gapped install and the specs get the same list without the network.
 *
 * `loadMapCatalog` never throws: it always returns a catalogue, and says where
 * it came from.
 */

import http from 'http';
import https from 'https';
import fetch from 'node-fetch';
import { log } from '../../../utils/logger';
import bundledMapsJson from './bundled-maps.json';

export const MAP_THUMBNAILS_BASE =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails';
export const MAPS_JSON_URL = `${MAP_THUMBNAILS_BASE}/maps.json`;

/** One attempt may take this long before it is dropped (and retried once). */
const ATTEMPT_TIMEOUT_MS = 5000;

export interface CatalogMap {
  id: string;
  displayName: string;
  /** `defusal`, `hostage`, `armsrace`, … as the game files say. */
  mode: string;
  /** Full-size image. The thumbnail is the same name with `_thumb` before the extension. */
  imageUrl: string;
}

export interface MapCatalog {
  generatedAt: string | null;
  patchVersion: string | null;
  buildId: string | null;
  maps: CatalogMap[];
  /** Valve's current competitive pool, only ids that are in `maps`. */
  activeDuty: string[];
}

export interface LoadedMapCatalog {
  catalog: MapCatalog;
  /** `remote`: fetched now. `bundled`: the copy shipped with the module. */
  source: 'remote' | 'bundled';
  /** Why the remote copy was not used, when it was not. */
  error?: string;
}

/**
 * Entries in the thumbnails folder that are not maps anyone can play: the
 * veto lobby background, the "random" tile, and the game's default images.
 */
export function isPlayableMapId(id: string): boolean {
  if (!/^[a-z0-9_]+$/.test(id)) return false;
  if (id === 'random' || id.startsWith('lobby_') || id.startsWith('default')) return false;
  return true;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The catalogue in `raw` (a parsed maps.json), non-playable entries left out. Throws on a file of the wrong shape. */
export function parseMapCatalog(raw: unknown, imageBase = MAP_THUMBNAILS_BASE): MapCatalog {
  const file = raw as { maps?: unknown; activeDuty?: unknown } & Record<string, unknown>;
  if (!file || typeof file !== 'object' || !Array.isArray(file.maps)) {
    throw new Error('maps.json has no maps list');
  }
  const maps: CatalogMap[] = [];
  const seen = new Set<string>();
  for (const entry of file.maps as Array<Record<string, unknown>>) {
    const id = text(entry?.id);
    if (!id || seen.has(id) || !isPlayableMapId(id)) continue;
    const images = (entry.images ?? {}) as Record<string, unknown>;
    const full = text(images.full) ?? `${id}.webp`;
    maps.push({
      id,
      displayName: text(entry.name) ?? id,
      mode: text(entry.mode) ?? 'unknown',
      imageUrl: /^https?:\/\//.test(full) ? full : `${imageBase}/${full}`,
    });
    seen.add(id);
  }
  if (maps.length === 0) throw new Error('maps.json lists no playable maps');
  const activeDuty = Array.isArray(file.activeDuty)
    ? [...new Set((file.activeDuty as unknown[]).filter((id): id is string => typeof id === 'string'))].filter(
        (id) => seen.has(id)
      )
    : [];
  return {
    generatedAt: text(file.generatedAt),
    patchVersion: text(file.patchVersion),
    buildId: text(file.buildId),
    maps,
    activeDuty,
  };
}

/** The copy committed with the module. */
export function bundledMapCatalog(): MapCatalog {
  return parseMapCatalog(bundledMapsJson);
}

const AGENT_OPTIONS = { keepAlive: false };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url: URL): http.Agent => (url.protocol === 'http:' ? httpAgent : httpsAgent);

async function fetchOnce(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      agent: agentFor,
      headers: { 'User-Agent': 'auto-tournament', Accept: 'application/json' },
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`no answer within ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function offline(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.CATALOG_OFFLINE || '').trim().toLowerCase());
}

export interface LoadMapCatalogOptions {
  /** Where maps.json is (tests point this at a local server or a closed port). */
  url?: string;
  timeoutMs?: number;
}

/** maps.json from GitHub, or the bundled copy when it cannot be had. Never throws. */
export async function loadMapCatalog(options: LoadMapCatalogOptions = {}): Promise<LoadedMapCatalog> {
  const url = options.url ?? MAPS_JSON_URL;
  let error: string;
  if (offline()) {
    error = 'CATALOG_OFFLINE is set';
  } else {
    const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    try {
      let raw: unknown;
      try {
        raw = await fetchOnce(url, timeoutMs);
      } catch (first) {
        log.info(
          `[CS2 maps] ${url}: ${first instanceof Error ? first.message : String(first)}; trying once more`
        );
        raw = await fetchOnce(url, timeoutMs);
      }
      return { catalog: parseMapCatalog(raw), source: 'remote' };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  log.warn(`[CS2 maps] Could not get ${url} (${error}); using the map list bundled with the CS2 module`);
  return { catalog: bundledMapCatalog(), source: 'bundled', error };
}
