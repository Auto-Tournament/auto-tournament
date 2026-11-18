/* global AbortController */
/**
 * The CS2 map catalogue: maps.json, built by a connected csm host from its own
 * CS2 install (fleet/hosts/assets.ts fetchHostCatalog): every map with its
 * display name, game mode and images, and Valve's current Active Duty list.
 * With no host (and no copy a host sent before), or with `CATALOG_OFFLINE`
 * set, the copy committed next to this file is used
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
import { fetchHostCatalog } from '../fleet/hosts/assets';
import bundledMapsJson from './bundled-maps.json';
import type { Untrusted } from '../../../utils/untrusted';

// Images from the platform itself (routes/images.ts, read from a csm host and cached).
export const MAP_THUMBNAILS_BASE = '/api/game/cs2/img/maps-1280';

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

function text(value: Untrusted): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The catalogue in `raw` (a parsed maps.json), non-playable entries left out. Throws on a file of the wrong shape. */
export function parseMapCatalog(raw: Untrusted, imageBase = MAP_THUMBNAILS_BASE): MapCatalog {
  const file = raw as { maps?: Untrusted; activeDuty?: Untrusted } & Record<string, Untrusted>;
  if (!file || typeof file !== 'object' || !Array.isArray(file.maps)) {
    throw new Error('maps.json has no maps list');
  }
  const maps: CatalogMap[] = [];
  const seen = new Set<string>();
  for (const entry of file.maps as Array<Record<string, Untrusted>>) {
    const id = text(entry?.id);
    if (!id || seen.has(id) || !isPlayableMapId(id)) continue;
    const images = (entry.images ?? {}) as Record<string, Untrusted>;
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
    ? [
        ...new Set(
          (file.activeDuty as Untrusted[]).filter((id): id is string => typeof id === 'string')
        ),
      ].filter((id) => seen.has(id))
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

async function fetchOnce(url: string, timeoutMs: number): Promise<Untrusted> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      agent: agentFor,
      headers: { 'User-Agent': 'auto-tournament', Accept: 'application/json' },
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      // eslint-disable-next-line no-restricted-syntax -- the two AbortSignal types do not overlap for tsc
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
  /** Fetch maps.json from this URL instead of asking a csm host (tests: a local server or a closed port). */
  url?: string;
  timeoutMs?: number;
  /** Never fetch. Defaults to `CATALOG_OFFLINE`. */
  offline?: boolean;
}

/** maps.json from a csm host (or options.url), or the bundled copy when it cannot be had. Never throws. */
export async function loadMapCatalog(
  options: LoadMapCatalogOptions = {}
): Promise<LoadedMapCatalog> {
  const url = options.url;
  let error: string;
  if (options.offline ?? offline()) {
    error = 'CATALOG_OFFLINE is set';
  } else if (!url) {
    try {
      const raw = await fetchHostCatalog('maps.json');
      if (raw) return { catalog: parseMapCatalog(raw), source: 'remote' };
      error = 'no csm host has sent maps.json yet';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    try {
      let raw: Untrusted;
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

  log.warn(
    `[CS2 maps] Could not get maps.json${url ? ` from ${url}` : ''} (${error}); using the map list bundled with the CS2 module`
  );
  return { catalog: bundledMapCatalog(), source: 'bundled', error };
}
