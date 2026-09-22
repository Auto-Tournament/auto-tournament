/**
 * Bracket Generator Interface
 * Unified interface for all tournament bracket generation strategies
 */

import type { TournamentResponse } from '../../types/tournament.types';

/**
 * Bracket generator result: neutral slots only.
 *
 * Generators decide the bracket shape (who meets whom, and where winners and
 * losers go). They do not build game configs: tournamentService asks the
 * match's game integration for `matches.config` when it persists the slots.
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
    /** Set for slots that are decided at generation (a Swiss round-1 bye). */
    completedAt?: number;
  }>;
}

/**
 * Bracket Generator Interface
 * All bracket generators must implement this interface
 */
export interface IBracketGenerator {
  /**
   * Generate the bracket's slots for a tournament. Nothing is persisted here.
   * @param tournament - Tournament configuration
   */
  generate(tournament: TournamentResponse): Promise<BracketGeneratorResult>;

  /**
   * Reset generator state (if stateful)
   */
  reset?(): void;
}
