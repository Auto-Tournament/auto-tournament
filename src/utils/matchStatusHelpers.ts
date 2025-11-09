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
 * @returns Match status
 */
export function determineInitialMatchStatus(
  team1Id: string | null | undefined,
  team2Id: string | null | undefined,
  format: string,
  round: number = 1
): 'pending' | 'ready' | 'completed' {
  // If either team is missing, match is pending
  if (!team1Id || !team2Id) {
    return 'pending';
  }

  // Both teams are set - check if veto is required
  const needsVeto = requiresVeto(format);

  // First round matches without veto requirement are ready immediately
  if (round === 1 && !needsVeto) {
    return 'ready';
  }

  // BO formats or later rounds: stay pending until veto is completed
  // BO matches will become 'ready' after veto completion
  return 'pending';
}

