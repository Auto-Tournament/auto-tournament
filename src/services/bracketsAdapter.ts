import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';
import type { Match, StageType, StageSettings } from 'brackets-model';
import { log } from '../utils/logger';
import { db } from '../config/database';
import type { TournamentResponse } from '../types/tournament.types';

/**
 * Adapter to convert brackets-manager output to our database schema
 */
export class BracketsAdapter {
  private manager: BracketsManager;
  private storage: InMemoryDatabase;

  constructor() {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }

  /**
   * Generate bracket using brackets-manager and convert to our schema
   */
  async generateBracket(tournament: TournamentResponse): Promise<{
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
    const stageSettings: Partial<StageSettings> = {
      size: teamIds.length,
      seedOrdering: settings.seedingMethod === 'random' ? ['natural'] : ['natural'],
      grandFinal: type === 'double_elimination' ? 'simple' : 'none',
      consolationFinal: settings.thirdPlaceMatch,
    };

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

      // Convert brackets-manager matches to our format
      return this.convertMatches(matches as Match[], tournament, stageType);
    } catch (err) {
      log.error('Brackets-manager error', err);
      throw err;
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
  private convertMatches(
    bmMatches: Match[],
    tournament: TournamentResponse,
    stageType: StageType
  ): {
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
  } {
    const matches = bmMatches.map((bmMatch) => {
      // Determine match slug based on type and position
      const slug = this.generateSlug(bmMatch, stageType);

      // Convert round_id to number (it might be a number already, but ensure it)
      const roundNum =
        typeof bmMatch.round_id === 'number'
          ? bmMatch.round_id
          : parseInt(String(bmMatch.round_id), 10);

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
      let status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed' = 'pending';

      if (bmMatch.opponent1?.result === 'win' || bmMatch.opponent2?.result === 'win') {
        status = 'completed';
      } else if (team1Id && team2Id) {
        // Both teams are set - match is ready
        status = roundNum === 1 ? 'ready' : 'pending';
      } else if (team1Id || team2Id) {
        // One team is set (bye) - mark as pending, will be handled by progression logic
        status = 'pending';
      }

      // Generate match config
      const config = this.generateMatchConfig(tournament, team1Id, team2Id);

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
    });

    return { matches };
  }

  /**
   * Generate match slug based on brackets-manager match data
   */
  private generateSlug(match: Match, stageType: StageType): string {
    if (stageType === 'double_elimination') {
      // Determine if it's winners bracket, losers bracket, or grand finals
      const isGrandFinal = match.group_id === 3;
      const isLosersBracket = match.group_id === 2;

      if (isGrandFinal) {
        return 'gf';
      } else if (isLosersBracket) {
        return `lb-r${match.round_id}m${match.number}`;
      } else {
        return `r${match.round_id}m${match.number}`;
      }
    } else {
      // Single elimination or round robin
      return `r${match.round_id}m${match.number}`;
    }
  }

  /**
   * Generate match config for MatchZy
   */
  private generateMatchConfig(
    tournament: TournamentResponse,
    team1Id: string | null,
    team2Id: string | null
  ): Record<string, unknown> {
    const team1 = team1Id
      ? db.queryOne<{ name: string; tag: string | null; players: string }>(
          'SELECT name, tag, players FROM teams WHERE id = ?',
          [team1Id]
        )
      : null;

    const team2 = team2Id
      ? db.queryOne<{ name: string; tag: string | null; players: string }>(
          'SELECT name, tag, players FROM teams WHERE id = ?',
          [team2Id]
        )
      : null;

    return {
      matchid: `${tournament.name}-${Date.now()}`,
      num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
      maplist: tournament.maps,
      team1: team1
        ? {
            name: team1.name,
            tag: team1.tag || team1.name.substring(0, 5).toUpperCase(),
            players: JSON.parse(team1.players),
          }
        : null,
      team2: team2
        ? {
            name: team2.name,
            tag: team2.tag || team2.name.substring(0, 5).toUpperCase(),
            players: JSON.parse(team2.players),
          }
        : null,
      clinch_series: true,
      skip_veto: false,
    };
  }

  /**
   * Reset the in-memory storage
   */
  reset(): void {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }
}

export const bracketsAdapter = new BracketsAdapter();
