/**
 * Tournament notices in the players' bells: check-in opening (a sweep every
 * minute finds windows that opened) and the tournament starting. Each goes to
 * a tournament's players once (notificationService.notifyOnce), so a restart
 * or the next sweep sends nothing twice. Also prunes old notices once a day.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { notificationService } from './notificationService';

/** A window that opened longer ago than this is not announced (an old tournament, a first start). */
const FRESH_SECONDS = 6 * 3600;

/**
 * The players of a tournament: the lineups teams picked when they signed up,
 * else everyone on the rosters of its teams.
 */
export async function tournamentPlayers(tournamentId: number): Promise<string[]> {
  const lineup = await db.queryAsync<{ player_id: string }>(
    'SELECT DISTINCT player_id FROM tournament_lineups WHERE tournament_id = ?',
    [tournamentId]
  );
  if (lineup.length > 0) return lineup.map((r) => r.player_id);
  const row = await db.queryOneAsync<{ team_ids: string | null }>('SELECT team_ids FROM tournament WHERE id = ?', [tournamentId]);
  let teamIds: string[] = [];
  try {
    const parsed = JSON.parse(row?.team_ids ?? '[]');
    if (Array.isArray(parsed)) teamIds = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    teamIds = [];
  }
  if (teamIds.length === 0) return [];
  const members = await db.queryAsync<{ id: string }>(
    `SELECT DISTINCT p.id FROM team_members m JOIN players p ON p.uid = m.account_uid
      WHERE m.team_id IN (${teamIds.map(() => '?').join(', ')})`,
    teamIds
  );
  return members.map((r) => r.id);
}

export async function noticeTournamentStarted(tournamentId: number): Promise<void> {
  try {
    const t = await db.queryOneAsync<{ name: string }>('SELECT name FROM tournament WHERE id = ?', [tournamentId]);
    if (!t) return;
    await notificationService.notifyOnce(
      await tournamentPlayers(tournamentId),
      'tournament',
      { tournamentId, name: t.name, event: 'started' },
      `tournament:${tournamentId}:started`
    );
  } catch (error) {
    log.warn('[NOTIFY] Could not announce the tournament start', { error });
  }
}

async function sweepCheckIns(): Promise<void> {
  const rows = await db.queryAsync<{ id: number; name: string; settings: string | null }>(
    "SELECT id, name, settings FROM tournament WHERE status NOT IN ('completed', 'cancelled')",
    []
  );
  const now = Date.now();
  for (const t of rows) {
    let opens: number | null = null;
    let closes: number | null = null;
    try {
      const s = JSON.parse(t.settings ?? '{}') as { checkInOpensAt?: unknown; checkInClosesAt?: unknown };
      opens = typeof s.checkInOpensAt === 'string' ? Date.parse(s.checkInOpensAt) : null;
      closes = typeof s.checkInClosesAt === 'string' ? Date.parse(s.checkInClosesAt) : null;
    } catch {
      continue;
    }
    if (!opens || !Number.isFinite(opens) || opens > now || now - opens > FRESH_SECONDS * 1000) continue;
    if (closes && Number.isFinite(closes) && closes <= now) continue;
    await notificationService.notifyOnce(
      await tournamentPlayers(t.id),
      'tournament',
      { tournamentId: t.id, name: t.name, event: 'check_in', closesAt: closes && Number.isFinite(closes) ? Math.floor(closes / 1000) : null },
      `tournament:${t.id}:check_in`
    );
  }
}

let started = false;

/** Start the minute sweep and the daily prune. */
export function startTournamentNotices(): void {
  if (started) return;
  started = true;
  const run = () =>
    sweepCheckIns().catch((error) => {
      log.debug('[NOTIFY] check-in sweep failed', { error });
    });
  setTimeout(run, 15_000).unref?.();
  setInterval(run, 60_000).unref?.();
  setInterval(() => void notificationService.prune().catch(() => undefined), 24 * 3600_000).unref?.();
}
