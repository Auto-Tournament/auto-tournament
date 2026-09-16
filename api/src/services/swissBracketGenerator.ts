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
    getMatchesCallback: () => Promise<BracketMatch[]>
  ): Promise<BracketMatch[]> {
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

        const config = await generateMatchConfig(tournament, team1Id, team2Id, slug);
        const status = isBye
          ? 'completed'
          : determineInitialMatchStatus(team1Id, team2Id, tournament.format, round);

        await db.insertAsync('matches', {
          slug,
          tournament_id: tournament.id,
          round,
          match_number: matchNum,
          team1_id: team1Id || null,
          team2_id: team2Id || null,
          winner_id: isBye ? team1Id : null,
          server_id: null,
          config: JSON.stringify(config),
          status,
          next_match_id: null,
          created_at: now,
          ...(isBye ? { completed_at: now } : {}),
        });
      }
    }

    return await getMatchesCallback();
  }
}

// Export singleton instance
export const swissBracketGenerator = new SwissBracketGenerator();
