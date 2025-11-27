import { db } from '../config/database';
import { serverService } from './serverService';
import { rconService } from './rconService';
import { tournamentService } from './tournamentService';
import { emitTournamentUpdate, emitBracketUpdate, emitMatchUpdate } from './socketService';
import { loadMatchOnServer } from './matchLoadingService';
import { serverStatusService, ServerStatus } from './serverStatusService';
import { log } from '../utils/logger';
import type { ServerResponse } from '../types/server.types';
import type { DbMatchRow } from '../types/database.types';
import type { BracketMatch } from '../types/tournament.types';

/**
 * Service for automatic server allocation to tournament matches
 */
export class MatchAllocationService {
  /**
   * Get all available servers (enabled, online, and ready for allocation)
   * Uses MatchZy's matchzy_tournament_status convar to determine availability
   * 
   * According to MatchZy server allocation status documentation:
   * - Only allocate when status is 'idle'
   * - Wait 5 minutes grace period after status becomes idle
   * - Check matchzy_tournament_match and matchzy_tournament_updated convars
   */
  async getAvailableServers(): Promise<ServerResponse[]> {
    const enabledServers = await serverService.getAllServers(true); // Get only enabled servers

    // Check each server's MatchZy tournament status
    const statusChecks = await Promise.all(
      enabledServers.map(async (server) => {
        try {
          const serverStatus = await serverStatusService.getServerStatus(server.id);
          return {
            server,
            ...serverStatus,
          };
        } catch (error) {
          log.error(`Failed to check server status for ${server.id}`, error);
          return {
            server,
            status: null,
            matchSlug: null,
            updatedAt: null,
            online: false,
          };
        }
      })
    );

    // Filter out offline servers
    const onlineServers = statusChecks.filter((s) => s.online);

    // Grace period: 5 minutes (300 seconds) after status becomes idle
    const GRACE_PERIOD_SECONDS = 300;
    const now = Math.floor(Date.now() / 1000);

    // Filter servers based on MatchZy tournament status
    const availableServers: ServerResponse[] = [];
    for (const check of onlineServers) {
      const { server, status, matchSlug, updatedAt } = check;

      // Only allocate when status is 'idle'
      if (status !== ServerStatus.IDLE) {
        log.debug(
          `Server ${server.id} (${server.name}) not available: status is '${status}' (not idle)`
        );
        continue;
      }

      // Check grace period: if status was recently updated to idle, wait before allocating
      // This ensures demo uploads complete and match reset finishes
      if (updatedAt) {
        const age = now - updatedAt;
        
        // If status was recently updated to idle (within grace period), wait
        if (age < GRACE_PERIOD_SECONDS) {
          const timeUntilReady = GRACE_PERIOD_SECONDS - age;
          
          // Additional check: if match ID exists and is recent, definitely wait
          if (matchSlug && matchSlug.trim() !== '') {
            log.debug(
              `Server ${server.id} (${server.name}) recently ended match '${matchSlug}' (${age}s ago), waiting ${timeUntilReady}s more for grace period`
            );
            continue;
          }
          
          // Even without match ID, if status was recently updated, wait a bit
          // (might be server restart or status reset)
          log.debug(
            `Server ${server.id} (${server.name}) recently became idle (${age}s ago), waiting ${timeUntilReady}s more for grace period`
          );
          continue;
        }

        // Status is idle and timestamp is old enough, safe to allocate
        if (matchSlug && matchSlug.trim() !== '') {
          log.debug(
            `Server ${server.id} (${server.name}) is idle with old match ID '${matchSlug}' (${age}s old), ready for allocation`
          );
        }
      } else {
        // No timestamp available - server might have been idle for a long time
        // Allow allocation but log it
        log.debug(
          `Server ${server.id} (${server.name}) is idle (no timestamp available), assuming ready for allocation`
        );
      }

      // Server is available!
      availableServers.push(server);
      log.debug(`Server ${server.id} (${server.name}) is available for allocation (idle)`);
    }

    log.debug(
      `Found ${availableServers.length} available servers out of ${enabledServers.length} enabled (${onlineServers.length} online)`
    );

    return availableServers;
  }

  /**
   * Get all ready matches that need server allocation
   */
  async getReadyMatches(): Promise<BracketMatch[]> {
    const matches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE tournament_id = 1 
       AND status = 'ready' 
       AND (server_id IS NULL OR server_id = '')
       ORDER BY round, match_number`
    );

    return Promise.all(matches.map((row) => this.rowToMatch(row)));
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
    log.info('📊 Getting available servers...');
    const availableServers = await this.getAvailableServers();
    log.info(`Found ${availableServers.length} available server(s)`);

    log.info('📊 Getting ready matches...');
    const readyMatches = await this.getReadyMatches();
    log.info(`Found ${readyMatches.length} ready match(es) to allocate`);

    if (readyMatches.length === 0) {
      log.info('✓ No ready matches to allocate');
      return [];
    }

    if (availableServers.length === 0) {
      log.warn('⚠️  No available servers for match allocation');
      return readyMatches.map((match) => ({
        matchSlug: match.slug,
        success: false,
        error: 'No available servers',
      }));
    }

    log.info(
      `🎯 Allocating ${readyMatches.length} match(es) to ${availableServers.length} server(s)`
    );

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
        log.info(`➡️  Allocating match ${match.slug} to server ${server.name} (${server.id})`);

        // Update match with server_id
        await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [match.slug]);

        // Emit websocket event for server assignment
        const matchWithServer = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
          match.slug,
        ]);
        if (matchWithServer) {
          emitMatchUpdate(matchWithServer);
          emitBracketUpdate({
            action: 'server_assigned',
            matchSlug: match.slug,
            serverId: server.id,
          });
        }

        // Load match on server
        const loadResult = await loadMatchOnServer(match.slug, server.id, { baseUrl });

        if (loadResult.success) {
          log.matchAllocated(match.slug, server.id, server.name);
          results.push({
            matchSlug: match.slug,
            serverId: server.id,
            success: true,
          });
          serverIndex++; // Move to next server for next match
        } else {
          log.error(`Failed to load match ${match.slug} on ${server.name}`, undefined, {
            error: loadResult.error,
          });
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

    log.info(
      `📈 Allocation complete: ${results.filter((r) => r.success).length} successful, ${
        results.filter((r) => !r.success).length
      } failed`
    );

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
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
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
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Emit websocket event for server assignment
      const matchWithServer = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
        matchSlug,
      ]);
      if (matchWithServer) {
        emitMatchUpdate(matchWithServer);
        emitBracketUpdate({ action: 'server_assigned', matchSlug, serverId: server.id });
      }

      // Load match on server
      const loadResult = await loadMatchOnServer(matchSlug, server.id, { baseUrl });

      if (loadResult.success) {
        log.matchAllocated(matchSlug, server.id, server.name);
        return {
          success: true,
          serverId: server.id,
        };
      } else {
        // Rollback server_id if loading failed
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
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
    log.info('🚀 ==================== STARTING TOURNAMENT ====================');
    log.info(`Base URL: ${baseUrl}`);

    // Check if tournament exists and is ready
    const tournament = await tournamentService.getTournament();
    if (!tournament) {
      log.error('No tournament exists');
      return {
        success: false,
        message: 'No tournament exists',
        allocated: 0,
        failed: 0,
        results: [],
      };
    }

    log.info(`Tournament: ${tournament.name} (${tournament.type}, ${tournament.format})`);
    log.info(`Current status: ${tournament.status}`);
    log.info(`Teams: ${tournament.teamIds.length}`);

    if (tournament.status === 'completed') {
      log.warn('Tournament is already completed');
      return {
        success: false,
        message: 'Tournament is already completed. Please create a new tournament.',
        allocated: 0,
        failed: 0,
        results: [],
      };
    } else if (
      tournament.status !== 'setup' &&
      tournament.status !== 'ready' &&
      tournament.status !== 'in_progress'
    ) {
      log.warn(`Invalid tournament status: ${tournament.status}`);
      return {
        success: false,
        message: `Tournament is in '${tournament.status}' status. Must be 'setup', 'ready', or 'in_progress' to start.`,
        allocated: 0,
        failed: 0,
        results: [],
      };
    }

    // Check if bracket/matches exist
    const matchCount = await db.queryOneAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1'
    );

    if (!matchCount || matchCount.count === 0) {
      log.warn('No matches found - regenerating bracket before starting');
      try {
        await tournamentService.regenerateBracket(true);
        log.success('Bracket regenerated successfully');
      } catch (err) {
        log.error('Failed to regenerate bracket', err);
        return {
          success: false,
          message:
            'No matches exist and bracket regeneration failed. Please regenerate bracket manually.',
          allocated: 0,
          failed: 0,
          results: [],
        };
      }
    }

    // Determine if this tournament uses veto system
    const requiresVeto = ['bo1', 'bo3', 'bo5'].includes(tournament.format.toLowerCase());

    let results = [];
    let allocated = 0;
    let failed = 0;

    if (requiresVeto) {
      // ALL BO formats (BO1/BO3/BO5) require veto - applies to all tournament types
      // Update status first so teams can access veto interface
      log.info('BO format detected - teams must complete map veto before matches load');

      if (tournament.status === 'setup' || tournament.status === 'ready') {
        await db.updateAsync(
          'tournament',
          {
            status: 'in_progress',
            started_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
          },
          'id = ?',
          [1]
        );
        log.success(`Tournament started! Teams can now begin map veto.`);

        // Emit tournament update so teams know veto is available
        emitTournamentUpdate({ id: 1, status: 'in_progress' });
        emitBracketUpdate({ action: 'tournament_started' });
      }

      return {
        success: true,
        message:
          'Tournament started! Teams can now complete map veto. Matches will load after veto completion.',
        allocated: 0,
        failed: 0,
        results: [],
      };
    } else {
      // Non-BO formats: Load matches immediately (no veto required)
      log.info('Non-BO format detected - loading matches immediately');

      // Allocate servers to matches
      log.info('Allocating servers to matches...');
      results = await this.allocateServersToMatches(baseUrl);
      log.info(`Allocation complete: ${results.length} matches processed`);

      allocated = results.filter((r) => r.success).length;
      failed = results.filter((r) => !r.success).length;

      // Update tournament status to 'in_progress' if starting for the first time
      if ((tournament.status === 'setup' || tournament.status === 'ready') && allocated > 0) {
        await db.updateAsync(
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

      // Check for pending matches waiting for veto
      let message: string;
      if (allocated > 0) {
        message = `Tournament started! ${allocated} match(es) allocated to servers${
          failed > 0 ? `, ${failed} failed` : ''
        }`;
      } else if (failed > 0) {
        message = `Failed to allocate any matches. ${failed} match(es) could not be loaded.`;
      } else {
        // Check if there are pending matches waiting for veto
        const pendingMatches = await db.queryAsync<DbMatchRow>(
          `SELECT * FROM matches 
           WHERE tournament_id = 1 
           AND status = 'pending'`
        );

        const requiresVeto = ['bo1', 'bo3', 'bo5'].includes(tournament.format.toLowerCase());

        if (pendingMatches.length > 0 && requiresVeto) {
          message = `No matches ready for allocation. ${pendingMatches.length} match(es) are waiting for map veto to be completed by teams. Matches will auto-allocate after veto completion.`;
        } else if (pendingMatches.length > 0) {
          message = `No matches ready for allocation. ${pendingMatches.length} match(es) are pending.`;
        } else {
          message = 'No matches ready for allocation.';
        }
      }

      return {
        success: allocated > 0,
        message,
        allocated,
        failed,
        results,
      };
    }
  }

  /**
   * Restart tournament - run css_restart on all servers with loaded matches, then reallocate
   */
  async restartTournament(baseUrl: string): Promise<{
    success: boolean;
    message: string;
    allocated: number;
    failed: number;
    restarted: number;
    restartFailed: number;
    results: Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    log.info('🔄 ==================== RESTARTING TOURNAMENT ====================');
    log.info(`Base URL: ${baseUrl}`);

    // Check if tournament exists
    const tournament = await tournamentService.getTournament();
    if (!tournament) {
      log.error('No tournament exists');
      return {
        success: false,
        message: 'No tournament exists',
        allocated: 0,
        failed: 0,
        restarted: 0,
        restartFailed: 0,
        results: [],
      };
    }

    log.info(`Tournament: ${tournament.name} (${tournament.type}, ${tournament.format})`);

    // Get all servers that have loaded matches
    const loadedMatches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE tournament_id = 1 
       AND status IN ('loaded', 'live')
       AND server_id IS NOT NULL 
       AND server_id != ''`
    );

    log.info(`Found ${loadedMatches.length} loaded/live match(es) to restart`);

    // Restart each server with a loaded match
    let restarted = 0;
    let restartFailed = 0;
    const serverIds = new Set<string>();

    for (const match of loadedMatches) {
      if (match.server_id) {
        serverIds.add(match.server_id);
      }
    }

    log.info(`Restarting ${serverIds.size} server(s)...`);

    for (const serverId of serverIds) {
      try {
        log.info(`🔄 Ending match on server: ${serverId}`);
        const result = await rconService.sendCommand(serverId, 'css_restart');

        if (result.success) {
          log.success(`✓ Match ended on server ${serverId}`);
          restarted++;

          // Wait a moment for the server to clean up
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          log.error(`Failed to end match on server ${serverId}`, undefined, {
            error: result.error,
          });
          restartFailed++;
        }
      } catch (error) {
        log.error(`Error ending match on server ${serverId}`, error);
        restartFailed++;
      }
    }

    // Reset all loaded/live matches back to 'ready' status
    if (loadedMatches.length > 0) {
      await db.execAsync(
        `UPDATE matches 
         SET status = 'ready', 
             loaded_at = NULL,
             server_id = NULL
         WHERE tournament_id = 1 
         AND status IN ('loaded', 'live')`
      );
      log.info(`✓ Reset ${loadedMatches.length} match(es) to 'ready' status`);
    }

    // Now run the normal start tournament flow
    log.info('Starting tournament allocation after restart...');
    const startResult = await this.startTournament(baseUrl);

    log.info('🔄 ========================================================');

    return {
      success: startResult.success,
      message: `Tournament restarted! ${restarted} match(es) ended. ${
        startResult.allocated
      } match(es) reallocated.${
        restartFailed > 0 ? ` ${restartFailed} match(es) failed to end.` : ''
      }${startResult.failed > 0 ? ` ${startResult.failed} match(es) failed to reload.` : ''}`,
      allocated: startResult.allocated,
      failed: startResult.failed,
      restarted,
      restartFailed,
      results: startResult.results,
    };
  }

  /**
   * Restart a single match - end it and reload it on the same server
   */
  async restartMatch(
    matchSlug: string,
    baseUrl: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    log.info(`🔄 Restarting match: ${matchSlug}`);

    try {
      // Get the match
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);

      if (!match) {
        return {
          success: false,
          message: 'Match not found',
          error: 'Match not found',
        };
      }

      if (!match.server_id) {
        return {
          success: false,
          message: 'Match has no server assigned',
          error: 'No server assigned',
        };
      }

      const status = match.status as string;
      if (status !== 'loaded' && status !== 'live') {
        return {
          success: false,
          message: `Match is in '${status}' status. Can only restart loaded/live matches.`,
          error: `Invalid status: ${status}`,
        };
      }

      const serverId = match.server_id;

      // Step 1: End the current match
      log.info(`Ending match ${matchSlug} on server ${serverId}`);
      const endResult = await rconService.sendCommand(serverId, 'css_restart');

      if (!endResult.success) {
        return {
          success: false,
          message: `Failed to end match: ${endResult.error}`,
          error: endResult.error,
        };
      }

      log.success(`✓ Match ${matchSlug} ended successfully`);

      // Step 2: Wait a few seconds for server to clean up
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Step 3: Reset match status to 'ready'
      await db.updateAsync('matches', { status: 'ready', loaded_at: null }, 'slug = ?', [matchSlug]);

      // Step 4: Reload the match on the same server
      log.info(`Reloading match ${matchSlug} on server ${serverId}`);
      const loadResult = await loadMatchOnServer(matchSlug, serverId, { baseUrl });

      if (loadResult.success) {
        log.success(`✓ Match ${matchSlug} restarted successfully`);
        return {
          success: true,
          message: 'Match restarted successfully',
        };
      } else {
        return {
          success: false,
          message: `Match ended but failed to reload: ${loadResult.error}`,
          error: loadResult.error,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Error restarting match ${matchSlug}`, error);
      return {
        success: false,
        message: `Error restarting match: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // Track polling intervals to avoid duplicate polling
  private pollingIntervals = new Map<string, NodeJS.Timeout>();

  /**
   * Start polling for available servers for a specific match
   * Checks every 10 seconds and stops when server is allocated or match is no longer ready
   */
  startPollingForServer(matchSlug: string, baseUrl: string): void {
    // Don't start duplicate polling for the same match
    if (this.pollingIntervals.has(matchSlug)) {
      log.debug(`Already polling for match ${matchSlug}, skipping duplicate`);
      return;
    }

    log.info(`🔄 Starting server polling for match ${matchSlug} (checking every 10 seconds)`);

    const pollInterval = setInterval(async () => {
      try {
        // Check if match still exists and is ready
        const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
        
        if (!match) {
          log.debug(`Match ${matchSlug} no longer exists, stopping polling`);
          this.stopPollingForServer(matchSlug);
          return;
        }

        // If match already has a server, stop polling
        if (match.server_id) {
          log.success(`Match ${matchSlug} already has server ${match.server_id}, stopping polling`);
          this.stopPollingForServer(matchSlug);
          return;
        }

        // If match is no longer in ready status, stop polling
        if (match.status !== 'ready') {
          log.debug(`Match ${matchSlug} is no longer ready (status: ${match.status}), stopping polling`);
          this.stopPollingForServer(matchSlug);
          return;
        }

        // Try to allocate server
        log.debug(`[Polling] Attempting to allocate server for match ${matchSlug}...`);
        const result = await this.allocateSingleMatch(matchSlug, baseUrl);

        if (result.success) {
          log.success(`✅ [Polling] Successfully allocated server ${result.serverId} to match ${matchSlug}`);
          this.stopPollingForServer(matchSlug);
        } else {
          log.debug(`[Polling] No server available for match ${matchSlug}: ${result.error}`);
          // Continue polling on next interval
        }
      } catch (error) {
        log.error(`Error during polling for match ${matchSlug}`, error);
        // Continue polling even on error
      }
    }, 10000); // Check every 10 seconds

    this.pollingIntervals.set(matchSlug, pollInterval);
  }

  /**
   * Stop polling for a specific match
   */
  stopPollingForServer(matchSlug: string): void {
    const interval = this.pollingIntervals.get(matchSlug);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(matchSlug);
      log.debug(`Stopped polling for match ${matchSlug}`);
    }
  }

  /**
   * Stop all polling intervals (cleanup on shutdown)
   */
  stopAllPolling(): void {
    for (const [matchSlug, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
      log.debug(`Stopped polling for match ${matchSlug} during cleanup`);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Convert database row to BracketMatch
   */
  private async rowToMatch(row: DbMatchRow): Promise<BracketMatch> {
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
      const team1 = await db.queryOneAsync<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.team1_id]
      );
      if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
    }
    if (row.team2_id) {
      const team2 = await db.queryOneAsync<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.team2_id]
      );
      if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
    }
    if (row.winner_id) {
      const winner = await db.queryOneAsync<{ id: string; name: string; tag: string | null }>(
        'SELECT id, name, tag FROM teams WHERE id = ?',
        [row.winner_id]
      );
      if (winner) match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
    }

    return match;
  }
}

export const matchAllocationService = new MatchAllocationService();
