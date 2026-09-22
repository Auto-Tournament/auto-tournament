import { determineInitialMatchStatus } from '../utils/matchStatusHelpers';
import type { TournamentResponse } from '../types/tournament.types';
import type { BracketGeneratorResult, IBracketGenerator } from './bracketGenerators/types';

/**
 * Shuffle array in place (Fisher-Yates)
 */
const shuffleArray = <T>(array: T[]): void => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
};

/**
 * Swiss Bracket Generator
 * Swiss system pairs teams with similar records against each other
 */
class SwissBracketGenerator implements IBracketGenerator {
  async generate(tournament: TournamentResponse): Promise<BracketGeneratorResult> {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      shuffleArray(teamIds);
    }

    // Swiss system typically has log2(teamCount) rounds
    const totalRounds = Math.ceil(Math.log2(teamCount));
    // An odd team count needs one extra slot per round for the bye.
    const slotsPerRound = Math.ceil(teamCount / 2);
    const now = Math.floor(Date.now() / 1000);
    const matches: BracketGeneratorResult['matches'] = [];

    // Only round 1 is paired here (by seed order). Later rounds are placeholders
    // that swissProgressionService fills from the standings once the previous
    // round is complete.
    for (let round = 1; round <= totalRounds; round++) {
      for (let matchNum = 1; matchNum <= slotsPerRound; matchNum++) {
        const slug = `swiss-r${round}m${matchNum}`;

        let team1Id: string | undefined;
        let team2Id: string | undefined;

        if (round === 1) {
          const team1Index = (matchNum - 1) * 2;
          team1Id = teamIds[team1Index] || undefined;
          team2Id = teamIds[team1Index + 1] || undefined;
        }

        // Round 1 bye: the last seed has no opponent and wins the round.
        const isBye = round === 1 && !!team1Id && !team2Id;

        const status = isBye
          ? 'completed'
          : determineInitialMatchStatus(team1Id, team2Id, tournament.format, round);

        matches.push({
          slug,
          round,
          matchNum,
          team1Id: team1Id || null,
          team2Id: team2Id || null,
          winnerId: isBye ? team1Id ?? null : null,
          status,
          nextMatchId: null,
          ...(isBye ? { completedAt: now } : {}),
        });
      }
    }

    return { matches };
  }
}

// Export singleton instance
export const swissBracketGenerator = new SwissBracketGenerator();
