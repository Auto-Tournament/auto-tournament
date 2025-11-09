import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';
import type { Match, StageType, StageSettings } from 'brackets-model';
import { log } from '../utils/logger';
import type { TournamentResponse, BracketMatch } from '../types/tournament.types';
import type { IBracketGenerator, BracketGeneratorResult } from './bracketGenerators/types';
import { generateMatchConfig } from './matchConfigBuilder';
import { determineInitialMatchStatus } from '../utils/matchStatusHelpers';

/**
 * Standard Bracket Generator
 * Generates single elimination, double elimination, and round robin brackets
 * using the brackets-manager library
 */
export class StandardBracketGenerator implements IBracketGenerator {
  private manager: BracketsManager;
  private storage: InMemoryDatabase;

  constructor() {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }

  /**
   * Generate bracket using brackets-manager and convert to our schema
   */
  async generate(
    tournament: TournamentResponse,
    _getMatchesCallback: () => BracketMatch[]
  ): Promise<BracketGeneratorResult> {
    const { teamIds, type, settings } = tournament;

    // Map our tournament types to brackets-manager types
    const stageType = this.mapTournamentType(type);

    // Create participants
    const participants = teamIds.map((teamId, index) => ({
      id: index,
      tournament_id: 0,
      name: teamId, // Use team ID as name for now
    }));

    // Configure stage settings
    // Note: Don't set 'size' for elimination tournaments - let the library calculate it
    // based on seeding array to properly handle non-power-of-2 team counts
    const stageSettings: Partial<StageSettings> = {
      seedOrdering: settings.seedingMethod === 'random' ? ['natural'] : ['natural'],
      grandFinal: type === 'double_elimination' ? 'simple' : 'none',
      consolationFinal: settings.thirdPlaceMatch,
    };

    // For round robin, size and groupCount are required
    if (stageType === 'round_robin') {
      stageSettings.size = teamIds.length;
      stageSettings.groupCount = 1; // Single group - everyone plays everyone
    }

    try {
      // Create the stage (tournament)
      await this.manager.create.stage({
        name: tournament.name,
        tournamentId: 0,
        type: stageType,
        seeding: participants.map((p) => p.name),
        settings: stageSettings,
      });

      // Get the generated matches
      const matches = await this.storage.select('match');
      const stages = await this.storage.select('stage');
      const stage = stages && stages.length > 0 ? stages[0] : null;

      if (!stage) {
        throw new Error('Failed to create stage');
      }

      if (!matches || matches.length === 0) {
        throw new Error(`Failed to generate ${stageType} bracket with ${teamIds.length} teams`);
      }

      // Convert brackets-manager matches to our format
      return await this.convertMatches(matches as Match[], tournament, stageType);
    } catch (err) {
      const error = err as Error;
      log.error('Brackets-manager error', error);

      // Provide more helpful error messages
      if (error.message.includes('minimum') || error.message.includes('participants')) {
        throw new Error(
          `Cannot create ${stageType} bracket: ${error.message}. ` +
            `You have ${teamIds.length} team(s).`
        );
      }

      throw new Error(`Failed to generate ${stageType} bracket: ${error.message}`);
    }
  }

  /**
   * Map our tournament type to brackets-manager StageType
   */
  private mapTournamentType(type: TournamentResponse['type']): StageType {
    switch (type) {
      case 'single_elimination':
        return 'single_elimination';
      case 'double_elimination':
        return 'double_elimination';
      case 'round_robin':
        return 'round_robin';
      case 'swiss':
        // brackets-manager doesn't support Swiss directly, we'll need custom logic
        throw new Error('Swiss tournaments require custom implementation');
      default:
        throw new Error(`Unsupported tournament type: ${type}`);
    }
  }

  /**
   * Convert brackets-manager matches to our database format
   */
  private async convertMatches(
    bmMatches: Match[],
    tournament: TournamentResponse,
    stageType: StageType
  ): Promise<{
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
  }> {
    const matches = await Promise.all(
      bmMatches.map(async (bmMatch) => {
        // Determine match slug based on type and position
        const slug = this.generateSlug(bmMatch, stageType);

        // Convert round_id to number (brackets-manager uses 0-based rounds)
        const bmRoundNum =
          typeof bmMatch.round_id === 'number'
            ? bmMatch.round_id
            : parseInt(String(bmMatch.round_id), 10);

        // Convert to 1-based rounds for our system (Round 0 -> Round 1, Round 1 -> Round 2, etc.)
        const roundNum = bmRoundNum + 1;

        // Map team IDs (brackets-manager uses indices, we use actual team IDs)
        const team1Id =
          bmMatch.opponent1?.id !== undefined &&
          bmMatch.opponent1.id !== null &&
          typeof bmMatch.opponent1.id === 'number'
            ? tournament.teamIds[bmMatch.opponent1.id] || null
            : null;
        const team2Id =
          bmMatch.opponent2?.id !== undefined &&
          bmMatch.opponent2.id !== null &&
          typeof bmMatch.opponent2.id === 'number'
            ? tournament.teamIds[bmMatch.opponent2.id] || null
            : null;

        // Determine status
        let status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';

        if (bmMatch.opponent1?.result === 'win' || bmMatch.opponent2?.result === 'win') {
          // Match is already completed
          status = 'completed';
        } else {
          // Use shared helper for initial status determination
          status = determineInitialMatchStatus(team1Id, team2Id, tournament.format, roundNum);
        }

        // Generate match config
        const config = await generateMatchConfig(
          tournament,
          team1Id as string | undefined,
          team2Id as string | undefined,
          slug
        );

        return {
          slug,
          round: roundNum,
          matchNum: bmMatch.number,
          team1Id,
          team2Id,
          winnerId: null,
          status,
          nextMatchId: null, // Will be set after inserting into DB
          config: JSON.stringify(config),
        };
      })
    );

    return { matches };
  }

  /**
   * Generate match slug based on brackets-manager match data
   */
  private generateSlug(match: Match, stageType: StageType): string {
    // Convert brackets-manager's 0-based rounds to 1-based for our slugs
    const bmRoundNum =
      typeof match.round_id === 'number' ? match.round_id : parseInt(String(match.round_id), 10);
    const roundNum = bmRoundNum + 1;

    if (stageType === 'double_elimination') {
      // Determine if it's winners bracket, losers bracket, or grand finals
      const isGrandFinal = match.group_id === 3;
      const isLosersBracket = match.group_id === 2;

      if (isGrandFinal) {
        return 'gf';
      } else if (isLosersBracket) {
        return `lb-r${roundNum}m${match.number}`;
      } else {
        return `r${roundNum}m${match.number}`;
      }
    } else {
      // Single elimination or round robin
      return `r${roundNum}m${match.number}`;
    }
  }

  /**
   * Reset the in-memory storage
   */
  reset(): void {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }
}

// Export singleton instance
export const standardBracketGenerator = new StandardBracketGenerator();
