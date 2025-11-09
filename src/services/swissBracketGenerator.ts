import { db } from '../config/database';
import { generateMatchConfig } from './matchConfigBuilder';
import { determineInitialMatchStatus } from '../utils/matchStatusHelpers';
import type { TournamentResponse, BracketMatch } from '../types/tournament.types';
import type { IBracketGenerator } from './bracketGenerators/types';

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
  async generate(
    tournament: TournamentResponse,
    getMatchesCallback: () => BracketMatch[]
  ): Promise<BracketMatch[]> {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      shuffleArray(teamIds);
    }

    // Swiss system typically has log2(teamCount) rounds
    const totalRounds = Math.ceil(Math.log2(teamCount));

    // Generate first round pairings
    for (let round = 1; round <= totalRounds; round++) {
      const pairsPerRound = Math.floor(teamCount / 2);

      for (let matchNum = 1; matchNum <= pairsPerRound; matchNum++) {
        const slug = `swiss-r${round}m${matchNum}`;

        // First round: pair teams sequentially
        let team1Id: string | undefined;
        let team2Id: string | undefined;

        if (round === 1) {
          const team1Index = (matchNum - 1) * 2;
          const team2Index = team1Index + 1;
          team1Id = teamIds[team1Index] || undefined;
          team2Id = teamIds[team2Index] || undefined;
        }

        const config = await generateMatchConfig(tournament, team1Id, team2Id, slug);

        // Determine initial status using shared helper
        const status = determineInitialMatchStatus(team1Id, team2Id, tournament.format, round);

        db.insert('matches', {
          slug,
          tournament_id: tournament.id,
          round,
          match_number: matchNum,
          team1_id: team1Id || null,
          team2_id: team2Id || null,
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status,
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
        });
      }
    }

    return getMatchesCallback();
  }
}

// Export singleton instance
export const swissBracketGenerator = new SwissBracketGenerator();
