import { db } from '../config/database';
import { log } from '../utils/logger';
import { getBracketGenerator } from './bracketGenerators';
import { validateTeamCount, calculateTotalRounds } from '../utils/tournamentHelpers';
import { enrichMatch } from '../utils/matchEnrichment';
import type { DbMatchRow, DbTeamRow } from '../types/database.types';
import type {
  Tournament,
  TournamentRow,
  TournamentResponse,
  CreateTournamentInput,
  UpdateTournamentInput,
  TournamentSettings,
  BracketMatch,
  BracketResponse,
} from '../types/tournament.types';

export const DEFAULT_SETTINGS: TournamentSettings = {
  matchFormat: 'bo3',
  thirdPlaceMatch: false,
  autoAdvance: true,
  checkInRequired: false,
  seedingMethod: 'random',
};

class TournamentService {
  /**
   * Get the current tournament (only one tournament exists at a time)
   */
  async getTournament(): Promise<TournamentResponse | null> {
    const row = await db.queryOneAsync<TournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!row) return null;

    const tournament = this.rowToTournament(row);
    const teams = await this.getTeamsForTournament(tournament.team_ids);

    log.debug('getTournament normalized tournament', {
      id: tournament.id,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      mapSequence: tournament.mapSequence,
      teamSize: tournament.teamSize,
      roundLimitType: tournament.roundLimitType,
      maxRounds: tournament.maxRounds,
      overtimeMode: tournament.overtimeMode,
      overtimeSegments: tournament.overtimeSegments,
      eloTemplateId: tournament.eloTemplateId,
    });

    return {
      id: tournament.id,
      name: tournament.name,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      maps: tournament.maps,
      teamIds: tournament.team_ids,
      settings: tournament.settings,
      // Shuffle tournament specific fields (only populated for type === 'shuffle')
      mapSequence: tournament.mapSequence,
      teamSize: tournament.teamSize,
      roundLimitType: tournament.roundLimitType,
      maxRounds: tournament.maxRounds,
      overtimeMode: tournament.overtimeMode,
      overtimeSegments: tournament.overtimeSegments,
      eloTemplateId: tournament.eloTemplateId || undefined,
      created_at: tournament.created_at,
      updated_at: tournament.updated_at,
      started_at: tournament.started_at,
      completed_at: tournament.completed_at,
      teams,
    };
  }

  /**
   * Create or replace the tournament
   */
  async createTournament(input: CreateTournamentInput): Promise<TournamentResponse> {
    const { name, type, format, maps, teamIds, settings } = input;

    // Shuffle tournaments don't use teams, skip validation
    if (type !== 'shuffle') {
      // Validate team count based on tournament type
      validateTeamCount(type, teamIds.length);
    }

    const tournamentSettings: TournamentSettings = {
      ...DEFAULT_SETTINGS,
      matchFormat: format,
      ...settings,
    };

    const now = Math.floor(Date.now() / 1000);

    // Delete existing tournament (if any) - we only support one tournament at a time
    await db.execAsync('DELETE FROM tournament WHERE id = 1');

    // Insert new tournament
    await db.insertAsync('tournament', {
      id: 1,
      name,
      type,
      format,
      status: 'setup',
      maps: JSON.stringify(maps),
      team_ids: JSON.stringify(teamIds || []), // Shuffle tournaments have no fixed teams
      settings: JSON.stringify(tournamentSettings),
      created_at: now,
      updated_at: now,
    });

    log.success(`Tournament created: ${name} (${type})`);

    // Shuffle tournaments don't use bracket generation
    if (type !== 'shuffle') {
      // Auto-generate bracket
      try {
        await this.generateBracket();
        log.success('Bracket automatically generated');
      } catch (err) {
        log.error('Failed to auto-generate bracket', err);

        // Clean up: Delete the tournament since bracket generation failed
        await db.execAsync('DELETE FROM tournament WHERE id = 1');
        log.warn('Tournament deleted due to bracket generation failure');

        // Re-throw to prevent returning tournament in broken state
        throw new Error(
          `Bracket generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    } else {
      log.info('Shuffle tournament created - bracket generation skipped (not applicable)');
    }

    const created = await this.getTournament();
    if (!created) {
      throw new Error('Failed to create tournament');
    }

    return created;
  }

  /**
   * Update existing tournament
   */
  async updateTournament(input: UpdateTournamentInput): Promise<TournamentResponse> {
    const existing = await this.getTournament();
    if (!existing) {
      throw new Error('No tournament exists to update');
    }

    const { name, type, format, maps, teamIds, settings } = input;

    // Validate team count if changing teams or type
    if (type || teamIds) {
      validateTeamCount(type || existing.type, (teamIds || existing.teamIds).length);
    }

    const updates: Partial<TournamentRow> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (name) updates.name = name;
    if (type) updates.type = type;
    if (format) updates.format = format;
    if (maps) updates.maps = JSON.stringify(maps);
    if (teamIds) updates.team_ids = JSON.stringify(teamIds);
    if (settings) {
      const merged = { ...existing.settings, ...settings };
      updates.settings = JSON.stringify(merged);
    }

    await db.updateAsync('tournament', updates, 'id = ?', [1]);

    log.debug('Tournament updated');

    // Auto-regenerate bracket if structural changes were made
    const needsRegeneration = type || teamIds || (maps && maps.length !== existing.maps.length);
    if (needsRegeneration) {
      try {
        await this.regenerateBracket(true);
        log.debug('Bracket regenerated after update');
      } catch (err) {
        log.error('Failed to regenerate bracket after update', err);
        // Revert changes to teams if bracket generation fails
        if (teamIds) {
          const oldTeamId = existing.teamIds;
          await db.updateAsync('tournament', { team_ids: JSON.stringify(oldTeamId) }, 'id = ?', [
            1,
          ]);
        }
      }
    }

    const updated = await this.getTournament();
    if (!updated) {
      throw new Error('Failed to retrieve updated tournament');
    }

    return updated;
  }

  /**
   * Delete tournament and all associated matches
   * Note: Server cleanup (ending matches) should be done by the caller before this
   */
  async deleteTournament(): Promise<void> {
    // First, clear server_id from all matches to clean up references
    await db.execAsync('UPDATE matches SET server_id = NULL WHERE tournament_id = 1');
    log.debug('Cleared server references from matches');

    // Delete tournament (CASCADE will also delete matches and events)
    await db.execAsync('DELETE FROM tournament WHERE id = 1');
    log.debug('Tournament deleted from database');
  }

  /**
   * Generate bracket for the tournament
   */
  async generateBracket(): Promise<BracketResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    if (tournament.status !== 'setup') {
      throw new Error('Cannot regenerate bracket after tournament has started');
    }

    // Delete existing matches
    await db.execAsync('DELETE FROM matches WHERE tournament_id = 1');

    let matches: BracketMatch[] = [];

    try {
      // Get the appropriate generator for this tournament type
      const generator = getBracketGenerator(tournament.type);

      // Reset state if available
      if (generator.reset) {
        generator.reset();
      }

      const result = await generator.generate(tournament, () => this.getMatches());

      // Handle different result types (Swiss returns BracketMatch[], others return BracketGeneratorResult)
      if (Array.isArray(result)) {
        // Swiss generator returns BracketMatch[] directly (already in DB)
        matches = result;
      } else {
        // Standard generators return BracketGeneratorResult (needs DB insertion)

        // Insert matches into database and track IDs for linking
        const slugToDbId: Map<string, number> = new Map();

        for (const matchData of result.matches) {
          const config = JSON.parse(matchData.config);
          const insertResult = await db.insertAsync('matches', {
            slug: matchData.slug,
            tournament_id: 1,
            round: matchData.round,
            match_number: matchData.matchNum,
            team1_id: matchData.team1Id,
            team2_id: matchData.team2Id,
            winner_id: matchData.winnerId,
            server_id: null,
            config: matchData.config,
            status: matchData.status,
            next_match_id: null, // Will be set in a second pass
            created_at: Math.floor(Date.now() / 1000),
          });

          slugToDbId.set(matchData.slug, insertResult.lastInsertRowid as number);

          matches.push({
            id: insertResult.lastInsertRowid as number,
            slug: matchData.slug,
            round: matchData.round,
            matchNumber: matchData.matchNum,
            team1: matchData.team1Id
              ? {
                  id: matchData.team1Id,
                  name: config.team1?.name || 'TBD',
                  tag: config.team1?.tag || 'TBD',
                }
              : null,
            team2: matchData.team2Id
              ? {
                  id: matchData.team2Id,
                  name: config.team2?.name || 'TBD',
                  tag: config.team2?.tag || 'TBD',
                }
              : null,
            winner: null,
            status: matchData.status,
            serverId: null,
            config,
            nextMatchId: null,
            createdAt: Math.floor(Date.now() / 1000),
          });
        }

        // Link matches (set next_match_id based on bracket structure)
        await this.linkMatches(matches, slugToDbId, tournament.type);
      }

      // Keep tournament in 'setup' status - it will change to 'ready' when user starts it
      await db.updateAsync('tournament', { updated_at: Math.floor(Date.now() / 1000) }, 'id = ?', [
        1,
      ]);

      log.debug(`Bracket generated: ${matches.length} matches created`);

      const totalRounds = calculateTotalRounds(tournament.teamIds.length, tournament.type);
      return { tournament, matches, totalRounds };
    } catch (err) {
      log.error('Failed to generate bracket', err);
      throw err;
    }
  }

  /**
   * Explicitly regenerate brackets (DESTRUCTIVE - wipes all match data)
   * Should only be called with user confirmation
   */
  async regenerateBracket(force: boolean = false): Promise<BracketResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Safety check: prevent regeneration of live/completed tournaments unless forced
    if (!force && tournament.status !== 'setup') {
      throw new Error(
        'Cannot regenerate bracket for a live or completed tournament. ' +
          'Use force=true to override (this will delete all match data).'
      );
    }

    log.warn('Regenerating bracket - all existing match data will be deleted');

    // Generate new bracket (this also sets status to 'ready')
    const result = await this.generateBracket();

    log.success('Bracket regenerated successfully');
    return result;
  }

  /**
   * Reset tournament back to setup mode
   * Clears all matches and resets status
   */
  async resetTournament(): Promise<TournamentResponse> {
    const tournament = await this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Count matches before deletion for logging
    const matchCount = await db.queryOneAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1'
    );

    // Delete all matches (this also clears all veto states stored in matches)
    await db.execAsync('DELETE FROM matches WHERE tournament_id = 1');

    // Shuffle tournaments have their own dynamic match/round generation and
    // temporary teams. Resetting should NOT attempt to regenerate a static bracket.
    if (tournament.type === 'shuffle') {
      // Clean up shuffle-specific state
      await db.execAsync('DELETE FROM shuffle_tournament_players WHERE tournament_id = 1');
      await db.execAsync("DELETE FROM teams WHERE id LIKE 'shuffle-r%'");

      await db.updateAsync(
        'tournament',
        {
          status: 'setup',
          updated_at: Math.floor(Date.now() / 1000),
          started_at: null,
          completed_at: null,
        },
        'id = ?',
        [1]
      );

      log.success(
        `Shuffle tournament reset to setup mode. Deleted ${
          matchCount?.count || 0
        } match(es) and cleared shuffle teams/registrations.`
      );

      const result = await this.getTournament();
      if (!result) throw new Error('Failed to retrieve tournament after reset');
      return result;
    }

    // Non-shuffle tournaments: reset and regenerate bracket as before
    await db.updateAsync(
      'tournament',
      {
        status: 'setup',
        updated_at: Math.floor(Date.now() / 1000),
        started_at: null,
        completed_at: null,
      },
      'id = ?',
      [1]
    );

    log.success(
      `Tournament reset to setup mode. Deleted ${
        matchCount?.count || 0
      } match(es) and cleared all veto states.`
    );

    // Regenerate bracket after reset
    try {
      await this.generateBracket();
      log.success('Bracket regenerated after tournament reset');
    } catch (err) {
      log.error('Failed to regenerate bracket after reset', err);
      throw new Error(
        `Tournament reset completed but bracket regeneration failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    }

    const result = await this.getTournament();
    if (!result) throw new Error('Failed to retrieve tournament after reset');
    return result;
  }

  /**
   * Get bracket with all matches
   */
  async getBracket(): Promise<BracketResponse | null> {
    const tournament = await this.getTournament();
    if (!tournament) return null;

    const matches = await this.getMatches();
    const totalRounds = calculateTotalRounds(tournament.teamIds.length, tournament.type);

    return { tournament, matches, totalRounds };
  }

  /**
   * Get all matches for the tournament
   */
  private async getMatches(): Promise<BracketMatch[]> {
    const rows = await db.queryAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1 ORDER BY round, match_number'
    );

    const matches: BracketMatch[] = [];
    for (const row of rows) {
      const match: BracketMatch = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        serverId: row.server_id,
        status: row.status,
        nextMatchId: row.next_match_id,
        createdAt: row.created_at,
        loadedAt: row.loaded_at,
        completedAt: row.completed_at,
      };

      // Parse config for additional details
      if (row.config) {
        try {
          match.config = JSON.parse(row.config);
        } catch {
          // Ignore parse errors
        }
      }

      // Attach team info if available
      if (row.team1_id) {
        const team1 = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.team1_id]
        );
        if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
      }
      if (row.team2_id) {
        const team2 = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.team2_id]
        );
        if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
      }
      if (row.winner_id) {
        const winner = await db.queryOneAsync<DbTeamRow>(
          'SELECT id, name, tag FROM teams WHERE id = ?',
          [row.winner_id]
        );
        if (winner)
          match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
      }

      // Enrich match with player stats and scores from events
      await enrichMatch(match, row.slug);

      matches.push(match);
    }
    return matches;
  }

  /**
   * Link matches by setting next_match_id for progression
   */
  private async linkMatches(
    matches: BracketMatch[],
    slugToDbId: Map<string, number>,
    tournamentType: string
  ): Promise<void> {
    for (const match of matches) {
      let nextMatchSlug: string | null = null;

      if (tournamentType === 'single_elimination') {
        // In single elimination, winners advance to the next round
        // Match N in round R advances to match ceil(N/2) in round R+1
        if (match.round < Math.max(...matches.map((m) => m.round))) {
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchSlug = `r${match.round + 1}m${nextMatchNum}`;
        }
      } else if (tournamentType === 'double_elimination') {
        // Double elimination has complex linking (handled by brackets-manager)
        continue;
      } else if (tournamentType === 'round_robin') {
        // Round robin doesn't have progression (all matches are independent)
        continue;
      }

      if (nextMatchSlug) {
        const nextMatchId = slugToDbId.get(nextMatchSlug);
        if (nextMatchId) {
          // Update the database
          await db.updateAsync('matches', { next_match_id: nextMatchId }, 'id = ?', [match.id]);
          // Update the in-memory object
          match.nextMatchId = nextMatchId;
        }
      }
    }
  }

  /**
   * Get teams for tournament
   */
  private async getTeamsForTournament(
    teamIds: string[]
  ): Promise<Array<{ id: string; name: string; tag?: string }>> {
    if (teamIds.length === 0) return [];

    const placeholders = teamIds.map(() => '?').join(',');
    const teams = await db.queryAsync<DbTeamRow>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    return teams as Array<{ id: string; name: string; tag?: string }>;
  }

  /**
   * Convert database row to Tournament object
   */
  private rowToTournament(row: TournamentRow): Tournament {
    log.debug('rowToTournament raw row', {
      id: row.id,
      type: row.type,
      format: row.format,
      status: row.status,
      map_sequence: row.map_sequence,
      team_size: row.team_size,
      round_limit_type: row.round_limit_type,
      max_rounds: row.max_rounds,
      overtime_mode: row.overtime_mode,
      overtime_segments: row.overtime_segments,
      elo_template_id: row.elo_template_id,
    });

    return {
      ...row,
      maps: JSON.parse(row.maps),
      team_ids: JSON.parse(row.team_ids),
      settings: JSON.parse(row.settings),
      // Normalize shuffle-specific fields
      mapSequence: row.map_sequence ? JSON.parse(row.map_sequence) : undefined,
      teamSize: row.team_size === null || row.team_size === undefined ? undefined : row.team_size,
      roundLimitType: (row.round_limit_type as 'first_to_13' | 'max_rounds' | null) || undefined,
      maxRounds:
        row.max_rounds === null || row.max_rounds === undefined ? undefined : row.max_rounds,
      overtimeMode: (row.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
      overtimeSegments:
        row.overtime_segments === null || row.overtime_segments === undefined
          ? undefined
          : row.overtime_segments,
      eloTemplateId: row.elo_template_id ?? null,
    };
  }
}

export const tournamentService = new TournamentService();
