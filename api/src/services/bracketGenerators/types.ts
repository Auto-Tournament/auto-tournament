/**
 * Bracket Generator Interface
 * Unified interface for all tournament bracket generation strategies
 */

import type { TournamentResponse, BracketMatch } from '../../types/tournament.types';

/**
 * Standard bracket generator result
 */
export interface BracketGeneratorResult {
  matches: Array<{
    slug: string;
    round: number;
    matchNum: number;
    /**
     * Logical bracket grouping for this match.
     * - 'WB'       → winners bracket
     * - 'LB'       → losers bracket
     * - 'GF'       → grand final
     * - 'GF_RESET' → optional reset grand final (if supported)
     */
    bracket?: 'WB' | 'LB' | 'GF' | 'GF_RESET';
    team1Id: string | null;
    team2Id: string | null;
    winnerId: string | null;
    status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
    nextMatchId: number | null;
    /**
     * Optional declarative slot wiring. When populated, runtime progression
     * should prefer these fields over any slug/round heuristics.
     *
     * The generator uses slugs here; tournamentService resolves them to
     * concrete match IDs when persisting to the database.
     */
    team1FromMatchSlug?: string | null;
    team1FromOutcome?: 'winner' | 'loser' | null;
    team2FromMatchSlug?: string | null;
    team2FromOutcome?: 'winner' | 'loser' | null;
    config: string;
  }>;
}

/**
 * Bracket Generator Interface
 * All bracket generators must implement this interface
 */
export interface IBracketGenerator {
  /**
   * Generate bracket structure for a tournament
   * @param tournament - Tournament configuration
   * @param getMatchesCallback - Callback to retrieve generated matches from DB
   * @returns Array of bracket matches
   */
  generate(
    tournament: TournamentResponse,
    getMatchesCallback: () => Promise<BracketMatch[]>
  ): Promise<BracketMatch[] | BracketGeneratorResult>;

  /**
   * Reset generator state (if stateful)
   */
  reset?(): void;
}
