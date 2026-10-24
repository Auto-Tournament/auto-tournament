/**
 * Several tournaments, and which one is featured (Vikunja 1840, 1833).
 *
 * A request names its tournament (`requestedTournamentId`,
 * utils/tournamentRow.ts); one that names none gets the featured tournament:
 * the front page's big card, the top bar's Standings link, and the one the
 * 2.x singular routes (`/api/tournament`) act on. Featured is the one an
 * admin picked (`featured_tournament_id`) while it exists and is not
 * archived, else the newest running one, else the newest not archived, else
 * the next id (no tournament yet). `resolveTournamentId()` answers it
 * synchronously from what this file last read; it is read again whenever a
 * tournament is created, deleted, started, finished, archived or featured,
 * and every 30 seconds in case something changed elsewhere.
 *
 * Archiving (`archived_at`) hides a finished tournament from the front
 * page's lists; it keeps its matches, results and page.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { resolveTournamentId, setCurrentTournamentId } from '../utils/tournamentRow';
import { guarded } from '../utils/guarded';

const FEATURED_KEY = 'featured_tournament_id';
const REFRESH_MS = 30_000;

export class TournamentArchiveError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** The featured tournament's id (see the file comment). */
export async function featuredTournamentId(): Promise<number> {
  const picked = Number(await db.getAppSettingAsync(FEATURED_KEY).catch(() => null));
  if (Number.isInteger(picked) && picked > 0) {
    const row = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM tournament WHERE id = ? AND archived_at IS NULL',
      [picked]
    );
    if (row) return row.id;
  }
  const running = await db.queryOneAsync<{ id: number }>(
    "SELECT id FROM tournament WHERE status = 'in_progress' AND archived_at IS NULL ORDER BY id DESC LIMIT 1"
  );
  if (running) return running.id;
  const open = await db.queryOneAsync<{ id: number }>(
    'SELECT id FROM tournament WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1'
  );
  if (open) return open.id;
  return nextTournamentId();
}

/** The highest tournament id ever handed out (app_settings). */
const ID_HIGH_WATER_KEY = 'tournament_id_high_water';

/**
 * The id a new tournament gets: never one handed out before, so its match
 * slugs (t<id>-r1m1) never meet an older tournament's leftovers (demos,
 * clips, analyses keyed by slug). Past every tournament there is, any deleted
 * one whose played matches stayed (`matches.played_in_id`), and the highest
 * id ever given (`tournament_id_high_water`, kept when a tournament is
 * deleted).
 */
export async function nextTournamentId(): Promise<number> {
  const row = await db.queryOneAsync<{ next: number }>(
    `SELECT GREATEST(
        COALESCE((SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = '${ID_HIGH_WATER_KEY}' AND value ~ '^[0-9]{1,9}$'), 0),
        COALESCE((SELECT MAX(id) FROM tournament), 0),
        COALESCE((SELECT MAX(played_in_id) FROM matches), 0),
        -- Any other match out of a tournament under a t<id>- slug.
        COALESCE((SELECT MAX(substring(slug from '^t([0-9]{1,9})-')::int) FROM matches
                   WHERE tournament_id IS NULL AND slug ~ '^t[0-9]{1,9}-'), 0)
      ) + 1 AS next`
  );
  return Number(row?.next ?? 1);
}

/** Remember `id` as handed out: nextTournamentId never gives it (or a lower one) again. */
export async function noteTournamentId(id: number): Promise<void> {
  const current = Number(await db.getAppSettingAsync(ID_HIGH_WATER_KEY).catch(() => null)) || 0;
  if (id > current) await db.setAppSettingAsync(ID_HIGH_WATER_KEY, String(id));
}

/** Read which tournament is featured, and remember it. Never throws (keeps the last answer). */
export async function refreshCurrentTournamentId(): Promise<number> {
  try {
    setCurrentTournamentId(await featuredTournamentId());
  } catch (error) {
    log.warn('[TOURNAMENT] Could not read the featured tournament', {
      error: (error as Error).message,
    });
  }
  return resolveTournamentId();
}

let refreshTimer: NodeJS.Timeout | null = null;

/** Keep the featured id fresh in the background (see the file comment). */
export function startCurrentTournamentRefresh(): void {
  if (refreshTimer) return;
  const refresh = guarded(async () => {
    await refreshCurrentTournamentId();
  });
  refreshTimer = setInterval(() => void refresh(), REFRESH_MS);
  refreshTimer.unref?.();
}

export function stopCurrentTournamentRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** Feature a tournament on the front page (null: let the rules above pick). */
export async function setFeaturedTournament(id: number | null): Promise<number> {
  if (id !== null) {
    const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM tournament WHERE id = ?', [
      id,
    ]);
    if (!row) throw new TournamentArchiveError(404, 'Tournament not found');
    await db.runAsync('UPDATE tournament SET archived_at = NULL WHERE id = ?', [id]);
  }
  await db.setAppSettingAsync(FEATURED_KEY, id === null ? '' : String(id));
  return refreshCurrentTournamentId();
}

/**
 * Archive a finished tournament: off the front page's lists, everything
 * else kept. Only a finished one: a tournament still running or being set up
 * is finished or deleted first. Returns the archived id and the featured one
 * after it.
 */
export async function archiveTournament(
  id: number
): Promise<{ archivedId: number; currentId: number }> {
  const row = await db.queryOneAsync<{ status: string; archived_at: number | null }>(
    'SELECT status, archived_at FROM tournament WHERE id = ?',
    [id]
  );
  if (!row) throw new TournamentArchiveError(404, 'There is no tournament to archive.');
  if (row.status !== 'completed' && row.status !== 'cancelled') {
    throw new TournamentArchiveError(
      409,
      'Only a finished or cancelled tournament can be archived. Finish, end or delete it first.'
    );
  }
  if (!row.archived_at) {
    await db.runAsync(
      'UPDATE tournament SET archived_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?',
      [id]
    );
  }
  const currentId = await refreshCurrentTournamentId();
  log.success(`[TOURNAMENT] Archived tournament ${id}; featured is now ${currentId}`);
  return { archivedId: id, currentId };
}

/** Archive the tournament the request acts on (the featured one by default). */
export async function archiveCurrentTournament(id: number = resolveTournamentId()): Promise<{
  archivedId: number;
  currentId: number;
}> {
  return archiveTournament(id);
}

/**
 * The tournament a public page asks for by id: the featured one, or any
 * other that exists. Null when there is no such row.
 */
export async function readableTournamentId(param: string | undefined): Promise<number | null> {
  const current = resolveTournamentId();
  if (param === undefined || param === String(current)) return current;
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM tournament WHERE id = ?', [
    id,
  ]);
  return row ? id : null;
}

/** Every tournament that is running, for work that is not about one tournament (allocation, update holds). */
export async function runningTournamentIds(): Promise<number[]> {
  const rows = await db.queryAsync<{ id: number }>(
    "SELECT id FROM tournament WHERE status = 'in_progress' ORDER BY id"
  );
  return rows.map((r) => r.id);
}
