/**
 * Built-in game enrichment: gives the built-in catalogue rows (installed game
 * modules + the popular esports list in `gameCatalogService`) a real image,
 * release year and genres, instead of the bare name/slug `ensureBuiltinGames`
 * seeds them with.
 *
 * Wikidata is the source for all three, looked up by a known QID (verified by
 * hand against https://www.wikidata.org/wiki/Special:EntityData/<QID>.json —
 * see `BUILTIN_WIKIDATA_QIDS` below), never by a fuzzy search: a built-in's
 * identity must not drift because a search matched the wrong entity.
 *
 * Runs once at API startup, after the server is listening, and is never on
 * the request path: `index.ts` fires it and does not await it. A row already
 * enriched within `ENRICH_INTERVAL_MS` is left alone; a failed lookup leaves
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

async function enrichRow(
  row: StaleBuiltinRow,
  wikidata: Map<string, WikidataBuiltinInfo>
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

  await db.runAsync(
    `UPDATE games
        SET cover_url = COALESCE(?, cover_url),
            logo_url = COALESCE(?, logo_url),
            release_year = COALESCE(release_year, ?),
            genres = COALESCE(?, genres),
            wikidata_id = COALESCE(wikidata_id, ?),
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
      qid,
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
