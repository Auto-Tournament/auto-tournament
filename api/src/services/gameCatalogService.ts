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
import {
  bundledIgdbId,
  hasBundledAppIcon,
  installedPacks,
  packAppIconPath,
  packAppIconUrl,
  packIconPath,
} from './gamePackService';
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
  /**
   * The installed module that would run a tournament for this game, or null
   * when none would. `supported` is the same fact as a boolean; the id is what
   * a caller needs to know *which* module — the tournament setup wizard asks,
   * because a CS2 tournament and a manually reported one are set up
   * differently (3.0 phase D, PR D9).
   */
  integrationId: string | null;
  /** Where this row's data came from; the client uses it to pick a credit line. */
  source: 'igdb' | 'wikidata' | 'builtin';
  /** Up to 3 genre names, from IGDB `genres.name` or Wikidata P136. */
  genres: string[];
  /** `coverUrl` if present, else `logoUrl`; convenience for the onboarding page's cards. */
  imageUrl: string | null;
  /**
   * The game's square app icon — the picture on a player's phone or launcher
   * — or null when there is none, and the pill draws the game's monogram.
   *
   * The module's or pack's own (installed, or in the image's snapshot) for
   * any row linked to one — by IGDB id, then slug, then a slug alias, then
   * the normalised name (`linkBuiltin`) — else the Steam client icon this
   * instance fetched and cached for the game (`gameIconService`). Never a
   * cover or a wide logo.
   */
  appIconUrl: string | null;
}

export interface GameSearchResult {
  games: GameSummary[];
  /** True when any result came from IGDB (the client shows the IGDB credit). */
  fromIgdb: boolean;
  /** True when any result came from Wikidata (the client shows the Wikidata credit). */
  fromWikidata: boolean;
}

export interface BuiltinGame {
  slug: string;
  name: string;
  aliases: string[];
  /** Integration id when an installed module runs this game. */
  integrationId: string | null;
  /**
   * The only module that runs it is one that runs anything (manual-report,
   * `runsAnyCatalogGame`), rather than a module written for this game. The
   * game is supported either way; the suggestions strip treats it as an
   * ordinary popular title, because "a module exists for it" says nothing
   * about this game when the module says it about every game.
   */
  viaCatchAll: boolean;
  /**
   * The module's own catalogue entry (CS2's row for Counter-Strike 2) rather
   * than an extra title it ships. Such a game is stored on a tournament under
   * the integration's id, which is what the `game` column has always held for
   * it; everything else is stored under its catalogue slug.
   */
  own: boolean;
  /**
   * The module's own square tile for this game (`GameCatalogEntry.icon`), or
   * null for a popular title no module ships art for. Never the catalogue's
   * IGDB or Wikidata artwork — that is a different picture answering a
   * different question, and `GameSummary.imageUrl` still carries it.
   */
  icon: string | null;
  /** The game's square app icon, as a URL the client loads, or null. */
  appIcon: string | null;
  /**
   * The game's numeric IGDB id, when the module or pack names one (or the
   * image's snapshot does for the pack's game). What an IGDB search result
   * is linked to it by first.
   */
  igdbId: number | null;
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
  { slug: 'fortnite', name: 'Fortnite' },
  { slug: 'apex-legends', name: 'Apex Legends' },
  { slug: 'pubg-battlegrounds', name: 'PUBG: Battlegrounds', aliases: ['pubg'] },
  { slug: 'starcraft-ii', name: 'StarCraft II', aliases: ['sc2'] },
  { slug: 'mobile-legends-bang-bang', name: 'Mobile Legends: Bang Bang', aliases: ['mlbb'] },
  { slug: 'teamfight-tactics', name: 'Teamfight Tactics', aliases: ['tft'] },
  { slug: 'marvel-rivals', name: 'Marvel Rivals' },
];

export { slugify };

/** Lowercase, alphanumerics only: "Counter-Strike 2" and "counter strike2" match. */
function searchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Installed integrations first, then imported game packs, then the popular
 * list; one entry per slug.
 *
 * An integration contributes its own entry (`catalog`, named after the module,
 * which is the game for CS2) and every extra title it ships
 * (`catalogEntries`, the manual-report module). First claim wins, so a slug an
 * earlier integration already took is left with that integration, and a
 * popular title a module ships is that module's row rather than an
 * unsupported one.
 */
export function builtinGames(): BuiltinGame[] {
  const out: BuiltinGame[] = [];
  const seen = new Set<string>();

  const add = (game: BuiltinGame): void => {
    if (seen.has(game.slug)) return;
    seen.add(game.slug);
    out.push(game);
  };

  for (const integration of listIntegrations()) {
    const viaCatchAll = integration.runsAnyCatalogGame === true;
    if (integration.catalog !== null) {
      add({
        slug: integration.catalog?.slug || slugify(integration.displayName),
        name: integration.displayName,
        aliases: [integration.id, ...(integration.catalog?.aliases ?? [])],
        integrationId: integration.id,
        viaCatchAll,
        own: true,
        icon: integration.catalog?.icon ?? null,
        appIcon: integration.catalog?.appIcon ?? null,
        igdbId: integration.catalog?.igdbId ?? null,
      });
    }
    for (const entry of integration.catalogEntries ?? []) {
      add({
        slug: entry.slug,
        name: entry.name || integration.displayName,
        aliases: entry.aliases ?? [],
        integrationId: integration.id,
        viaCatchAll,
        own: false,
        icon: entry.icon ?? null,
        appIcon: entry.appIcon ?? null,
        igdbId: entry.igdbId ?? null,
      });
    }
  }

  // Then the games installed as packs — every game but a module's own, since
  // 3.0 ships no game list in code. After the modules, so a pack can never
  // take a slug a module ships; before the popular list, so an installed game
  // reads as supported rather than as a title nothing runs.
  //
  // In popularity order where the game is a popular title, then by name.
  // `installedPacks()` sorts by name, which is right for the Modules page and
  // wrong here: this order is the suggestions strip's, and "What do you play?"
  // should open on Rocket League, not on Age of Empires II.
  const popularRank = new Map(POPULAR_GAMES.map((game, rank) => [game.slug, rank]));
  const packs = [...installedPacks()].sort(
    (a, b) =>
      (popularRank.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
        (popularRank.get(b.slug) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
  );
  for (const pack of packs) {
    add({
      slug: pack.slug,
      name: pack.name,
      aliases: pack.definition.aliases ?? [],
      integrationId: pack.engine,
      // A pack runs on a module that runs anything, which is exactly what
      // `viaCatchAll` says: supported, but not a module written for it.
      viaCatchAll: true,
      own: false,
      icon: pack.hasIcon ? packIconPath(pack.slug) : null,
      // The pack's own, else the snapshot's for the same game — also for a
      // pack installed from the catalog before its game had one.
      appIcon: packAppIconUrl(pack),
      igdbId: pack.definition.igdbId ?? bundledIgdbId(pack.slug),
    });
  }

  for (const game of POPULAR_GAMES) {
    add({
      slug: game.slug,
      name: game.name,
      aliases: game.aliases ?? [],
      integrationId: null,
      viaCatchAll: false,
      own: false,
      icon: null,
      // A popular title nothing installed runs still has its picture when the
      // image's snapshot carries one: the pill is about recognising a game,
      // not about whether this instance can run it.
      appIcon: hasBundledAppIcon(game.slug) ? packAppIconPath(game.slug) : null,
      igdbId: bundledIgdbId(game.slug),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Linking a stored game to the module or pack for the same game
// ---------------------------------------------------------------------------

/**
 * The built-in list, indexed the ways a stored `games` row is matched to it.
 * First claim wins in every map, so a module beats a pack beats a popular
 * title, as everywhere else in the catalogue.
 */
export interface GameLinks {
  byIgdbId: Map<number, BuiltinGame>;
  bySlug: Map<string, BuiltinGame>;
  /** A built-in's aliases, slugified: 'cs2' finds Counter-Strike 2. */
  byAlias: Map<string, BuiltinGame>;
  /** A built-in's name, lower case letters and digits only. */
  byName: Map<string, BuiltinGame>;
}

export function buildGameLinks(builtins: BuiltinGame[] = builtinGames()): GameLinks {
  const links: GameLinks = {
    byIgdbId: new Map(),
    bySlug: new Map(),
    byAlias: new Map(),
    byName: new Map(),
  };
  const claim = <K>(map: Map<K, BuiltinGame>, key: K | null, game: BuiltinGame) => {
    if (key === null || key === '' || map.has(key)) return;
    map.set(key, game);
  };
  for (const game of builtins) {
    claim(links.byIgdbId, game.igdbId, game);
    claim(links.bySlug, game.slug, game);
    for (const alias of game.aliases) claim(links.byAlias, slugify(alias), game);
    claim(links.byName, searchKey(game.name), game);
  }
  return links;
}

/** The fields of a stored game that link it to a built-in. */
export interface LinkableGame {
  igdb_id: number | null;
  slug: string;
  name: string;
}

/**
 * The module or pack a stored game is, or null: by IGDB id, then its own
 * slug, then a built-in's slug alias, then its name once case and
 * punctuation are gone.
 *
 * An alias or a name is a weaker claim than an id, and plenty of games share
 * a name ("Deadlock" is a 2016 game and Valve's hero shooter). So when both
 * sides know their IGDB id and the ids differ, a slug alias or name match is
 * refused: the row is a different game that happens to be called the same.
 * The exact slug always links — that row is the built-in's own catalogue row.
 */
export function linkBuiltin(row: LinkableGame, links: GameLinks): BuiltinGame | null {
  const igdbId = row.igdb_id ?? null;
  if (igdbId !== null) {
    const byId = links.byIgdbId.get(igdbId);
    if (byId) return byId;
  }
  const own = links.bySlug.get(row.slug);
  if (own) return own;
  const differentGame = (game: BuiltinGame) =>
    igdbId !== null && game.igdbId !== null && game.igdbId !== igdbId;
  const alias = links.byAlias.get(row.slug);
  if (alias && !differentGame(alias)) return alias;
  const named = links.byName.get(searchKey(row.name));
  if (named && !differentGame(named)) return named;
  return null;
}

/**
 * The app icon a stored game's pill draws, or null for its monogram: the
 * linked module's or pack's, else the one this instance cached for the game.
 */
export function gameAppIconUrl(
  row: LinkableGame & { icon_url?: string | null },
  links: GameLinks
): string | null {
  return linkBuiltin(row, links)?.appIcon ?? row.icon_url ?? null;
}

/** What `toSummary` needs from the built-in list, read once per request. */
interface SummaryContext {
  /** Slug -> the integration that runs it. */
  supported: Map<string, string>;
  links: GameLinks;
}

function supportedSlugs(): SummaryContext {
  const builtins = builtinGames();
  const supported = new Map<string, string>();
  for (const game of builtins) {
    if (game.integrationId) supported.set(game.slug, game.integrationId);
  }
  return { supported, links: buildGameLinks(builtins) };
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
  icon_url: string | null;
}

const GAME_COLUMNS =
  'id, igdb_id, wikidata_id, slug, name, cover_url, logo_url, release_year, genres, source, icon_url';

function parseGenres(genres: string | null): string[] {
  if (!genres) return [];
  try {
    const parsed = JSON.parse(genres);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(row: GameRow, context: SummaryContext): GameSummary {
  const { supported, links } = context;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    coverUrl: row.cover_url,
    releaseYear: row.release_year,
    supported: supported.has(row.slug),
    integrationId: supported.get(row.slug) ?? null,
    source: row.source === 'igdb' || row.source === 'wikidata' ? row.source : 'builtin',
    genres: parseGenres(row.genres),
    imageUrl: row.cover_url || row.logo_url || null,
    appIconUrl: gameAppIconUrl(row, links),
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
        `INSERT INTO games (igdb_id, slug, name, cover_url, logo_url, release_year, genres, steam_app_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'igdb', ?)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, genres = COALESCE(EXCLUDED.genres, games.genres),
           steam_app_id = COALESCE(EXCLUDED.steam_app_id, games.steam_app_id)
         RETURNING ${GAME_COLUMNS}`,
        [
          game.igdbId,
          game.slug,
          game.name,
          game.coverUrl,
          game.logoUrl,
          game.releaseYear,
          genres,
          game.steamAppId,
          now,
        ]
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
              release_year = ?, genres = COALESCE(?, genres),
              steam_app_id = COALESCE(?, steam_app_id), source = 'igdb', updated_at = ?
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
        game.steamAppId,
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
        `INSERT INTO games (wikidata_id, slug, name, cover_url, logo_url, release_year, genres, steam_app_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wikidata', ?)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, genres = COALESCE(EXCLUDED.genres, games.genres),
           steam_app_id = COALESCE(EXCLUDED.steam_app_id, games.steam_app_id)
         RETURNING ${GAME_COLUMNS}`,
        [
          game.wikidataId,
          game.slug,
          game.name,
          game.coverUrl,
          game.logoUrl,
          game.releaseYear,
          genres,
          game.steamAppId,
          now,
        ]
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
              release_year = ?, genres = COALESCE(?, genres),
              steam_app_id = COALESCE(?, steam_app_id), source = 'wikidata', updated_at = ?
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
        game.steamAppId,
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

/**
 * Instance-wide, not one tournament: "games people can play here right now".
 *
 * The values are `tournament.game` as stored, which is an integration id on
 * rows written before 3.0 phase D ('cs2') and a catalogue id after it
 * ('rocket-league'), because a module like manual-report runs many games. So
 * a built-in matches on either its slug or its integration id.
 */
async function activeGameRefs(): Promise<Set<string>> {
  const tournamentGames = await db.queryAsync<{ game: string }>(
    `SELECT DISTINCT game FROM tournament WHERE status IN ('setup', 'ready', 'in_progress')`
  );
  return new Set(tournamentGames.filter((r) => r.game).map((r) => r.game.toLowerCase()));
}

function isActiveIn(active: ReadonlySet<string>, game: BuiltinGame): boolean {
  if (active.has(game.slug)) return true;
  return !!game.integrationId && active.has(game.integrationId);
}

/**
 * Built-in slugs with a tournament open or running on this instance first,
 * then the ordinary popular list. A game with a module of its own and no
 * active tournament is left out entirely — deliberate for the 3-item
 * "suggestions" strip: a genuinely popular title beats a supported-but-idle
 * one there.
 *
 * "A module of its own" is the point: a game only supported because a
 * catch-all module runs anything (`viaCatchAll`) is an ordinary popular title
 * here, otherwise installing manual-report would empty the strip, since
 * every built-in would then be supported.
 *
 * The onboarding grid needs every card instead, so it uses
 * `allBuiltinSlugsOrdered` below rather than this.
 */
async function suggestionOrderedSlugs(): Promise<string[]> {
  const builtins = builtinGames();
  const active = await activeGameRefs();

  return [
    ...builtins.filter((g) => isActiveIn(active, g)),
    ...builtins.filter((g) => !isActiveIn(active, g) && (!g.integrationId || g.viaCatchAll)),
  ].map((g) => g.slug);
}

/**
 * Every built-in slug — installed modules, imported packs and the popular
 * list — with a
 * tournament open or running on this instance first, then everything else in
 * `builtinGames()`'s own order (installed modules, then the popular list).
 * Unlike `suggestionOrderedSlugs`, a supported game is never dropped just for
 * having no tournament active right now: the onboarding grid must always
 * offer every game this instance can run.
 */
async function allBuiltinSlugsOrdered(): Promise<string[]> {
  const builtins = builtinGames();
  const active = await activeGameRefs();
  const isActive = (g: BuiltinGame) => isActiveIn(active, g);

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

/** A playable game, plus the value to store on the tournament that runs it. */
export interface PlayableGame extends GameSummary {
  /**
   * What `tournament.game` is set to for this game. The catalogue slug, except
   * for a module's own game (Counter-Strike 2), which keeps the module id the
   * column has held for it since before it could hold a slug. `resolveGameRef`
   * normalizes either spelling to this.
   */
  gameRef: string;
  /**
   * The module's own square tile for this game, or null when it ships none.
   *
   * The setup wizard's list is what this instance can run, so it is drawn
   * with the modules' art: square, full-bleed, one palette. `imageUrl` (the
   * catalogue's IGDB or Wikidata picture) is still on the summary and is
   * still what the player-facing "What do you play?" surfaces use — those
   * cover every game, not only the ones a module runs, and a player has to
   * recognise their own game by its real logo.
   *
   * Null means the wizard shows the game's text mark.
   */
  moduleIcon: string | null;
}

/**
 * Every game this instance can create a tournament for: the built-in list,
 * minus the popular titles no installed module runs (3.0 phase D, PR D9).
 *
 * This is what the tournament setup wizard's "Game" step offers. It is not
 * everything a module *could* run — `runsAnyCatalogGame` means manual
 * reporting answers for any catalogue id, including one found through IGDB
 * search — but a list an organizer can pick from without searching, which is
 * what a wizard step is.
 */
export async function getPlayableGames(): Promise<PlayableGame[]> {
  const games = await getPopularGames();
  const builtins = builtinGames();
  const refs = new Map(
    builtins.map((g) => [g.slug, g.own && g.integrationId ? g.integrationId : g.slug])
  );
  const icons = new Map(builtins.map((g) => [g.slug, g.icon]));
  return games
    .filter((game) => game.integrationId !== null)
    .map((game) => ({
      ...game,
      gameRef: refs.get(game.slug) ?? game.slug,
      moduleIcon: icons.get(game.slug) ?? null,
    }));
}

/**
 * The canonical `tournament.game` value for a game reference, or null when
 * this instance has no such game.
 *
 * Takes a built-in slug or alias ('rl'), an integration id ('cs2'), or the
 * slug of any `games` row IGDB or Wikidata search has added. Returns the
 * canonical slug to store, so a tournament row never holds an alias — the
 * registry resolves those, but two rows for one game would read as two games
 * everywhere else.
 *
 * It deliberately does *not* accept anything the registry would resolve:
 * `runsAnyCatalogGame` answers for every string, so without this check a typo
 * would create a tournament for a game nobody has heard of.
 */
export async function resolveGameRef(ref: string): Promise<string | null> {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) return null;

  for (const game of builtinGames()) {
    if (game.slug !== wanted && !game.aliases.some((a) => a.toLowerCase() === wanted)) continue;
    // A module's own game keeps the module's id ('cs2'), the value the column
    // has held since before it could hold a catalogue slug.
    return game.own && game.integrationId ? game.integrationId : game.slug;
  }

  const row = await db.queryOneAsync<{ slug: string }>('SELECT slug FROM games WHERE slug = ?', [
    wanted,
  ]);
  return row?.slug ?? null;
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
