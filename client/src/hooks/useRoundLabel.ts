import { useCallback } from 'react';
import { useTournamentList } from './useTournamentList';
import { eliminationRoundCount, getRoundLabel } from '../utils/matchUtils';

/**
 * Round number → label for the current tournament, the same everywhere:
 * "Final", "Semifinals" and "Quarterfinals" counted back from the last round
 * of a single-elimination bracket, "Round N" otherwise.
 *
 * Pages used to keep their own copy that called round 3 "Quarterfinals" and
 * round 5 "Finals" whatever the bracket's size — in an 8-team cup round 3 is
 * the final. The bracket's column headers and Manage use the same rule.
 */
export function useRoundLabel(): (round: number) => string {
  const { tournaments } = useTournamentList();
  const current = tournaments[0];
  const totalRounds = current ? eliminationRoundCount(current.teamCount, current.type) : undefined;
  return useCallback((round: number) => getRoundLabel(round, totalRounds), [totalRounds]);
}
