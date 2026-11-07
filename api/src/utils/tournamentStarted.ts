/**
 * A bracket match waits for its tournament to start: until the organizer starts it
 * ('setup', or 'ready' with its bracket built) nothing about its matches runs, the
 * veto included. cs.sivert.io 2026-11-07: Polar Night League, six days before its
 * start, showed players "Waiting for Frostbyte to ban a map" with a turn clock, and
 * the veto action took bans.
 *
 * Manual matches (round 0) and matchmaking (no tournament) are not bracket matches.
 */
export const NOT_STARTED_STATUSES = ['setup', 'ready'] as const;

export function waitsForTournamentStart(match: {
  tournament_id?: number | null;
  round?: number | null;
  tournamentStatus: string | null | undefined;
}): boolean {
  if (match.tournament_id == null || !match.round || match.round <= 0) return false;
  return (NOT_STARTED_STATUSES as readonly string[]).includes(match.tournamentStatus ?? '');
}
