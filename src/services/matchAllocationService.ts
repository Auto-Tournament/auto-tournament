import { db } from '../config/database';
import { serverService } from './serverService';
import { rconService } from './rconService';
import { tournamentService } from './tournamentService';
import { log } from '../utils/logger';
import { getMatchZyWebhookCommands, getMatchZyDemoUploadCommand } from '../utils/matchzyConfig';
import type { ServerResponse } from '../types/server.types';
import type { DbMatchRow } from '../types/database.types';
import type { BracketMatch } from '../types/tournament.types';

/**
 * Service for automatic server allocation to tournament matches
 */
export class MatchAllocationService {
  /**
   * Get all available servers (enabled, online, and not in use)
   */
  async getAvailableServers(): Promise<ServerResponse[]> {
    const enabledServers = serverService.getAllServers(true); // Get only enabled servers

    // Check each server's status (online/offline)
    const statusChecks = await Promise.all(
      enabledServers.map(async (server) => {
        const result = await rconService.sendCommand(server.id, 'status');
        return {
          server,
          isOnline: result.success,
        };
      })
    );

    // Filter out offline servers
    const onlineServers = statusChecks.filter((s) => s.isOnline).map((s) => s.server);

    // Filter out servers that are currently in use (have an active match)
    const availableServers = onlineServers.filter((server) => {
      const activeMatch = db.queryOne<{ id: number }>(
        `SELECT id FROM matches 
         WHERE server_id = ? 
         AND status IN ('loaded', 'live') 
         AND tournament_id = 1`,
        [server.id]
      );
      return !activeMatch; // Server is available if no active match
    });

    log.debug(
      `Found ${availableServers.length} available servers out of ${enabledServers.length} enabled`
    );

    return availableServers;
  }

  /**
   * Get all ready matches that need server allocation
   */
  getReadyMatches(): BracketMatch[] {
    const matches = db.query<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE tournament_id = 1 
       AND status = 'ready' 
       AND (server_id IS NULL OR server_id = '')
       ORDER BY round, match_number`
    );

    return matches.map((row) => this.rowToMatch(row));
  }

  /**
   * Allocate servers to ready matches
   * Returns allocation results for each match
   */
  async allocateServersToMatches(baseUrl: string): Promise<
    Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }>
  > {
    const availableServers = await this.getAvailableServers();
    const readyMatches = this.getReadyMatches();

    log.debug(`Allocating ${availableServers.length} servers to ${readyMatches.length} matches`);

    if (readyMatches.length === 0) {
      log.debug('No ready matches to allocate');
      return [];
    }

    if (availableServers.length === 0) {
      log.warn('No available servers for match allocation');
      return readyMatches.map((match) => ({
        matchSlug: match.slug,
        success: false,
        error: 'No available servers',
      }));
    }

    const results: Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }> = [];

    // Allocate servers to matches (round-robin if we have fewer servers than matches)
    let serverIndex = 0;
    for (const match of readyMatches) {
      const server = availableServers[serverIndex % availableServers.length];

      try {
        // Update match with server_id
        db.update('matches', { server_id: server.id }, 'slug = ?', [match.slug]);

        // Load match on server
        const loadResult = await this.loadMatchOnServer(match.slug, server.id, baseUrl);

        if (loadResult.success) {
          log.matchAllocated(match.slug, server.id, server.name);
          results.push({
            matchSlug: match.slug,
            serverId: server.id,
            success: true,
          });
          serverIndex++; // Move to next server for next match
        } else {
          results.push({
            matchSlug: match.slug,
            serverId: server.id,
            success: false,
            error: loadResult.error || 'Failed to load match',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error(`Failed to allocate match ${match.slug} to server ${server.id}`, error);
        results.push({
          matchSlug: match.slug,
          serverId: server.id,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Allocate a single specific match to the first available server
   */
  async allocateSingleMatch(
    matchSlug: string,
    baseUrl: string
  ): Promise<{
    success: boolean;
    serverId?: string;
    error?: string;
  }> {
    try {
      // Check if match already has a server
      const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
      if (!match) {
        return { success: false, error: 'Match not found' };
      }

      if (match.server_id) {
        return { success: false, error: 'Match already has a server allocated' };
      }

      if (match.status !== 'ready') {
        return { success: false, error: `Match is not ready (status: ${match.status})` };
      }

      // Get first available server
      const availableServers = await this.getAvailableServers();
      if (availableServers.length === 0) {
        return { success: false, error: 'No available servers' };
      }

      const server = availableServers[0];

      // Update match with server_id
      db.update('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Load match on server
      const loadResult = await this.loadMatchOnServer(matchSlug, server.id, baseUrl);

      if (loadResult.success) {
        log.matchAllocated(matchSlug, server.id, server.name);
        return {
          success: true,
          serverId: server.id,
        };
      } else {
        // Rollback server_id if loading failed
        db.update('matches', { server_id: null }, 'slug = ?', [matchSlug]);
        return {
          success: false,
          serverId: server.id,
          error: loadResult.error || 'Failed to load match',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Failed to allocate match ${matchSlug}`, error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Load a match on a server via RCON
   */
  private async loadMatchOnServer(
    matchSlug: string,
    serverId: string,
    baseUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const serverToken = process.env.SERVER_TOKEN || '';

    try {
      // Get match config
      const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
      if (!match) {
        return { success: false, error: 'Match not found' };
      }

      const configUrl = `${baseUrl}/api/matches/${matchSlug}.json`;

      // Configure webhook (if SERVER_TOKEN is set)
      if (serverToken) {
        const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken);
        for (const cmd of webhookCommands) {
          await rconService.sendCommand(serverId, cmd);
        }
        log.webhookConfigured(serverId, `${baseUrl}/api/events`);
      }

      // Configure demo upload URL
      const demoUploadCommand = getMatchZyDemoUploadCommand(baseUrl, matchSlug);
      await rconService.sendCommand(serverId, demoUploadCommand);
      log.debug(`Demo upload configured for match ${matchSlug}`, { serverId });

      // Load match on server
      const loadResult = await rconService.sendCommand(
        serverId,
        `matchzy_loadmatch_url "${configUrl}"`
      );

      if (loadResult.success) {
        // Update match status to 'loaded'
        db.update(
          'matches',
          { status: 'loaded', loaded_at: Math.floor(Date.now() / 1000) },
          'slug = ?',
          [matchSlug]
        );
        log.matchLoaded(matchSlug, serverId, !!serverToken);
        return { success: true };
      } else {
        return { success: false, error: loadResult.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Start tournament - allocate all ready matches to available servers
   */
  async startTournament(baseUrl: string): Promise<{
    success: boolean;
    message: string;
    allocated: number;
    failed: number;
    results: Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    // Check if tournament exists and is ready
    const tournament = tournamentService.getTournament();
    if (!tournament) {
      return {
        success: false,
        message: 'No tournament exists',
        allocated: 0,
        failed: 0,
        results: [],
      };
    }

    if (tournament.status === 'in_progress') {
      // Tournament already started, just allocate any remaining matches
      log.debug('Tournament already in progress, allocating remaining matches');
    } else if (tournament.status === 'completed') {
      return {
        success: false,
        message: 'Tournament is already completed. Please create a new tournament.',
        allocated: 0,
        failed: 0,
        results: [],
      };
    } else if (tournament.status !== 'setup' && tournament.status !== 'ready') {
      return {
        success: false,
        message: `Tournament is in '${tournament.status}' status. Must be 'setup', 'ready', or 'in_progress' to start.`,
        allocated: 0,
        failed: 0,
        results: [],
      };
    }

    // Allocate servers to matches
    const results = await this.allocateServersToMatches(baseUrl);

    const allocated = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Update tournament status to 'in_progress' if starting for the first time
    if ((tournament.status === 'setup' || tournament.status === 'ready') && allocated > 0) {
      db.update(
        'tournament',
        {
          status: 'in_progress',
          started_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [1]
      );
      log.success(`Tournament started: ${allocated} matches allocated, ${failed} failed`);
    }

    return {
      success: allocated > 0,
      message:
        allocated > 0
          ? `Tournament started! ${allocated} match(es) allocated to servers${
              failed > 0 ? `, ${failed} failed` : ''
            }`
          : failed > 0
          ? `Failed to allocate any matches. ${failed} match(es) could not be loaded.`
          : 'No matches ready for allocation',
      allocated,
      failed,
      results,
    };
  }

  /**
   * Convert database row to BracketMatch
   */
  private rowToMatch(row: DbMatchRow): BracketMatch {
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

    // Attach team info if available
    if (row.team1_id) {
      const team1 = db.queryOne<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.team1_id]
      );
      if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
    }
    if (row.team2_id) {
      const team2 = db.queryOne<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.team2_id]
      );
      if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
    }
    if (row.winner_id) {
      const winner = db.queryOne<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.winner_id]
      );
      if (winner) match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
    }

    return match;
  }
}

export const matchAllocationService = new MatchAllocationService();
