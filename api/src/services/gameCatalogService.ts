/**
 * The player game catalogue: "What do you play?".
 *
 * Games live in the `games` table. Rows come from two places:
 * - **built-in**: every game an installed integration supports, then a short
 *   list of popular esports titles. Names and slugs only. Seeded on demand
 *   (one idempotent insert) so they always exist, with or without IGDB.
 * - **IGDB**: search results are upserted by IGDB id / slug, so repeat queries
 *   and chips render from our own table.
 *
 * Built-in slugs are IGDB slugs, so an IGDB result for Rocket League updates
 * the built-in Rocket League row rather than adding a second one.
 *
 * `supported` means a game module exists for it (the integration registry),
 * i.e. this instance can run tournaments for it.
 */

import { db } from '../config/database';
import { listIntegrations } from '../integrations/registry';
import { log } from '../utils/logger';
import { IgdbError, searchIgdb, type IgdbGame } from './igdbService';

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
}

export interface GameSearchResult {
  games: GameSummary[];
  /** True when any result came from IGDB (the client shows the IGDB credit). */
  fromIgdb: boolean;
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

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
  slug: string;
  name: string;
  cover_url: string | null;
  logo_url: string | null;
  release_year: number | null;
  source: string;
}

const GAME_COLUMNS = 'id, igdb_id, slug, name, cover_url, logo_url, release_year, source';

function toSummary(row: GameRow, supported: Map<string, string>): GameSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    coverUrl: row.cover_url,
    releaseYear: row.release_year,
    supported: supported.has(row.slug),
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
async function upsertIgdbGames(games: IgdbGame[]): Promise<GameRow[]> {
  const out: GameRow[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const game of games) {
    const existing = await db.queryAsync<GameRow>(
      `SELECT ${GAME_COLUMNS} FROM games WHERE igdb_id = ? OR slug = ? ORDER BY (igdb_id = ?) DESC NULLS LAST`,
      [game.igdbId, game.slug, game.igdbId]
    );

    if (existing.length === 0) {
      const row = await db.queryOneAsync<GameRow>(
        `INSERT INTO games (igdb_id, slug, name, cover_url, logo_url, release_year, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'igdb', ?)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING ${GAME_COLUMNS}`,
        [game.igdbId, game.slug, game.name, game.coverUrl, game.logoUrl, game.releaseYear, now]
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
              release_year = ?, source = 'igdb', updated_at = ?
        WHERE id = ?
        RETURNING ${GAME_COLUMNS}`,
      [
        game.igdbId,
        slugTaken ? target.slug : game.slug,
        game.name,
        game.coverUrl,
        game.logoUrl,
        game.releaseYear,
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
      return { games: rows.map((r) => toSummary(r, supported)), fromIgdb: cached.fromIgdb };
    }
    // A row disappeared (database reset): search again.
  }

  await ensureBuiltinGames();

  // Built-ins for installed modules come first, so the games this instance
  // can run always show, whatever IGDB ranks first.
  const builtins = builtinGames().filter((g) => matchesBuiltin(g, query));
  const supportedBuiltins = builtins.filter((g) => g.integrationId);
  const otherBuiltins = builtins.filter((g) => !g.integrationId);

  let igdbRows: GameRow[] = [];
  let fromIgdb = false;
  let igdbAnswered = false;
  let igdbFailed = false;
  try {
    const results = await searchIgdb(query, SEARCH_MAX_RESULTS);
    if (results) {
      igdbAnswered = true;
      igdbRows = await upsertIgdbGames(results);
      fromIgdb = igdbRows.length > 0;
    }
  } catch (err) {
    igdbFailed = true;
    const message = err instanceof IgdbError ? err.message : (err as Error).message;
    log.warn(`[IGDB] Search failed, serving built-in games: ${message}`);
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
  for (const row of igdbRows) push(row);
  // Without IGDB (or when it failed) the popular built-ins are the whole
  // catalogue; with IGDB they are already among its results or not relevant.
  if (!igdbAnswered) {
    for (const g of otherBuiltins) push(builtinRows.get(g.slug));
  }

  // Do not cache a failed IGDB call, so it is retried. "Not configured" is
  // cached: saving credentials clears the cache (routes/settings.ts).
  if (!igdbFailed) {
    if (searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      ids: ordered.map((r) => r.id),
      fromIgdb,
    });
  }

  return { games: ordered.map((r) => toSummary(r, supported)), fromIgdb };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Up to three games to offer under the search box: games with a tournament
 * open or running on this instance first, then the popular built-ins, never
 * one the viewer already picked.
 */
export async function getSuggestions(playerUid: string | null): Promise<GameSummary[]> {
  await ensureBuiltinGames();
  const supported = supportedSlugs();
  const builtins = builtinGames();

  // Instance-wide, not one tournament: "games people can play here right now".
  const tournamentGames = await db.queryAsync<{ game: string }>(
    `SELECT DISTINCT game FROM tournament WHERE status IN ('setup', 'ready', 'in_progress')`
  );
  const activeIntegrationIds = new Set(tournamentGames.map((r) => r.game));

  const orderedSlugs = [
    ...builtins.filter((g) => g.integrationId && activeIntegrationIds.has(g.integrationId)),
    ...builtins.filter((g) => !g.integrationId),
  ].map((g) => g.slug);

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
