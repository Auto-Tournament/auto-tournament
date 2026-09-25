/**
 * Built-in game enrichment: gives the built-in catalogue rows (installed game
 * modules + the popular esports list in `gameCatalogService`) a real image,
 * release year and genres, instead of the bare name/slug `ensureBuiltinGames`
 * seeds them with.
 *
 * Wikidata is the source for all three, looked up by a known QID (verified by
 * hand against https://www.wikidata.org/wiki/Special:EntityData/<QID>.json —
 * see `BUILTIN_WIKIDATA_QIDS` below), never by a fuzzy search: a built-in's
 * identity must not drift because a search matched the wrong entity. When
 * IGDB credentials are configured, its cover is preferred over Wikidata's
 * (matched by exact, case-insensitive name — the top hit only counts when it
 * is an exact match, so a fuzzy near-miss never gets attached to a built-in).
 *
 * Runs once at API startup, after the server is listening, and is never on
 * the request path: `index.ts` fires it and does not await it. A row already
 * enriched within `ENRICH_INTERVAL_MS` is left alone; a failed lookup leaves
 * `enriched_at` untouched so the next start retries it. Both external clients
 * already point at the E2E fakes when a test overrides them (see
 * `setIgdbEndpointOverride` / `setWikidataEndpointOverride`), so this reuses
 * them rather than calling the network directly — but even so, it is always
 * disabled in CI (see `enrichmentDisabled`), since a fake can still be
 * mid-setup when this fires right after startup.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { searchIgdb, type IgdbGame } from './igdbService';
import { getWikidataBuiltinInfo } from './wikidataService';
import { ensureBuiltinGames } from './gameCatalogService';

/** Re-enrich a builtin at most this often. */
const ENRICH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Built-in slug -> verified Wikidata QID. Verified by fetching
 * `https://www.wikidata.org/wiki/Special:EntityData/<QID>.json` and checking
 * the English label and that P31 (instance of) includes Q7889 (video game) —
 * except `chess`, a board game (P31 does not include Q7889 there on purpose).
 */
export const BUILTIN_WIKIDATA_QIDS: Record<string, string> = {
  'counter-strike-2': 'Q111165107',
  'rocket-league': 'Q20031743',
  valorant: 'Q86919275',
  'league-of-legends': 'Q223341',
  'dota-2': 'Q771541',
  trackmania: 'Q91573142',
  chess: 'Q718',
  'overwatch-2': 'Q73163646',
  'ea-sports-fc-25': 'Q127162066',
  'super-smash-bros-ultimate': 'Q54093632',
  'street-fighter-6': 'Q110999026',
  'tekken-8': 'Q105486599',
  osu: 'Q307441',
  'team-fortress-2': 'Q382108',
  'age-of-empires-ii': 'Q34852',
};

interface StaleBuiltinRow {
  id: number;
  slug: string;
  name: string;
}

/** NODE_ENV=test, or the explicit `GAMES_ENRICH=off` escape hatch (set in CI). */
export function enrichmentDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const flag = (process.env.GAMES_ENRICH || '').trim().toLowerCase();
  return flag === 'off' || flag === 'false' || flag === '0';
}

async function staleBuiltinRows(): Promise<StaleBuiltinRow[]> {
  const slugs = Object.keys(BUILTIN_WIKIDATA_QIDS);
  if (slugs.length === 0) return [];
  const cutoff = Math.floor((Date.now() - ENRICH_INTERVAL_MS) / 1000);
  return db.queryAsync<StaleBuiltinRow>(
    `SELECT id, slug, name FROM games
      WHERE source = 'builtin' AND slug = ANY(?::text[])
        AND (enriched_at IS NULL OR enriched_at < ?)`,
    [slugs, cutoff]
  );
}

/** The top IGDB result for `name`, only when it is an exact (case-insensitive) name match. */
async function exactIgdbMatch(name: string): Promise<IgdbGame | null> {
  try {
    const results = await searchIgdb(name, 5);
    if (!results) return null; // not configured
    return results.find((g) => g.name.toLowerCase() === name.toLowerCase()) ?? null;
  } catch (err) {
    log.warn(`[Games] IGDB lookup failed while enriching "${name}": ${(err as Error).message}`);
    return null;
  }
}

async function enrichRow(
  row: StaleBuiltinRow,
  wikidata: Map<string, { imageUrl: string | null; releaseYear: number | null; genres: string[] }>
): Promise<void> {
  const qid = BUILTIN_WIKIDATA_QIDS[row.slug];
  const info = qid ? wikidata.get(qid) : undefined;
  if (!info) {
    // The batched Wikidata call answered with nothing for this id — nothing
    // to store, and no reason to believe a retry next start would differ, but
    // leaving enriched_at untouched costs nothing and keeps retrying it.
    return;
  }

  const igdbMatch = await exactIgdbMatch(row.name);

  const coverUrl = igdbMatch?.coverUrl ?? info.imageUrl;
  const logoUrl = igdbMatch?.logoUrl ?? info.imageUrl;
  const genres = igdbMatch?.genres.length ? igdbMatch.genres : info.genres;
  // `info` only exists here because the Wikidata batch answered for this QID
  // (see the `!info` guard above), so at least the wikidata_id association is
  // always real, even on the rare title with neither an image nor a genre.
  const source = igdbMatch ? 'igdb' : 'wikidata';
  const now = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `UPDATE games
        SET cover_url = COALESCE(?, cover_url),
            logo_url = COALESCE(?, logo_url),
            release_year = COALESCE(release_year, ?),
            genres = COALESCE(?, genres),
            wikidata_id = COALESCE(wikidata_id, ?),
            igdb_id = COALESCE(?, igdb_id),
            source = ?,
            enriched_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      coverUrl,
      logoUrl,
      info.releaseYear,
      genres.length > 0 ? JSON.stringify(genres.slice(0, 3)) : null,
      qid,
      igdbMatch?.igdbId ?? null,
      source,
      now,
      now,
      row.id,
    ]
  );
}

// ---------------------------------------------------------------------------
// Re-resolving Wikidata rows against IGDB
// ---------------------------------------------------------------------------

/** Try a row against IGDB again at most this often when it found nothing. */
const IGDB_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
/** Rows per pass; the rest wait for the next start or the next credentials save. */
const IGDB_RESOLVE_BATCH = 60;
/** IGDB allows 4 requests a second; stay well under it. */
const IGDB_RESOLVE_GAP_MS = 350;

interface UnresolvedRow {
  id: number;
  slug: string;
  name: string;
}

/** Lowercase letters and digits only — the same key search matches built-ins by. */
function matchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The IGDB game a stored row is, or null. Search's own rule: the same slug, or
 * the same name once case and punctuation are dropped ("Counter-Strike 2" and
 * "Counter Strike 2"). A near miss is never attached — a wrong cover on
 * somebody's saved game is worse than none.
 */
export function pickIgdbMatch(row: { slug: string; name: string }, results: IgdbGame[]): IgdbGame | null {
  return (
    results.find((game) => game.slug === row.slug) ??
    results.find((game) => matchKey(game.name) === matchKey(row.name)) ??
    null
  );
}

let resolving: Promise<number> | null = null;

/**
 * Give games stored before IGDB was configured their IGDB identity and cover.
 *
 * A game picked while search ran on Wikidata (the keyless default) is stored
 * with Wikidata's picture, which is the game's wide wordmark — right on a
 * wide card, unreadable in a 20 px pill. Once an admin adds IGDB credentials
 * those rows would keep that picture for good: search only upserts what it
 * returns, and the built-in enrichment only looks at rows it has never seen.
 * This walks them — the ones players have picked first — and attaches the
 * IGDB match, if there is an exact one, keeping the row's id and slug so no
 * saved game or tournament moves.
 *
 * Background only, rate-limited, never throws. Returns how many rows gained
 * an IGDB match. One pass at a time; a second call joins the running one.
 */
export function resolveStoredGamesAgainstIgdb(): Promise<number> {
  if (resolving) return resolving;
  resolving = (async () => {
    try {
      return await resolvePass();
    } catch (err) {
      log.warn(`[Games] IGDB re-resolve failed, will retry: ${(err as Error).message}`);
      return 0;
    } finally {
      resolving = null;
    }
  })();
  return resolving;
}

async function resolvePass(): Promise<number> {
  if (enrichmentDisabled()) return 0;
  const cutoff = Math.floor((Date.now() - IGDB_RECHECK_MS) / 1000);
  const rows = await db.queryAsync<UnresolvedRow>(
    `SELECT g.id, g.slug, g.name FROM games g
      WHERE g.igdb_id IS NULL AND g.source IN ('wikidata', 'builtin')
        AND (g.igdb_checked_at IS NULL OR g.igdb_checked_at < ?)
      ORDER BY EXISTS (SELECT 1 FROM player_games pg WHERE pg.game_id = g.id) DESC, g.id
      LIMIT ?`,
    [cutoff, IGDB_RESOLVE_BATCH]
  );
  if (rows.length === 0) return 0;

  let matched = 0;
  for (const [index, row] of rows.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, IGDB_RESOLVE_GAP_MS));
    let results: IgdbGame[] | null;
    try {
      results = await searchIgdb(row.name, 5);
    } catch (err) {
      // IGDB is down or refusing: stop the pass, leave the rest unchecked.
      log.warn(`[Games] IGDB re-resolve stopped at "${row.name}": ${(err as Error).message}`);
      break;
    }
    if (!results) return matched; // not configured (or just removed)

    const now = Math.floor(Date.now() / 1000);
    const match = pickIgdbMatch(row, results);
    if (!match) {
      await db.runAsync('UPDATE games SET igdb_checked_at = ? WHERE id = ?', [now, row.id]);
      continue;
    }
    // Another row may already hold this IGDB id (search stored the IGDB
    // spelling of the same game). The id is unique, so this row takes the
    // cover and stays itself; the two are merged by nobody, but both draw.
    const taken = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM games WHERE igdb_id = ? AND id <> ?',
      [match.igdbId, row.id]
    );
    await db.runAsync(
      `UPDATE games
          SET igdb_id = COALESCE(?, igdb_id),
              cover_url = COALESCE(?, cover_url),
              release_year = COALESCE(release_year, ?),
              genres = COALESCE(genres, ?),
              source = 'igdb',
              igdb_checked_at = ?,
              updated_at = ?
        WHERE id = ?`,
      [
        taken ? null : match.igdbId,
        match.coverUrl,
        match.releaseYear,
        match.genres.length > 0 ? JSON.stringify(match.genres.slice(0, 3)) : null,
        now,
        now,
        row.id,
      ]
    );
    matched += 1;
  }
  if (matched > 0) log.info(`[Games] Matched ${matched} stored game(s) to IGDB`);
  return matched;
}

/**
 * Enrich every stale built-in (never enriched, or last enriched more than 7
 * days ago) from Wikidata (and IGDB, when configured, for the cover). Safe to
 * call from the request path or startup: it never throws — failures are
 * logged and simply retried next start.
 */
export async function enrichBuiltinGames(): Promise<void> {
  if (enrichmentDisabled()) {
    log.debug('[Games] Built-in enrichment disabled (NODE_ENV=test or GAMES_ENRICH=off)');
    return;
  }

  try {
    await ensureBuiltinGames();
    const stale = await staleBuiltinRows();
    if (stale.length === 0) return;

    const qids = [...new Set(stale.map((r) => BUILTIN_WIKIDATA_QIDS[r.slug]).filter(Boolean))];
    log.info(`[Games] Enriching ${stale.length} built-in game(s) from Wikidata`);

    // One or two Wikidata requests for the whole batch (see
    // getWikidataBuiltinInfo); if that itself fails (network/HTTP), nothing
    // is marked enriched and every row is retried next start.
    const wikidata = await getWikidataBuiltinInfo(qids);

    for (const row of stale) {
      try {
        await enrichRow(row, wikidata);
      } catch (err) {
        log.warn(`[Games] Failed to enrich built-in game "${row.slug}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log.warn(`[Games] Built-in game enrichment failed, will retry next start: ${(err as Error).message}`);
  }
}
