/**
 * Built-in game enrichment: gives the built-in catalogue rows (installed game
 * modules + the popular esports list in `gameCatalogService`) a real image,
 * release year and genres, instead of the bare name/slug `ensureBuiltinGames`
 * seeds them with.
 *
 * Wikidata is the source for all three, looked up by a pinned QID
 * (`builtinGameIdentity`), never by a fuzzy search: a built-in's identity
 * must not drift because a search matched the wrong entity.
 *
 * Runs once at API startup, after the server is listening, and is never on
 * the request path: `index.ts` fires it and does not await it. A row already
 * enriched within `ENRICH_INTERVAL_MS` is left alone — unless its stored
 * `wikidata_id` is not its pinned QID (a same-named game a search filled it
 * with before searches were kept off built-ins), which is re-enriched right
 * away and has every Wikidata field replaced. A failed lookup leaves
 * `enriched_at` untouched so the next start retries it. The Wikidata client
 * already points at the E2E fake when a test overrides it (see
 * `setWikidataEndpointOverride`), so this reuses it rather than calling the
 * network directly — but even so, it is always disabled in CI (see
 * `enrichmentDisabled`), since a fake can still be mid-setup when this fires
 * right after startup.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { getWikidataBuiltinInfo, type WikidataBuiltinInfo } from './wikidataService';
import { builtinGames, ensureBuiltinGames } from './gameCatalogService';
import { BUILTIN_WIKIDATA_QIDS } from './builtinGameIdentity';

/** Re-enrich a builtin at most this often. */
const ENRICH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Built-in slug -> pinned Wikidata QID; see `builtinGameIdentity`. */
export { BUILTIN_WIKIDATA_QIDS };

interface StaleBuiltinRow {
  id: number;
  slug: string;
  wikidata_id: string | null;
}

/** NODE_ENV=test, or the explicit `GAMES_ENRICH=off` escape hatch (set in CI). */
export function enrichmentDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const flag = (process.env.GAMES_ENRICH || '').trim().toLowerCase();
  return flag === 'off' || flag === 'false' || flag === '0';
}

/**
 * Pinned built-in rows that need a lookup: never enriched, enriched more
 * than `ENRICH_INTERVAL_MS` ago, or holding a different Wikidata item than
 * their pin. Whatever the row's `source` — a search result that matched a
 * built-in's slug turned it into 'wikidata', and it is still the built-in.
 */
async function staleBuiltinRows(): Promise<StaleBuiltinRow[]> {
  const pins = Object.entries(BUILTIN_WIKIDATA_QIDS);
  if (pins.length === 0) return [];
  const cutoff = Math.floor((Date.now() - ENRICH_INTERVAL_MS) / 1000);
  return db.queryAsync<StaleBuiltinRow>(
    `SELECT g.id, g.slug, g.wikidata_id
       FROM games g
       JOIN unnest(?::text[], ?::text[]) AS pin(slug, qid) ON pin.slug = g.slug
      WHERE g.enriched_at IS NULL OR g.enriched_at < ?
         OR g.wikidata_id IS DISTINCT FROM pin.qid`,
    [pins.map(([slug]) => slug), pins.map(([, qid]) => qid), cutoff]
  );
}

/**
 * Another row that holds this built-in's item (`wikidata_id` is unique): a
 * search result stored under a slug of its own before searches were kept off
 * built-ins, e.g. Valve's Deadlock as `deadlock-2` while `deadlock` held a
 * same-named game. It is the same game, so its players move to the built-in
 * row and the duplicate goes.
 */
async function mergeDuplicateOf(rowId: number, qid: string): Promise<void> {
  const duplicates = await db.queryAsync<{ id: number }>(
    'SELECT id FROM games WHERE wikidata_id = ? AND id <> ?',
    [qid, rowId]
  );
  for (const dup of duplicates) {
    await db.runAsync(
      `INSERT INTO player_games (player_uid, game_id, created_at)
       SELECT player_uid, ?, created_at FROM player_games WHERE game_id = ?
       ON CONFLICT DO NOTHING`,
      [rowId, dup.id]
    );
    await db.runAsync('DELETE FROM games WHERE id = ?', [dup.id]);
  }
}

async function enrichRow(
  row: StaleBuiltinRow,
  wikidata: Map<string, WikidataBuiltinInfo>,
  names: Map<string, string>
): Promise<void> {
  const qid = BUILTIN_WIKIDATA_QIDS[row.slug];
  const info = qid ? wikidata.get(qid) : undefined;
  if (!info) {
    // The batched Wikidata call answered with nothing for this id — nothing
    // to store, and no reason to believe a retry next start would differ, but
    // leaving enriched_at untouched costs nothing and keeps retrying it.
    return;
  }

  const genres = info.genres;
  const now = Math.floor(Date.now() / 1000);

  if (row.wikidata_id !== qid) {
    // Never enriched, or holding another game. Either way every Wikidata
    // field is this item's now, the name is the built-in's again, and the
    // cached Steam icon (which was the other game's) is looked up afresh.
    await mergeDuplicateOf(row.id, qid);
    await db.runAsync(
      `UPDATE games
          SET name = COALESCE(?, name),
              cover_url = ?, logo_url = ?, release_year = ?, genres = ?,
              wikidata_id = ?, steam_app_id = ?,
              icon_url = CASE WHEN wikidata_id IS NULL THEN icon_url END,
              icon_source = CASE WHEN wikidata_id IS NULL THEN icon_source END,
              icon_checked_at = CASE WHEN wikidata_id IS NULL THEN icon_checked_at END,
              source = 'wikidata', enriched_at = ?, updated_at = ?
        WHERE id = ?`,
      [
        names.get(row.slug) ?? null,
        info.imageUrl,
        info.imageUrl,
        info.releaseYear,
        genres.length > 0 ? JSON.stringify(genres.slice(0, 3)) : null,
        qid,
        info.steamAppId,
        now,
        now,
        row.id,
      ]
    );
    return;
  }

  await db.runAsync(
    `UPDATE games
        SET cover_url = COALESCE(?, cover_url),
            logo_url = COALESCE(?, logo_url),
            release_year = COALESCE(release_year, ?),
            genres = COALESCE(?, genres),
            steam_app_id = COALESCE(steam_app_id, ?),
            source = 'wikidata',
            enriched_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      info.imageUrl,
      info.imageUrl,
      info.releaseYear,
      genres.length > 0 ? JSON.stringify(genres.slice(0, 3)) : null,
      info.steamAppId,
      now,
      now,
      row.id,
    ]
  );
}

/**
 * Enrich every stale built-in (never enriched, or last enriched more than 7
 * days ago) from Wikidata. Safe to call from the request path or startup: it
 * never throws — failures are logged and simply retried next start.
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
    const names = new Map(builtinGames().map((g) => [g.slug, g.name]));

    for (const row of stale) {
      try {
        await enrichRow(row, wikidata, names);
      } catch (err) {
        log.warn(`[Games] Failed to enrich built-in game "${row.slug}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log.warn(`[Games] Built-in game enrichment failed, will retry next start: ${(err as Error).message}`);
  }
}
