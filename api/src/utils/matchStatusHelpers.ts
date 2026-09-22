/**
 * Match status helpers - shared logic for determining match status
 */

/**
 * Determine if a tournament format requires map veto
 */
export function requiresVeto(format: string): boolean {
  return ['bo1', 'bo3', 'bo5'].includes(format.toLowerCase());
}

/**
 * Determine initial match status based on teams and tournament settings
 * 
 * @param team1Id - First team ID (null if TBD)
 * @param team2Id - Second team ID (null if TBD)
 * @param format - Tournament format (bo1, bo3, bo5, etc.)
 * @param round - Match round number (1-based)
 * @param options.preMatchPhase - Whether the match's game has a map veto;
 *   defaults to what the format implies (every series format has one in CS2)
 * @returns Match status
 */
export function determineInitialMatchStatus(
  team1Id: string | null | undefined,
  team2Id: string | null | undefined,
  format: string,
  round: number = 1,
  options: { preMatchPhase?: boolean } = {}
): 'pending' | 'ready' | 'completed' {
  // If either team is missing, match is pending
  if (!team1Id || !team2Id) {
    return 'pending';
  }

  // Both teams are set - check if veto is required
  const needsVeto = options.preMatchPhase ?? requiresVeto(format);

  // First round matches without veto requirement are ready immediately
  if (round === 1 && !needsVeto) {
    return 'ready';
  }

  // BO formats or later rounds: stay pending until veto is completed
  // BO matches will become 'ready' after veto completion
  return 'pending';
}

/**
 * Whether a match was actually finished through a series result.
 *
 * `status = 'completed'` alone is not proof. Every real completion path in the
 * event handler (decisive, drawn and manual series_end, plus the map_result
 * paths that synthesize one) also stamps `completed_at`, and a decisive one
 * sets `winner_id`. A row that says completed with neither was flipped by
 * something that skipped that path — the plugin-phase reconciler used to do it
 * on `postgame`, which the plugin also reports between maps of a series — so
 * later events for that match must still be let through.
 */
export function isMatchFinalized(match: {
  status?: string | null;
  winner_id?: string | null;
  completed_at?: number | string | null;
}): boolean {
  if (match.status !== 'completed') return false;
  if (match.winner_id) return true;
  return match.completed_at !== null && match.completed_at !== undefined;
}

/**
 * A series that ran out of maps level on maps, rounds and map-0 damage. The
 * maps are over (the server is freed) but the bracket cannot advance until an
 * admin sets the winner via POST /api/matches/:slug/winner.
 */
export const NEEDS_DECISION_STATUS = 'needs_decision';

/** Bracket formats where every match needs a winner to advance. */
export function isEliminationTournamentType(type: string | null | undefined): boolean {
  return type === 'single_elimination' || type === 'double_elimination';
}

