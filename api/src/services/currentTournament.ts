/**
 * Which tournament is current, and archiving a finished one so the next can
 * start (Vikunja 1833).
 *
 * 3.0 runs one tournament at a time. Until now that was the single row with
 * id 1, and the only way to a new one was deleting it, which took its matches
 * and results with it. Now a finished tournament is archived (`archived_at`)
 * and keeps everything; the current one is the newest row not archived, or,
 * when every row is archived, the next id, which `createTournament` then
 * uses. `resolveTournamentId()` (utils/tournamentRow.ts) answers it
 * synchronously from what this file last read.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { resolveTournamentId, setCurrentTournamentId } from '../utils/tournamentRow';

export class TournamentArchiveError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Read which tournament is current, and remember it. Never throws (keeps the last answer). */
export async function refreshCurrentTournamentId(): Promise<number> {
  try {
    const open = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM tournament WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1'
    );
    const id =
      open?.id ??
      (await db.queryOneAsync<{ next: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM tournament'))?.next ??
      1;
    setCurrentTournamentId(Number(id));
  } catch (error) {
    log.warn('[TOURNAMENT] Could not read the current tournament id', { error: (error as Error).message });
  }
  return resolveTournamentId();
}

/**
 * Archive the current tournament so a new one can be created. Only a
 * finished one: a tournament still running or being set up is deleted or
 * finished first. Returns the archived id and the id the next one gets.
 */
export async function archiveCurrentTournament(): Promise<{ archivedId: number; currentId: number }> {
  const id = resolveTournamentId();
  const row = await db.queryOneAsync<{ status: string; archived_at: number | null }>(
    'SELECT status, archived_at FROM tournament WHERE id = ?',
    [id]
  );
  if (!row) throw new TournamentArchiveError(404, 'There is no tournament to archive.');
  if (row.status !== 'completed') {
    throw new TournamentArchiveError(409, 'Only a finished tournament can be archived. Finish or delete it first.');
  }
  if (!row.archived_at) {
    await db.runAsync('UPDATE tournament SET archived_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?', [id]);
  }
  const currentId = await refreshCurrentTournamentId();
  log.success(`[TOURNAMENT] Archived tournament ${id}; the next one is ${currentId}`);
  return { archivedId: id, currentId };
}

/**
 * The tournament a public page asks for by id: the current one, or any other
 * that exists (an archived one keeps its public results). Null when there is
 * no such row.
 */
export async function readableTournamentId(param: string | undefined): Promise<number | null> {
  const current = resolveTournamentId();
  if (param === undefined || param === String(current)) return current;
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM tournament WHERE id = ?', [id]);
  return row ? id : null;
}
