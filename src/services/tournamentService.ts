import { db } from '../config/database';
import { log } from '../utils/logger';
import { bracketsAdapter } from './bracketsAdapter';
import { generateSwissBracket } from './swissGenerator';
import { validateTeamCount } from '../utils/tournamentHelpers';
import type { DbMatchRow, DbTeamRow, DbEventRow } from '../types/database.types';
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

const DEFAULT_SETTINGS: TournamentSettings = {
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
  getTournament(): TournamentResponse | null {
    const row = db.queryOne<TournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!row) return null;

    const tournament = this.rowToTournament(row);
    const teams = this.getTeamsForTournament(tournament.team_ids);

    return {
      id: tournament.id,
      name: tournament.name,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      maps: tournament.maps,
      teamIds: tournament.team_ids,
      settings: tournament.settings,
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

    // Validate team count based on tournament type
    validateTeamCount(type, teamIds.length);

    const tournamentSettings: TournamentSettings = {
      ...DEFAULT_SETTINGS,
      matchFormat: format,
      ...settings,
    };

    const now = Math.floor(Date.now() / 1000);

    // Delete existing tournament (if any) - we only support one tournament at a time
    db.exec('DELETE FROM tournament WHERE id = 1');

    // Insert new tournament
    db.insert('tournament', {
      id: 1,
      name,
      type,
      format,
      status: 'setup',
      maps: JSON.stringify(maps),
      team_ids: JSON.stringify(teamIds),
      settings: JSON.stringify(tournamentSettings),
      created_at: now,
      updated_at: now,
    });

    log.success(`Tournament created: ${name} (${type})`);

    // Auto-generate bracket
    try {
      await this.generateBracket();
      log.success('Bracket automatically generated');
    } catch (err) {
      log.error('Failed to auto-generate bracket', err);

      // Clean up: Delete the tournament since bracket generation failed
      db.exec('DELETE FROM tournament WHERE id = 1');
      log.warn('Tournament deleted due to bracket generation failure');

      // Re-throw to prevent returning tournament in broken state
      throw new Error(
        `Bracket generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }

    const created = this.getTournament();
    if (!created) {
      throw new Error('Failed to create tournament');
    }

    return created;
  }

  /**
   * Update existing tournament
   */
  async updateTournament(input: UpdateTournamentInput): Promise<TournamentResponse> {
    const existing = this.getTournament();
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

    db.update('tournament', updates, 'id = ?', [1]);

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
          db.update('tournament', { team_ids: JSON.stringify(oldTeamId) }, 'id = ?', [1]);
        }
      }
    }

    const updated = this.getTournament();
    if (!updated) {
      throw new Error('Failed to retrieve updated tournament');
    }

    return updated;
  }

  /**
   * Delete tournament and all associated matches
   * Note: Server cleanup (ending matches) should be done by the caller before this
   */
  deleteTournament(): void {
    // Delete tournament (CASCADE will also delete matches and events)
    db.exec('DELETE FROM tournament WHERE id = 1');
    log.debug('Tournament deleted from database');
  }

  /**
   * Generate bracket for the tournament
   */
  async generateBracket(): Promise<BracketResponse> {
    const tournament = this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    if (tournament.status !== 'setup') {
      throw new Error('Cannot regenerate bracket after tournament has started');
    }

    // Delete existing matches
    db.exec('DELETE FROM matches WHERE tournament_id = 1');

    let matches: BracketMatch[] = [];

    try {
      if (tournament.type === 'swiss') {
        // Swiss tournaments need custom implementation (brackets-manager doesn't support it)
        matches = generateSwissBracket(tournament, () => this.getMatches());
      } else {
        // Use brackets-manager for single_elimination, double_elimination, and round_robin
        bracketsAdapter.reset(); // Clear previous state
        const result = await bracketsAdapter.generateBracket(tournament);

        // Insert matches into database and track IDs for linking
        const slugToDbId: Map<string, number> = new Map();

        for (const matchData of result.matches) {
          const config = JSON.parse(matchData.config);
          const insertResult = db.insert('matches', {
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
        this.linkMatches(matches, slugToDbId, tournament.type);
      }

      // Keep tournament in 'setup' status - it will change to 'ready' when user starts it
      db.update('tournament', { updated_at: Math.floor(Date.now() / 1000) }, 'id = ?', [1]);

      log.debug(`Bracket generated: ${matches.length} matches created`);

      const totalRounds = this.calculateTotalRounds(tournament.teamIds.length, tournament.type);
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
    const tournament = this.getTournament();
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
  resetTournament(): TournamentResponse {
    const tournament = this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Count matches before deletion for logging
    const matchCount = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1'
    );

    // Delete all matches (this also clears all veto states stored in matches)
    db.exec('DELETE FROM matches WHERE tournament_id = 1');

    db.update(
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
    return this.getTournament()!;
  }

  /**
   * Get bracket with all matches
   */
  getBracket(): BracketResponse | null {
    const tournament = this.getTournament();
    if (!tournament) return null;

    const matches = this.getMatches();
    const totalRounds = this.calculateTotalRounds(tournament.teamIds.length, tournament.type);

    return { tournament, matches, totalRounds };
  }

  /**
   * Get all matches for the tournament
   */
  private getMatches(): BracketMatch[] {
    const rows = db.query<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1 ORDER BY round, match_number'
    );

    return rows.map((row) => {
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
        const team1 = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team1_id,
        ]);
        if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
      }
      if (row.team2_id) {
        const team2 = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team2_id,
        ]);
        if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
      }
      if (row.winner_id) {
        const winner = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.winner_id,
        ]);
        if (winner)
          match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
      }

      // Get latest player stats from match events
      const playerStatsEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type = 'player_stats' 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (playerStatsEvent) {
        try {
          const eventData = JSON.parse(playerStatsEvent.event_data);
          if (eventData.team1_players) {
            match.team1Players = eventData.team1_players;
          }
          if (eventData.team2_players) {
            match.team2Players = eventData.team2_players;
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Get latest scores from series_end or round_end events
      const scoreEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type IN ('series_end', 'round_end', 'map_end') 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (scoreEvent) {
        try {
          const eventData = JSON.parse(scoreEvent.event_data);
          if (eventData.team1_series_score !== undefined) {
            match.team1Score = eventData.team1_series_score;
          }
          if (eventData.team2_series_score !== undefined) {
            match.team2Score = eventData.team2_series_score;
          }
        } catch {
          // Ignore parse errors
        }
      }

      return match;
    });
  }

  /**
   * Link matches by setting next_match_id for progression
   */
  private linkMatches(
    matches: BracketMatch[],
    slugToDbId: Map<string, number>,
    tournamentType: string
  ): void {
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
          db.update('matches', { next_match_id: nextMatchId }, 'id = ?', [match.id]);
          // Update the in-memory object
          match.nextMatchId = nextMatchId;
        }
      }
    }
  }

  /**
   * Calculate total rounds needed
   */
  private calculateTotalRounds(teamCount: number, type: string): number {
    switch (type) {
      case 'single_elimination':
        return Math.ceil(Math.log2(teamCount));
      case 'double_elimination': {
        const upperRounds = Math.ceil(Math.log2(teamCount));
        const lowerRounds = upperRounds * 2 - 2;
        return upperRounds + lowerRounds + 1; // +1 for grand finals
      }
      case 'round_robin':
        return teamCount % 2 === 0 ? teamCount - 1 : teamCount;
      case 'swiss':
        return Math.ceil(Math.log2(teamCount));
      default:
        return 0;
    }
  }

  /**
   * Get teams for tournament
   */
  private getTeamsForTournament(
    teamIds: string[]
  ): Array<{ id: string; name: string; tag?: string }> {
    if (teamIds.length === 0) return [];

    const placeholders = teamIds.map(() => '?').join(',');
    const teams = db.query<DbTeamRow>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    return teams as Array<{ id: string; name: string; tag?: string }>;
  }

  /**
   * Convert database row to Tournament object
   */
  private rowToTournament(row: TournamentRow): Tournament {
    return {
      ...row,
      maps: JSON.parse(row.maps),
      team_ids: JSON.parse(row.team_ids),
      settings: JSON.parse(row.settings),
    };
  }
}

export const tournamentService = new TournamentService();
