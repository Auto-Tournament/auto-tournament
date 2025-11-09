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
    team1Id: string | null;
    team2Id: string | null;
    winnerId: string | null;
    status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
    nextMatchId: number | null;
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
    getMatchesCallback: () => BracketMatch[]
  ): Promise<BracketMatch[] | BracketGeneratorResult>;

  /**
   * Reset generator state (if stateful)
   */
  reset?(): void;
}
