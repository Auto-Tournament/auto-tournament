/**
 * Subs take the place of starters who didn't check in (Claude Design, the
 * tournament page's "You're in" and the match room). Subs never check in: they
 * count as here and ready. Once check-in has closed, a starter who isn't
 * checked in drops to the end of the team's pick order, so a sub plays in
 * their place; with no sub left they still fill the spot, as a late arrival
 * can then join.
 *
 * Only the default pick changes: a lineup the captain or an admin set for the
 * match (services/matchLineups) stays as they set it.
 */

import { db } from '../config/database';
import { windowOfSettings } from './tournamentSignupService';

/** `pick` with the absent players swapped for present ones from `pool`, `size` long. Pure. */
export function swapAbsent(
  pick: readonly string[],
  pool: readonly string[],
  size: number,
  absent: ReadonlySet<string>
): string[] {
  const out = pick.filter((id) => !absent.has(id));
  for (const id of pool) {
    if (out.length >= size) break;
    if (!absent.has(id) && !out.includes(id)) out.push(id);
  }
  for (const id of pick) {
    if (out.length >= size) break;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, size);
}

/**
 * The team's starters who didn't check in, once the tournament's check-in has
 * closed; empty before that, or with no check-in.
 */
export async function absentStarters(
  tournamentId: number,
  teamId: string,
  starters: readonly string[],
  slug?: string
): Promise<Set<string>> {
  const row = await db.queryOneAsync<{ settings: string | null }>(
    'SELECT settings FROM tournament WHERE id = ?',
    [tournamentId]
  );
  // Check-in before each match: who checked in for this one (services/matchCheckIns).
  if (slug && row?.settings?.includes('"checkInEachMatch":true')) {
    const { absentForMatch } = await import('./matchCheckIns');
    return absentForMatch(slug, starters);
  }
  const win = windowOfSettings(row?.settings ?? null);
  const closes = win.checkInClosesAt ? Date.parse(win.checkInClosesAt) : NaN;
  if (!win.checkInOpensAt || !Number.isFinite(closes) || closes > Date.now()) return new Set();
  const checked = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM tournament_checkins WHERE tournament_id = ? AND team_id = ?',
    [tournamentId, teamId]
  );
  const here = new Set(checked.map((c) => c.player_id));
  return new Set(starters.filter((id) => !here.has(id)));
}
