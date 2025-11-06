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
      return this.convertMatches(matches as Match[], tournament, stageType);
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
      let status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed' = 'pending';

      if (bmMatch.opponent1?.result === 'win' || bmMatch.opponent2?.result === 'win') {
        status = 'completed';
      } else if (team1Id && team2Id) {
        // Both teams are set - check if match should be ready
        // For BO formats (bo1, bo3, bo5), matches stay in 'pending' until veto is completed
        const requiresVeto = ['bo1', 'bo3', 'bo5'].includes(tournament.format.toLowerCase());

        if (roundNum === 1 && !requiresVeto) {
          // Non-BO formats: match is ready immediately
          status = 'ready';
        } else {
          // BO formats OR later rounds: stay pending
          // BO matches will become 'ready' after veto completion
          status = 'pending';
        }
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
   * Generate match config for MatchZy
   */
  private generateMatchConfig(
    tournament: TournamentResponse,
    team1Id: string | null,
    team2Id: string | null
  ): Record<string, unknown> {
    const team1 = team1Id
      ? db.queryOne<{ id: string; name: string; tag: string | null; players: string }>(
          'SELECT id, name, tag, players FROM teams WHERE id = ?',
          [team1Id]
        )
      : null;

    const team2 = team2Id
      ? db.queryOne<{ id: string; name: string; tag: string | null; players: string }>(
          'SELECT id, name, tag, players FROM teams WHERE id = ?',
          [team2Id]
        )
      : null;

    const numMaps = tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5;

    // Calculate players based on actual team sizes
    const team1PlayerObj = team1 ? JSON.parse(team1.players) : {};
    const team2PlayerObj = team2 ? JSON.parse(team2.players) : {};
    const team1PlayerCount = Object.keys(team1PlayerObj).length;
    const team2PlayerCount = Object.keys(team2PlayerObj).length;

    // MatchZy needs players_per_team to be the max of both teams
    const playersPerTeam = Math.max(team1PlayerCount, team2PlayerCount, 1);

    // Store actual player counts for frontend display
    const totalExpectedPlayers = team1PlayerCount + team2PlayerCount;

    return {
      matchid: `${tournament.name}-${Date.now()}`,
      match_title: `Map 1 of ${numMaps}`,
      side_type: 'standard',
      veto_first: 'team1',
      skip_veto: false,
      min_players_to_ready: 1, // Allow match to start with at least 1 player (flexible for small matches)
      players_per_team: playersPerTeam,
      num_maps: numMaps,
      maplist: tournament.maps,
      min_spectators_to_ready: 0,
      wingman: false,
      clinch_series: true,
      spectators: {
        players: {},
      },
      // Custom fields for our frontend
      expected_players_total: totalExpectedPlayers,
      expected_players_team1: team1PlayerCount,
      expected_players_team2: team2PlayerCount,
      team1: team1
        ? {
            id: team1.id,
            name: team1.name,
            tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
            players: team1PlayerObj,
            series_score: 0,
          }
        : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
      team2: team2
        ? {
            id: team2.id,
            name: team2.name,
            tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
            players: team2PlayerObj,
            series_score: 0,
          }
        : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
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
