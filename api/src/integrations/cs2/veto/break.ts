/**
 * The break between a team's matches (Match rules \u2192 "Break between
 * matches", default 5 min): when a match gets both its teams, its veto waits
 * until the later of the two teams' last matches ended plus the break. The
 * match is held until then (core's hold: off the servers, no veto clock, a
 * countdown on its page), and goes ahead by itself; the veto's opening is
 * announced again then.
 */
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { holdForBreak } from '../../../services/matchHolds';
import { cs2Settings } from '../settingsReaders';

/** Holds `slug` for the break when one is due; the veto's opening time (unix s), else null. */
export async function holdForMatchBreak(slug: string): Promise<number | null> {
  const minutes = await cs2Settings.getMatchBreakMinutes();
  if (minutes <= 0) return null;
  const match = await db.queryOneAsync<{
    tournament_id: number | null;
    team1_id: string | null;
    team2_id: string | null;
    veto_state: string | null;
  }>('SELECT tournament_id, team1_id, team2_id, veto_state FROM matches WHERE slug = ?', [slug]);
  if (!match?.tournament_id || !match.team1_id || !match.team2_id || match.veto_state) return null;
  const last = await db.queryOneAsync<{ ended: number | null }>(
    `SELECT MAX(completed_at) AS ended FROM matches
      WHERE tournament_id = ? AND slug <> ? AND status = 'completed'
        AND (team1_id IN (?, ?) OR team2_id IN (?, ?))`,
    [match.tournament_id, slug, match.team1_id, match.team2_id, match.team1_id, match.team2_id]
  );
  const ended = last?.ended ? Number(last.ended) : null;
  if (!ended) return null; // a team's first match: nothing to rest from
  const until = ended + minutes * 60;
  if (until <= Math.floor(Date.now() / 1000) + 5) return null;
  await holdForBreak(slug, until, `Break between matches (${minutes} min)`);
  log.info(`[VETO] ${slug}: break until ${new Date(until * 1000).toISOString()}`);
  return until;
}

/** The match's hold ended before its veto started: announce the open veto (the second ping). */
export async function vetoOpenedAfterHold(slug: string): Promise<void> {
  try {
    const row = await db.queryOneAsync<{
      held_until: number | null;
      veto_state: string | null;
      status: string;
    }>('SELECT held_until, veto_state, status FROM matches WHERE slug = ?', [slug]);
    if (
      !row ||
      row.held_until !== null ||
      row.veto_state ||
      !['pending', 'ready'].includes(row.status)
    )
      return;
    const { announceVetoOpen } = await import('./announce');
    await announceVetoOpen(slug);
  } catch (error) {
    log.warn(`[VETO] ${slug}: could not announce the veto after the break`, {
      error: (error as Error).message,
    });
  }
}
