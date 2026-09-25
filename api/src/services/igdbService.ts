/**
 * IGDB (api.igdb.com v4) client for the player game catalogue.
 *
 * IGDB authenticates with a Twitch application: a client-credentials token
 * from id.twitch.tv, sent as `Authorization: Bearer` together with the
 * `Client-ID` header. The token lives about 60 days and is cached in memory
 * until shortly before it expires.
 *
 * Credentials come from `settingsService.getIgdbCredentials()` (env first,
 * then the admin Settings page). With none configured, `searchIgdb` returns
 * `null` and the catalogue serves the built-in list instead.
 *
 * Both endpoints can be overridden (`IGDB_API_BASE`, `TWITCH_TOKEN_URL`), and
 * the E2E suite points them at the fake IGDB in routes/test.ts through
 * `setIgdbEndpointOverride`.
 */

import crypto from 'crypto';
import fetch, { type RequestInit, type Response } from 'node-fetch';
import { settingsService, type IgdbCredentials } from './settingsService';
import { log } from '../utils/logger';

const DEFAULT_IGDB_API_BASE = 'https://api.igdb.com/v4';
const DEFAULT_TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';

/** A search must answer quickly; the built-ins are served instead when it does not. */
const REQUEST_TIMEOUT_MS = 4000;
/** Refresh the token this long before Twitch says it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export interface IgdbGame {
  igdbId: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  logoUrl: string | null;
  releaseYear: number | null;
  /** Up to 3 genre names (IGDB `genres.name`). */
  genres: string[];
  /** The game's Steam app id, from IGDB's external games, or null when it is not on Steam. */
  steamAppId: number | null;
}

export class IgdbError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'IgdbError';
  }
}

interface Endpoints {
  apiBase: string;
  tokenUrl: string;
}

let endpointOverride: Endpoints | null = null;

/** Test hook: point the client at another IGDB + token endpoint (null restores). */
export function setIgdbEndpointOverride(endpoints: Endpoints | null): void {
  endpointOverride = endpoints;
  clearIgdbTokenCache();
}

function endpoints(): Endpoints {
  if (endpointOverride) return endpointOverride;
  return {
    apiBase: (process.env.IGDB_API_BASE?.trim() || DEFAULT_IGDB_API_BASE).replace(/\/+$/, ''),
    tokenUrl: process.env.TWITCH_TOKEN_URL?.trim() || DEFAULT_TWITCH_TOKEN_URL,
  };
}

interface CachedToken {
  /** Which credentials the token belongs to (client id + a hash of the secret). */
  key: string;
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let inflightToken: { key: string; promise: Promise<string> } | null = null;

export function clearIgdbTokenCache(): void {
  cachedToken = null;
  inflightToken = null;
}

function credentialKey(creds: IgdbCredentials): string {
  const secretHash = crypto.createHash('sha256').update(creds.clientSecret).digest('hex');
  return `${creds.clientId}:${secretHash}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, timeout: REQUEST_TIMEOUT_MS });
}

async function requestToken(creds: IgdbCredentials): Promise<string> {
  const url = new URL(endpoints().tokenUrl);
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('client_secret', creds.clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), { method: 'POST' });
  } catch (err) {
    throw new IgdbError(`Twitch token request failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    // Twitch answers 400/403 for a bad id or secret. Do not echo the body: it
    // can repeat the client id, and it tells an admin nothing a status does not.
    throw new IgdbError(`Twitch rejected the IGDB credentials (HTTP ${response.status})`, response.status);
  }

  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new IgdbError('Twitch token response had no access_token');
  }
  const expiresInMs =
    typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in * 1000 : 3600_000;

  cachedToken = {
    key: credentialKey(creds),
    token: body.access_token,
    expiresAt: Date.now() + Math.max(expiresInMs - TOKEN_EXPIRY_MARGIN_MS, 30_000),
  };
  return body.access_token;
}

async function getToken(creds: IgdbCredentials, force = false): Promise<string> {
  const key = credentialKey(creds);
  if (!force && cachedToken && cachedToken.key === key && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  // Concurrent searches share one token request.
  if (!force && inflightToken && inflightToken.key === key) return inflightToken.promise;

  const promise = requestToken(creds).finally(() => {
    if (inflightToken?.promise === promise) inflightToken = null;
  });
  inflightToken = { key, promise };
  return promise;
}

async function igdbQuery<T>(creds: IgdbCredentials, resource: string, body: string): Promise<T> {
  const run = async (token: string) =>
    fetchWithTimeout(`${endpoints().apiBase}/${resource}`, {
      method: 'POST',
      headers: {
        'Client-ID': creds.clientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      body,
    });

  let response: Response;
  try {
    response = await run(await getToken(creds));
    if (response.status === 401) {
      // Revoked or expired early: get a new token once.
      response = await run(await getToken(creds, true));
    }
  } catch (err) {
    if (err instanceof IgdbError) throw err;
    throw new IgdbError(`IGDB request failed: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new IgdbError(`IGDB answered HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

export function igdbImageUrl(imageId: string, size: 't_cover_small' | 't_logo_med'): string {
  return `${IMAGE_BASE}/${size}/${imageId}.jpg`;
}

/** Characters that would end or break an Apicalypse string literal. */
function apicalypseString(value: string): string {
  return value.replace(/["\\;]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface RawExternalGame {
  category?: unknown;
  external_game_source?: unknown;
  uid?: unknown;
  url?: unknown;
}

interface RawIgdbGame {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  first_release_date?: unknown;
  cover?: { image_id?: unknown } | null;
  genres?: Array<{ name?: unknown }> | null;
  external_games?: RawExternalGame[] | null;
}

/** IGDB's id for Steam, both as the old `category` enum and as an `external_game_source`. */
const IGDB_STEAM_SOURCE = 1;

/** The fields every games query asks for to learn a game's Steam app id. */
const EXTERNAL_GAME_FIELDS =
  'external_games.category,external_games.external_game_source,external_games.uid,external_games.url';

/**
 * The Steam app id among a game's IGDB external games, or null. IGDB marks
 * Steam as source 1 (`external_game_source`, or the older `category`); the
 * store URL is the fallback, since it names the app either way.
 */
export function steamAppIdFromIgdb(externalGames: unknown): number | null {
  if (!Array.isArray(externalGames)) return null;
  for (const raw of externalGames as RawExternalGame[]) {
    if (!raw || typeof raw !== 'object') continue;
    const source =
      typeof raw.external_game_source === 'object' && raw.external_game_source !== null
        ? (raw.external_game_source as { id?: unknown }).id
        : raw.external_game_source;
    const isSteam = source === IGDB_STEAM_SOURCE || raw.category === IGDB_STEAM_SOURCE;
    const fromUrl =
      typeof raw.url === 'string'
        ? /store\.steampowered\.com\/app\/(\d{1,10})/.exec(raw.url)?.[1]
        : undefined;
    const uid = isSteam && typeof raw.uid === 'string' && /^\d{1,10}$/.test(raw.uid) ? raw.uid : fromUrl;
    const id = uid ? Number(uid) : NaN;
    if (Number.isInteger(id) && id > 0 && id <= 2_147_483_647) return id;
  }
  return null;
}

function toIgdbGame(raw: RawIgdbGame): IgdbGame | null {
  if (typeof raw.id !== 'number' || typeof raw.name !== 'string' || typeof raw.slug !== 'string') {
    return null;
  }
  const imageId = typeof raw.cover?.image_id === 'string' ? raw.cover.image_id : null;
  const released =
    typeof raw.first_release_date === 'number'
      ? new Date(raw.first_release_date * 1000).getUTCFullYear()
      : null;
  const genres = Array.isArray(raw.genres)
    ? raw.genres
        .map((g) => (typeof g?.name === 'string' ? g.name : null))
        .filter((name): name is string => Boolean(name))
        .slice(0, 3)
    : [];
  return {
    igdbId: raw.id,
    slug: raw.slug,
    name: raw.name,
    coverUrl: imageId ? igdbImageUrl(imageId, 't_cover_small') : null,
    logoUrl: imageId ? igdbImageUrl(imageId, 't_logo_med') : null,
    releaseYear: released,
    genres,
    steamAppId: steamAppIdFromIgdb(raw.external_games),
  };
}

/**
 * Search IGDB. Returns `null` when no credentials are configured, and throws
 * `IgdbError` when IGDB or Twitch fail or time out.
 */
export async function searchIgdb(query: string, limit: number): Promise<IgdbGame[] | null> {
  const creds = await settingsService.getIgdbCredentials();
  if (!creds) return null;

  const term = apicalypseString(query);
  if (!term) return [];

  // Main games, remasters and expansions are all things people "play"; DLC,
  // bundles and mods are not. version_parent = null drops editions.
  const body =
    `search "${term}"; ` +
    `fields name,slug,first_release_date,cover.image_id,genres.name,${EXTERNAL_GAME_FIELDS}; ` +
    'where version_parent = null; ' +
    `limit ${Math.max(1, Math.min(limit, 50))};`;

  const rows = await igdbQuery<RawIgdbGame[]>(creds, 'games', body);
  return (Array.isArray(rows) ? rows : [])
    .map(toIgdbGame)
    .filter((g): g is IgdbGame => g !== null);
}

/**
 * The Steam app ids IGDB knows for these games, by IGDB id — for rows stored
 * before search asked for them. Returns null when IGDB is not configured, and
 * throws `IgdbError` when it fails. At most 50 ids per call.
 */
export async function igdbSteamAppIds(igdbIds: number[]): Promise<Map<number, number> | null> {
  const creds = await settingsService.getIgdbCredentials();
  if (!creds) return null;
  const ids = [...new Set(igdbIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 50);
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = await igdbQuery<RawIgdbGame[]>(
    creds,
    'games',
    `fields ${EXTERNAL_GAME_FIELDS}; where id = (${ids.join(',')}); limit ${ids.length};`
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    const steamAppId = steamAppIdFromIgdb(row.external_games);
    if (typeof row.id === 'number' && steamAppId) out.set(row.id, steamAppId);
  }
  return out;
}

/**
 * Admin "Test connection": fetch a fresh token and run a one-row query.
 * Never throws; the error is safe to show (it never contains the secret).
 */
export async function testIgdbConnection(): Promise<
  { ok: true; source: IgdbCredentials['source'] } | { ok: false; configured: boolean; error: string }
> {
  const creds = await settingsService.getIgdbCredentials();
  if (!creds) {
    return { ok: false, configured: false, error: 'No IGDB client ID and secret are configured' };
  }
  try {
    await getToken(creds, true);
    await igdbQuery<unknown[]>(creds, 'games', 'fields name; limit 1;');
    return { ok: true, source: creds.source };
  } catch (err) {
    log.warn(`[IGDB] Connection test failed: ${(err as Error).message}`);
    return { ok: false, configured: true, error: (err as Error).message };
  }
}
