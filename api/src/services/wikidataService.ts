/**
 * Wikidata (www.wikidata.org) client for the player game catalogue.
 *
 * Wikidata needs no application registration or API key, so it is the
 * default (and only) search source for the game catalogue (see
 * `gameCatalogService.searchGames`) — it is what makes game search work out
 * of the box. Two requests per search:
 *  - `wbsearchentities` to find candidate item ids for the query.
 *  - one `wbgetentities` for those ids' claims and English label.
 *
 * Results are filtered to items whose P31 (instance of) includes Q7889
 * (video game); Q1150710 (video game series) is only accepted when nothing
 * else matched, so e.g. "Mario" can still return something without every
 * franchise/series article crowding out actual games.
 *
 * Every request carries a descriptive User-Agent, per the Wikimedia
 * User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy) —
 * Wikidata rate-limits or blocks generic/empty ones. On top of the per-IP
 * search limiter in routes/games.ts, a small process-wide limiter caps
 * outgoing Wikidata requests at 5/second, since this endpoint is shared by
 * every instance, with no API key.
 *
 * The endpoint can be overridden (`WIKIDATA_API_BASE`), and the E2E suite
 * points it at the fake Wikidata in routes/test.ts through
 * `setWikidataEndpointOverride`.
 */

import fetch, { type Response } from 'node-fetch';
import packageJson from '../../package.json';
import { slugify } from '../utils/slug';

const DEFAULT_WIKIDATA_API_BASE = 'https://www.wikidata.org/w/api.php';

/** A search must answer quickly; the built-ins are served instead when it does not. */
const REQUEST_TIMEOUT_MS = 3000;

/** Process-wide cap on outgoing Wikidata requests, independent of the per-IP limiter. */
const MAX_REQUESTS_PER_SECOND = 5;

const VIDEO_GAME_QID = 'Q7889';
const VIDEO_GAME_SERIES_QID = 'Q1150710';
const INSTANCE_OF_PROP = 'P31';
const PUBLICATION_DATE_PROP = 'P577';
const LOGO_IMAGE_PROP = 'P154';
const IMAGE_PROP = 'P18';
const GENRE_PROP = 'P136';
/** Steam application ID: what the game pill's app icon is fetched by, with no key. */
const STEAM_APP_ID_PROP = 'P1733';
/** At most this many genres are kept per game, in claim order. */
const MAX_GENRES = 3;

export interface WikidataGame {
  wikidataId: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  logoUrl: string | null;
  releaseYear: number | null;
  /** Up to 3 genre names (P136), resolved to their English label. */
  genres: string[];
  /** The game's Steam app id (P1733), or null when it has none. */
  steamAppId: number | null;
}

export class WikidataError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'WikidataError';
  }
}

let endpointOverride: string | null = null;

/** Test hook: point the client at another Wikidata endpoint (null restores). */
export function setWikidataEndpointOverride(apiBase: string | null): void {
  endpointOverride = apiBase;
  resetWikidataThrottle();
}

function apiBase(): string {
  if (endpointOverride) return endpointOverride;
  return process.env.WIKIDATA_API_BASE?.trim() || DEFAULT_WIKIDATA_API_BASE;
}

function userAgent(): string {
  return `AutoTournament/${packageJson.version} (https://autotournament.gg; self-hosted game search)`;
}

// ---------------------------------------------------------------------------
// Process-wide rate limiter (5 requests/second)
// ---------------------------------------------------------------------------

let windowStart = Date.now();
let windowCount = 0;

/** Test hook: forget the current rate-limit window. */
export function resetWikidataThrottle(): void {
  windowStart = Date.now();
  windowCount = 0;
}

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount < MAX_REQUESTS_PER_SECOND) {
      windowCount += 1;
      return;
    }
    const waitMs = windowStart + 1000 - now;
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 10)));
  }
}

async function wikidataFetch(params: Record<string, string>): Promise<unknown> {
  await throttle();

  const url = new URL(apiBase());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    throw new WikidataError(`Wikidata request failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new WikidataError(`Wikidata answered HTTP ${response.status}`, response.status);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Claim parsing
// ---------------------------------------------------------------------------

interface WikidataSnakValue {
  id?: unknown;
  time?: unknown;
}

interface WikidataClaim {
  mainsnak?: { datavalue?: { value?: string | WikidataSnakValue } };
}

interface WikidataEntity {
  id: string;
  claims?: Record<string, WikidataClaim[]>;
  labels?: Record<string, { value?: unknown }>;
}

function claimValues(entity: WikidataEntity, prop: string): Array<string | WikidataSnakValue> {
  const claims = entity.claims?.[prop] ?? [];
  return claims
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v): v is string | WikidataSnakValue => v !== undefined && v !== null);
}

/** Entity ids referenced by a claim (e.g. P31 "instance of" -> a QID). */
function claimEntityIds(entity: WikidataEntity, prop: string): string[] {
  return claimValues(entity, prop)
    .map((v) => (typeof v === 'object' && typeof v.id === 'string' ? v.id : undefined))
    .filter((id): id is string => Boolean(id));
}

/** Plain string claim values (a commons file name, for P154/P18). */
function claimStrings(entity: WikidataEntity, prop: string): string[] {
  return claimValues(entity, prop).filter((v): v is string => typeof v === 'string');
}

/** Wikibase time values (e.g. P577 "publication date" -> "+2015-07-07T00:00:00Z"). */
function claimTimeValues(entity: WikidataEntity, prop: string): string[] {
  return claimValues(entity, prop)
    .map((v) => (typeof v === 'object' && typeof v.time === 'string' ? v.time : undefined))
    .filter((t): t is string => Boolean(t));
}

/** The earliest year among a set of Wikibase time values, or null if there are none. */
function earliestYear(times: string[]): number | null {
  const years = times
    .map((t) => /^([+-]\d{1,1000})-\d\d-\d\d/.exec(t)?.[1])
    .filter((y): y is string => Boolean(y))
    .map((y) => parseInt(y, 10))
    .filter((y) => Number.isFinite(y));
  return years.length > 0 ? Math.min(...years) : null;
}

/** The first Steam application ID (P1733) on the item, as a number, or null. */
export function wikidataSteamAppId(entity: {
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
}): number | null {
  for (const claim of entity.claims?.[STEAM_APP_ID_PROP] ?? []) {
    const value = claim?.mainsnak?.datavalue?.value;
    if (typeof value === 'string' && /^\d{1,10}$/.test(value)) {
      const id = Number(value);
      if (id > 0 && id <= 2_147_483_647) return id;
    }
  }
  return null;
}

/** P154 (logo image) if present, else P18 (image), as a Commons FilePath URL. */
function commonsImageUrl(entity: WikidataEntity): string | null {
  const fileName = claimStrings(entity, LOGO_IMAGE_PROP)[0] ?? claimStrings(entity, IMAGE_PROP)[0];
  if (!fileName) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=128`;
}

function englishLabel(entity: WikidataEntity): string | null {
  const value = entity.labels?.en?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Genre resolution (P136): one extra batched wbgetentities call resolves the
// English label for every genre item referenced by a whole batch of games, so
// looking up genres for N games never costs more than one extra request.
// ---------------------------------------------------------------------------

async function resolveGenreLabels(entities: WikidataEntity[]): Promise<Map<string, string[]>> {
  const idsByEntity = new Map<string, string[]>();
  const genreIds = new Set<string>();
  for (const entity of entities) {
    const ids = claimEntityIds(entity, GENRE_PROP).slice(0, MAX_GENRES);
    idsByEntity.set(entity.id, ids);
    for (const id of ids) genreIds.add(id);
  }

  let labels = new Map<string, string>();
  if (genreIds.size > 0) {
    const body = (await wikidataFetch({
      action: 'wbgetentities',
      ids: [...genreIds].join('|'),
      props: 'labels',
      languages: 'en',
      languagefallback: '1',
      format: 'json',
    })) as { entities?: Record<string, WikidataEntity> };
    const genreEntities = body.entities ?? {};
    labels = new Map(
      Object.entries(genreEntities)
        .map(([id, e]) => [id, englishLabel(e)] as const)
        .filter((pair): pair is [string, string] => Boolean(pair[1]))
    );
  }

  const out = new Map<string, string[]>();
  for (const entity of entities) {
    const genres = (idsByEntity.get(entity.id) ?? [])
      .map((id) => labels.get(id))
      .filter((g): g is string => Boolean(g));
    out.set(entity.id, genres);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search Wikidata for video games. Returns `[]` when there is no match (or
 * nothing survives the video-game filter), and throws `WikidataError` when
 * Wikidata fails or times out.
 */
export async function searchWikidata(query: string, limit: number): Promise<WikidataGame[]> {
  const term = query.trim();
  if (!term) return [];

  const searchBody = (await wikidataFetch({
    action: 'wbsearchentities',
    search: term,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '20',
    format: 'json',
  })) as { search?: Array<{ id?: unknown }> };

  const ids = (searchBody.search ?? [])
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return [];

  const entitiesBody = (await wikidataFetch({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|labels',
    languages: 'en',
    // Newer/eponymous items (e.g. "Counter-Strike 2") often carry only the
    // language-independent "mul" label, not an "en" one; without this, those
    // items have no usable name and are silently dropped below.
    languagefallback: '1',
    format: 'json',
  })) as { entities?: Record<string, WikidataEntity> };

  const entities = entitiesBody.entities ?? {};
  // wbgetentities answers as a map; put candidates back in wbsearchentities'
  // relevance order.
  const ordered = ids.map((id) => entities[id]).filter((e): e is WikidataEntity => Boolean(e));

  const isVideoGame = (e: WikidataEntity) => claimEntityIds(e, INSTANCE_OF_PROP).includes(VIDEO_GAME_QID);
  const isSeries = (e: WikidataEntity) =>
    claimEntityIds(e, INSTANCE_OF_PROP).includes(VIDEO_GAME_SERIES_QID);

  const games = ordered.filter(isVideoGame);
  // A series (e.g. a franchise article) is only useful when no actual game
  // matched — otherwise it would just crowd out the real results.
  const chosen = games.length > 0 ? games : ordered.filter(isSeries);

  const maxResults = Math.max(1, Math.min(limit, 50));
  const usedSlugs = new Set<string>();
  const out: WikidataGame[] = [];

  // One extra batched call resolves every genre label this whole search
  // needs, however many games are in `chosen`.
  const genresByEntity = await resolveGenreLabels(chosen);

  for (const entity of chosen) {
    if (out.length >= maxResults) break;
    const name = englishLabel(entity);
    const baseSlug = name ? slugify(name) : '';
    if (!name || !baseSlug) continue;

    // Two different Wikidata items can slugify to the same string (e.g. two
    // same-named games); disambiguate within this batch with a suffix. A
    // collision with an *existing* row (a built-in, or one from an earlier
    // search) is handled by the upsert instead — that one is intentional
    // enrichment, not a clash.
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);

    const imageUrl = commonsImageUrl(entity);
    out.push({
      wikidataId: entity.id,
      slug,
      name,
      coverUrl: imageUrl,
      logoUrl: imageUrl,
      releaseYear: earliestYear(claimTimeValues(entity, PUBLICATION_DATE_PROP)),
      genres: genresByEntity.get(entity.id) ?? [],
      steamAppId: wikidataSteamAppId(entity),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Built-in game enrichment
// ---------------------------------------------------------------------------

export interface WikidataBuiltinInfo {
  imageUrl: string | null;
  releaseYear: number | null;
  genres: string[];
  /** The game's Steam app id (P1733), or null. */
  steamAppId: number | null;
}

/**
 * Batched lookup for built-in game enrichment: given known Wikidata QIDs
 * (see `gameEnrichmentService`), fetch their claims (P154/P18 image, P577
 * release year, P136 genres) in one `wbgetentities` call, then resolve genre
 * labels in one more batched call — two requests total, however many QIDs are
 * passed in. Throws `WikidataError` on a network/HTTP failure; the caller
 * decides how to handle that (built-in enrichment logs and retries next
 * start; see `gameEnrichmentService.enrichBuiltinGames`).
 */
export async function getWikidataBuiltinInfo(ids: string[]): Promise<Map<string, WikidataBuiltinInfo>> {
  const out = new Map<string, WikidataBuiltinInfo>();
  if (ids.length === 0) return out;

  const entitiesBody = (await wikidataFetch({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims',
    format: 'json',
  })) as { entities?: Record<string, WikidataEntity> };
  const entities = ids
    .map((id) => entitiesBody.entities?.[id])
    .filter((e): e is WikidataEntity => Boolean(e));

  const genresByEntity = await resolveGenreLabels(entities);

  for (const entity of entities) {
    out.set(entity.id, {
      imageUrl: commonsImageUrl(entity),
      releaseYear: earliestYear(claimTimeValues(entity, PUBLICATION_DATE_PROP)),
      genres: genresByEntity.get(entity.id) ?? [],
      steamAppId: wikidataSteamAppId(entity),
    });
  }

  return out;
}

/**
 * The Steam app ids (P1733) of these Wikidata items, by QID: one
 * `wbgetentities` call per 50 ids, no key. Items without one are left out.
 * Throws `WikidataError` on a network or HTTP failure.
 */
export async function getWikidataSteamAppIds(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))];
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const body = (await wikidataFetch({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'claims',
      format: 'json',
    })) as { entities?: Record<string, WikidataEntity> };
    for (const id of batch) {
      const entity = body.entities?.[id];
      const steamAppId = entity ? wikidataSteamAppId(entity) : null;
      if (steamAppId) out.set(id, steamAppId);
    }
  }
  return out;
}
