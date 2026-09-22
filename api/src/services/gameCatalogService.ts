/**
 * The player game catalogue: "What do you play?".
 *
 * Games live in the `games` table. Rows come from three places:
 * - **built-in**: every game an installed integration supports, then a short
 *   list of popular esports titles. Names and slugs only. Seeded on demand
 *   (one idempotent insert) so they always exist, with or without IGDB.
 * - **IGDB**: search results are upserted by IGDB id / slug, so repeat queries
 *   and chips render from our own table.
 * - **Wikidata**: the same idea, keyed on Wikidata id / slug, used instead of
 *   IGDB when no IGDB credentials are configured — it needs no API key, so
 *   search works out of the box.
 *
 * Built-in slugs are IGDB slugs, so an IGDB (or Wikidata) result for Rocket
 * League updates the built-in Rocket League row rather than adding a second
 * one.
 *
 * `supported` means a game module exists for it (the integration registry),
 * i.e. this instance can run tournaments for it.
 */

import { db } from '../config/database';
import { listIntegrations } from '../integrations/registry';
import { log } from '../utils/logger';
import { slugify } from '../utils/slug';
import { IgdbError, searchIgdb, type IgdbGame } from './igdbService';
import { WikidataError, searchWikidata, type WikidataGame } from './wikidataService';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_RESULTS = 10;
export const MAX_PLAYER_GAMES = 30;
const SUGGESTION_COUNT = 3;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 500;

export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  releaseYear: number | null;
  supported: boolean;
  /** Where this row's data came from; the client uses it to pick a credit line. */
  source: 'igdb' | 'wikidata' | 'builtin';
  /** Up to 3 genre names, from IGDB `genres.name` or Wikidata P136. */
  genres: string[];
  /** `coverUrl` if present, else `logoUrl`; convenience for the onboarding page's cards. */
  imageUrl: string | null;
}

export interface GameSearchResult {
  games: GameSummary[];
  /** True when any result came from IGDB (the client shows the IGDB credit). */
  fromIgdb: boolean;
  /** True when any result came from Wikidata (the client shows the Wikidata credit). */
  fromWikidata: boolean;
}

interface BuiltinGame {
  slug: string;
  name: string;
  aliases: string[];
  /** Integration id when an installed module runs this game. */
  integrationId: string | null;
}

/** Popular esports titles offered before IGDB is configured. IGDB slugs. */
const POPULAR_GAMES: Array<{ slug: string; name: string; aliases?: string[] }> = [
  { slug: 'rocket-league', name: 'Rocket League', aliases: ['rl'] },
  { slug: 'valorant', name: 'Valorant' },
  { slug: 'league-of-legends', name: 'League of Legends', aliases: ['lol'] },
  { slug: 'dota-2', name: 'Dota 2', aliases: ['dota'] },
  { slug: 'trackmania', name: 'Trackmania', aliases: ['tm'] },
  { slug: 'chess', name: 'Chess' },
  { slug: 'overwatch-2', name: 'Overwatch 2', aliases: ['ow', 'ow2'] },
  { slug: 'ea-sports-fc-25', name: 'EA Sports FC', aliases: ['fifa', 'fc'] },
  { slug: 'super-smash-bros-ultimate', name: 'Super Smash Bros. Ultimate', aliases: ['smash', 'ssbu'] },
  { slug: 'street-fighter-6', name: 'Street Fighter 6', aliases: ['sf6'] },
  { slug: 'tekken-8', name: 'Tekken 8' },
  { slug: 'osu', name: 'osu!' },
  { slug: 'team-fortress-2', name: 'Team Fortress 2', aliases: ['tf2'] },
  { slug: 'age-of-empires-ii', name: 'Age of Empires II', aliases: ['aoe2', 'aoe'] },
];

export { slugify };

/** Lowercase, alphanumerics only: "Counter-Strike 2" and "counter strike2" match. */
function searchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Installed integrations first, then the popular list; one entry per slug. */
export function builtinGames(): BuiltinGame[] {
  const out: BuiltinGame[] = [];
  const seen = new Set<string>();

  for (const integration of listIntegrations()) {
    const slug = integration.catalog?.slug || slugify(integration.displayName);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      name: integration.displayName,
      aliases: [integration.id, ...(integration.catalog?.aliases ?? [])],
      integrationId: integration.id,
    });
  }

  for (const game of POPULAR_GAMES) {
    if (seen.has(game.slug)) continue;
    seen.add(game.slug);
    out.push({ slug: game.slug, name: game.name, aliases: game.aliases ?? [], integrationId: null });
  }

  return out;
}

function supportedSlugs(): Map<string, string> {
  const map = new Map<string, string>();
  for (const game of builtinGames()) {
    if (game.integrationId) map.set(game.slug, game.integrationId);
  }
  return map;
}

function matchesBuiltin(game: BuiltinGame, query: string): boolean {
  const q = searchKey(query);
  if (!q) return false;
  return [game.name, game.slug, ...game.aliases].some((term) => searchKey(term).includes(q));
}

interface GameRow {
  id: number;
  igdb_id: number | null;
  wikidata_id: string | null;
  slug: string;
  name: string;
  cover_url: string | null;
  logo_url: string | null;
  release_year: number | null;
  genres: string | null;
  source: string;
}

const GAME_COLUMNS =
  'id, igdb_id, wikidata_id, slug, name, cover_url, logo_url, release_year, genres, source';

function parseGenres(genres: string | null): string[] {
  if (!genres) return [];
  try {
    const parsed = JSON.parse(genres);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(row: GameRow, supported: Map<string, string>): GameSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    coverUrl: row.cover_url,
    releaseYear: row.release_year,
    supported: supported.has(row.slug),
    source: row.source === 'igdb' || row.source === 'wikidata' ? row.source : 'builtin',
    genres: parseGenres(row.genres),
    imageUrl: row.cover_url || row.logo_url || null,
  };
}

/**
 * Make sure every built-in has a row. Existing rows (including built-ins IGDB
 * has since enriched) are left alone. Reads first, so the common case is one
 * SELECT and does not burn sequence values on ON CONFLICT.
 */
export async function ensureBuiltinGames(): Promise<void> {
  const all = builtinGames();
  const existing = await rowsBySlug(all.map((g) => g.slug));
  const games = all.filter((g) => !existing.has(g.slug));
  if (games.length === 0) return;
  const values = games.map(() => "(?, ?, 'builtin')").join(', ');
  await db.runAsync(
    `INSERT INTO games (slug, name, source) VALUES ${values} ON CONFLICT (slug) DO NOTHING`,
    games.flatMap((g) => [g.slug, g.name])
  );
}

async function rowsBySlug(slugs: string[]): Promise<Map<string, GameRow>> {
  if (slugs.length === 0) return new Map();
  const rows = await db.queryAsync<GameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE slug = ANY(?::text[])`,
    [slugs]
  );
  return new Map(rows.map((r) => [r.slug, r]));
}

/**
 * Upsert IGDB results. Matched by IGDB id first (IGDB can rename a slug),
 * then by slug (a built-in row for the same game).
 */
/** JSON for up to 3 genres, or `null` when there are none (never clobbers a row's existing genres). */
function genresJson(genres: string[]): string | null {
  return genres.length > 0 ? JSON.stringify(genres.slice(0, 3)) : null;
}

async function upsertIgdbGames(games: IgdbGame[]): Promise<GameRow[]> {
  const out: GameRow[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const game of games) {
    const existing = await db.queryAsync<GameRow>(
      `SELECT ${GAME_COLUMNS} FROM games WHERE igdb_id = ? OR slug = ? ORDER BY (igdb_id = ?) DESC NULLS LAST`,
      [game.igdbId, game.slug, game.igdbId]
    );
    const genres = genresJson(game.genres);

    if (existing.length === 0) {
      const row = await db.queryOneAsync<GameRow>(
        `INSERT INTO games (igdb_id, slug, name, cover_url, logo_url, release_year, genres, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'igdb', ?)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, genres = COALESCE(EXCLUDED.genres, games.genres)
         RETURNING ${GAME_COLUMNS}`,
        [game.igdbId, game.slug, game.name, game.coverUrl, game.logoUrl, game.releaseYear, genres, now]
      );
      if (row) out.push(row);
      continue;
    }

    const target = existing[0];
    // Keep the old slug if the new one belongs to a different row.
    const slugTaken = existing.some((r) => r.id !== target.id && r.slug === game.slug);
    const row = await db.queryOneAsync<GameRow>(
      `UPDATE games
          SET igdb_id = ?, slug = ?, name = ?, cover_url = ?, logo_url = ?,
              release_year = ?, genres = COALESCE(?, genres), source = 'igdb', updated_at = ?
        WHERE id = ?
        RETURNING ${GAME_COLUMNS}`,
      [
        game.igdbId,
        slugTaken ? target.slug : game.slug,
        game.name,
        game.coverUrl,
        game.logoUrl,
        game.releaseYear,
        genres,
        now,
        target.id,
      ]
    );
    if (row) out.push(row);
  }

  return out;
}

/**
 * Upsert Wikidata results. Matched by Wikidata id first (a label can change),
 * then by slug (a built-in, or an IGDB-enriched, row for the same game) —
 * same idea as `upsertIgdbGames`.
 */
async function upsertWikidataGames(games: WikidataGame[]): Promise<GameRow[]> {
  const out: GameRow[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const game of games) {
    const existing = await db.queryAsync<GameRow>(
      `SELECT ${GAME_COLUMNS} FROM games WHERE wikidata_id = ? OR slug = ? ORDER BY (wikidata_id = ?) DESC NULLS LAST`,
      [game.wikidataId, game.slug, game.wikidataId]
    );
    const genres = genresJson(game.genres);

    if (existing.length === 0) {
      const row = await db.queryOneAsync<GameRow>(
        `INSERT INTO games (wikidata_id, slug, name, cover_url, logo_url, release_year, genres, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'wikidata', ?)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, genres = COALESCE(EXCLUDED.genres, games.genres)
         RETURNING ${GAME_COLUMNS}`,
        [game.wikidataId, game.slug, game.name, game.coverUrl, game.logoUrl, game.releaseYear, genres, now]
      );
      if (row) out.push(row);
      continue;
    }

    const target = existing[0];
    // Keep the old slug if the new one belongs to a different row.
    const slugTaken = existing.some((r) => r.id !== target.id && r.slug === game.slug);
    const row = await db.queryOneAsync<GameRow>(
      `UPDATE games
          SET wikidata_id = ?, slug = ?, name = ?, cover_url = ?, logo_url = ?,
              release_year = ?, genres = COALESCE(?, genres), source = 'wikidata', updated_at = ?
        WHERE id = ?
        RETURNING ${GAME_COLUMNS}`,
      [
        game.wikidataId,
        slugTaken ? target.slug : game.slug,
        game.name,
        game.coverUrl,
        game.logoUrl,
        game.releaseYear,
        genres,
        now,
        target.id,
      ]
    );
    if (row) out.push(row);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface CachedSearch {
  expiresAt: number;
  /** Game ids in result order; rows are re-read so they reflect later upserts. */
  ids: number[];
  fromIgdb: boolean;
  fromWikidata: boolean;
}

const searchCache = new Map<string, CachedSearch>();

export function clearGameSearchCache(): void {
  searchCache.clear();
}

async function rowsById(ids: number[]): Promise<GameRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.queryAsync<GameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE id = ANY(?::int[])`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is GameRow => Boolean(r));
}

export async function searchGames(rawQuery: string): Promise<GameSearchResult> {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  const cacheKey = query.toLowerCase();
  const supported = supportedSlugs();

  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const rows = await rowsById(cached.ids);
    if (rows.length === cached.ids.length) {
      return {
        games: rows.map((r) => toSummary(r, supported)),
        fromIgdb: cached.fromIgdb,
        fromWikidata: cached.fromWikidata,
      };
    }
    // A row disappeared (database reset): search again.
  }

  await ensureBuiltinGames();

  // Built-ins for installed modules come first, so the games this instance
  // can run always show, whatever the external source ranks first.
  const builtins = builtinGames().filter((g) => matchesBuiltin(g, query));
  const supportedBuiltins = builtins.filter((g) => g.integrationId);
  const otherBuiltins = builtins.filter((g) => !g.integrationId);

  // IGDB when it is configured; otherwise Wikidata, which needs no API key
  // and is the default so search works out of the box. Never both.
  let externalRows: GameRow[] = [];
  let fromIgdb = false;
  let fromWikidata = false;
  let externalAnswered = false;
  let externalFailed = false;
  try {
    const igdbResults = await searchIgdb(query, SEARCH_MAX_RESULTS);
    if (igdbResults) {
      externalAnswered = true;
      externalRows = await upsertIgdbGames(igdbResults);
      fromIgdb = externalRows.length > 0;
    } else {
      const wikidataResults = await searchWikidata(query, SEARCH_MAX_RESULTS);
      externalAnswered = true;
      externalRows = await upsertWikidataGames(wikidataResults);
      fromWikidata = externalRows.length > 0;
    }
  } catch (err) {
    externalFailed = true;
    const message =
      err instanceof IgdbError || err instanceof WikidataError ? err.message : (err as Error).message;
    log.warn(`[Games] External search failed, serving built-in games: ${message}`);
  }

  const builtinRows = await rowsBySlug(builtins.map((g) => g.slug));
  const ordered: GameRow[] = [];
  const seen = new Set<number>();
  const push = (row: GameRow | undefined) => {
    if (!row || seen.has(row.id) || ordered.length >= SEARCH_MAX_RESULTS) return;
    seen.add(row.id);
    ordered.push(row);
  };

  for (const g of supportedBuiltins) push(builtinRows.get(g.slug));
  for (const row of externalRows) push(row);
  // Without an external source (or when it failed) the popular built-ins are
  // the whole catalogue; when one answered they are already among its
  // results or not relevant.
  if (!externalAnswered) {
    for (const g of otherBuiltins) push(builtinRows.get(g.slug));
  }

  // Do not cache a failed external call, so it is retried. "Not configured"
  // is cached: saving IGDB credentials clears the cache (routes/settings.ts).
  if (!externalFailed) {
    if (searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      ids: ordered.map((r) => r.id),
      fromIgdb,
      fromWikidata,
    });
  }

  return { games: ordered.map((r) => toSummary(r, supported)), fromIgdb, fromWikidata };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** Instance-wide, not one tournament: "games people can play here right now". */
async function activeIntegrationIds(): Promise<Set<string>> {
  const tournamentGames = await db.queryAsync<{ game: string }>(
    `SELECT DISTINCT game FROM tournament WHERE status IN ('setup', 'ready', 'in_progress')`
  );
  return new Set(tournamentGames.map((r) => r.game));
}

/**
 * Built-in slugs with a tournament open or running on this instance first,
 * then the popular (non-supported) list. A supported game with no active
 * tournament is left out entirely — deliberate for the 3-item "suggestions"
 * strip: a genuinely popular title beats a supported-but-idle one there. The
 * onboarding grid needs every card instead, so it uses
 * `allBuiltinSlugsOrdered` below rather than this.
 */
async function suggestionOrderedSlugs(): Promise<string[]> {
  const builtins = builtinGames();
  const active = await activeIntegrationIds();

  return [
    ...builtins.filter((g) => g.integrationId && active.has(g.integrationId)),
    ...builtins.filter((g) => !g.integrationId),
  ].map((g) => g.slug);
}

/**
 * Every built-in slug — installed modules and the popular list — with a
 * tournament open or running on this instance first, then everything else in
 * `builtinGames()`'s own order (installed modules, then the popular list).
 * Unlike `suggestionOrderedSlugs`, a supported game is never dropped just for
 * having no tournament active right now: the onboarding grid must always
 * offer every game this instance can run.
 */
async function allBuiltinSlugsOrdered(): Promise<string[]> {
  const builtins = builtinGames();
  const active = await activeIntegrationIds();
  const isActive = (g: BuiltinGame) => !!g.integrationId && active.has(g.integrationId);

  return [...builtins.filter(isActive), ...builtins.filter((g) => !isActive(g))].map((g) => g.slug);
}

/**
 * Up to three games to offer under the search box: games with a tournament
 * open or running on this instance first, then the popular built-ins, never
 * one the viewer already picked.
 */
export async function getSuggestions(playerUid: string | null): Promise<GameSummary[]> {
  await ensureBuiltinGames();
  const supported = supportedSlugs();
  const orderedSlugs = await suggestionOrderedSlugs();

  const picked = new Set<number>(
    playerUid
      ? (
          await db.queryAsync<{ game_id: number }>(
            'SELECT game_id FROM player_games WHERE player_uid = ?',
            [playerUid]
          )
        ).map((r) => r.game_id)
      : []
  );

  const rows = await rowsBySlug(orderedSlugs);
  const out: GameSummary[] = [];
  for (const slug of orderedSlugs) {
    const row = rows.get(slug);
    if (!row || picked.has(row.id)) continue;
    out.push(toSummary(row, supported));
    if (out.length >= SUGGESTION_COUNT) break;
  }
  return out;
}

/**
 * Every built-in game (installed modules + popular esports titles), never
 * filtered by what the viewer already picked (unlike `getSuggestions`) and
 * never dropped for having no active tournament (unlike `getSuggestions`) —
 * the "/welcome/games" onboarding grid needs every card on screen, including
 * ones the viewer (in "edit" mode) already has, so it can show them selected
 * rather than hide them.
 */
export async function getPopularGames(): Promise<GameSummary[]> {
  await ensureBuiltinGames();
  const supported = supportedSlugs();
  const orderedSlugs = await allBuiltinSlugsOrdered();
  const rows = await rowsBySlug(orderedSlugs);
  return orderedSlugs
    .map((slug) => rows.get(slug))
    .filter((row): row is GameRow => Boolean(row))
    .map((row) => toSummary(row, supported));
}

// ---------------------------------------------------------------------------
// A player's games
// ---------------------------------------------------------------------------

export interface PlayerAccount {
  uid: string;
  steamId: string;
  gamesPromptDismissedAt: number | null;
}

export async function getPlayerAccountBySteamId(steamId: string): Promise<PlayerAccount | null> {
  const row = await db.queryOneAsync<{
    uid: string;
    id: string;
    games_prompt_dismissed_at: number | null;
  }>('SELECT uid, id, games_prompt_dismissed_at FROM players WHERE id = ?', [steamId]);
  if (!row) return null;
  return { uid: row.uid, steamId: row.id, gamesPromptDismissedAt: row.games_prompt_dismissed_at };
}

export async function getPlayerGames(playerUid: string): Promise<GameSummary[]> {
  const supported = supportedSlugs();
  const rows = await db.queryAsync<GameRow>(
    `SELECT ${GAME_COLUMNS.split(', ')
      .map((c) => `g.${c}`)
      .join(', ')}
       FROM player_games pg
       JOIN games g ON g.id = pg.game_id
      WHERE pg.player_uid = ?
      ORDER BY pg.created_at, g.name`,
    [playerUid]
  );
  return rows.map((r) => toSummary(r, supported));
}

export class UnknownGameIdsError extends Error {
  constructor(public readonly ids: number[]) {
    super(`Unknown game id(s): ${ids.join(', ')}`);
    this.name = 'UnknownGameIdsError';
  }
}

/**
 * Replace the player's games. Also marks the "What do you play?" prompt as
 * answered, so saving (even an empty list) stops it from showing again.
 */
export async function setPlayerGames(playerUid: string, gameIds: number[]): Promise<GameSummary[]> {
  const ids = [...new Set(gameIds)];
  if (ids.length > 0) {
    const found = await db.queryAsync<{ id: number }>(
      'SELECT id FROM games WHERE id = ANY(?::int[])',
      [ids]
    );
    const known = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) throw new UnknownGameIdsError(missing);
  }

  const now = Math.floor(Date.now() / 1000);
  // One statement, so the delete and insert apply together.
  await db.runAsync(
    `WITH removed AS (
       DELETE FROM player_games
        WHERE player_uid = ?::uuid AND NOT (game_id = ANY(?::int[]))
     ),
     added AS (
       INSERT INTO player_games (player_uid, game_id, created_at)
       SELECT ?::uuid, g.id, ? + g.ord::int
         FROM unnest(?::int[]) WITH ORDINALITY AS g(id, ord)
       ON CONFLICT (player_uid, game_id) DO NOTHING
     )
     UPDATE players SET games_prompt_dismissed_at = COALESCE(games_prompt_dismissed_at, ?)
      WHERE uid = ?::uuid`,
    [playerUid, ids, playerUid, now, ids, now, playerUid]
  );

  return getPlayerGames(playerUid);
}

export async function dismissGamesPrompt(playerUid: string): Promise<void> {
  await db.runAsync(
    'UPDATE players SET games_prompt_dismissed_at = COALESCE(games_prompt_dismissed_at, ?) WHERE uid = ?::uuid',
    [Math.floor(Date.now() / 1000), playerUid]
  );
}
