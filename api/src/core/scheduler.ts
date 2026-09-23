/**
 * Core scheduler: which matches are ready, the allocation queue, batch waves,
 * and starting or restarting a tournament.
 *
 * The scheduler decides when a match gets a resource; the match's game
 * integration decides which resource and puts the match on it. Everything
 * game-specific goes through the registry: `capacity()`, `allocate()` and
 * `allocateBatch()` for allocation, `restart()`, `load()` and `cancel()` for
 * the admin actions on a match's resource, and `checkStart()` /
 * `prepareStart()` for the tournament start preflight (CS2:
 * integrations/cs2/allocation.ts and integrations/cs2/tournamentStart.ts).
 */

import { db } from '../config/database';
import { tournamentService } from '../services/tournamentService';
import { emitTournamentUpdate, emitBracketUpdate } from '../services/socketService';
import { generateRoundMatches, advanceToNextRound } from '../services/shuffleTournamentService';
import { resolveTournamentId, tournamentIdForMatch } from '../utils/tournamentRow';
import { log } from '../utils/logger';
import { settingsService } from '../services/settingsService';
import type { DbMatchRow } from '../types/database.types';
import type { BracketMatch } from '../types/tournament.types';
import { integrationForMatch } from '../integrations/registry';
import type {
  AllocateResult,
  CancelReason,
  GameIntegration,
  ResourceActionResult,
  ResourcePoolStatus,
  StartCheckResult,
} from '../integrations/types';
import { matchContextFor } from '../utils/matchIntegration';
import {
  batchServerTarget,
  checkQueueTurn,
  QUEUE_ORDER_SQL,
  TEAM_BUSY_MATCH_SQL,
  withoutBusyTeams,
  type QueueEntry,
} from './allocationQueue';

/** allocateSingleMatch result while a team of the match is still playing (#224). */
const TEAM_BUSY_ERROR = 'Waiting for a team to finish its current match';

/** One match's allocation outcome, as the start/restart routes report it. */
export interface MatchAllocationResult {
  matchSlug: string;
  serverId?: string;
  success: boolean;
  error?: string;
}

/** An integration's allocation outcome in the shape the allocator reports. */
function toMatchAllocationResult(matchSlug: string, outcome: AllocateResult): MatchAllocationResult {
  switch (outcome.status) {
    case 'assigned':
      return {
        matchSlug,
        success: true,
        ...(outcome.resourceId ? { serverId: outcome.resourceId } : {}),
      };
    case 'queued':
      return { matchSlug, success: false, error: outcome.reason };
    default:
      return {
        matchSlug,
        success: false,
        ...(outcome.resourceId ? { serverId: outcome.resourceId } : {}),
        error: outcome.error,
      };
  }
}

/** An integration without resources (capacity null) never runs out. */
function capacityCount(capacity: number | null): number {
  return capacity ?? Number.POSITIVE_INFINITY;
}

const EMPTY_POOL: ResourcePoolStatus = {
  availableCount: 0,
  gracePeriodSeconds: 0,
  nextAllocationInSeconds: null,
  resources: [],
  offlineCount: 0,
  busyCount: 0,
  graceWindowCount: 0,
};

/** What ending the matches on their resources reports (tournament restart, reset, delete). */
export interface EndMatchesOutcome {
  /** Resources told to end their match. */
  ended: number;
  /** Resources that could not be told. */
  failed: number;
}

/**
 * Automatic allocation of tournament matches: which matches are ready, the
 * queue order, a team playing one match at a time, batch waves, and starting
 * or restarting a tournament. See the note at the top of the file.
 */
export class Scheduler {
  /** Last contention summary logged by getAllocationStatus, to log changes only. */
  private lastContentionSummary: string | null = null;

  /**
   * The integration that runs a tournament's matches. Rows without a `game`
   * belong to CS2 (see integrationForMatch).
   */
  private async integrationForTournament(tournamentId: number): Promise<GameIntegration> {
    const row = await db.queryOneAsync<{ game: string | null }>(
      'SELECT game FROM tournament WHERE id = ?',
      [tournamentId]
    );
    return integrationForMatch(row ?? {});
  }

  /**
   * How long a freed resource rests before the next match (CS2: the server
   * grace period, shorter in simulation mode). Shuffle round advancement waits
   * this long before allocating the new round.
   */
  async getEffectiveGracePeriodSeconds(tournamentId: number): Promise<number> {
    const integration = await this.integrationForTournament(tournamentId);
    return (await integration.turnoverSeconds?.()) ?? 0;
  }

  /** Resources that can take one of the tournament's matches right now. */
  async getAvailableServerCount(tournamentId: number): Promise<number> {
    const integration = await this.integrationForTournament(tournamentId);
    return capacityCount(await integration.capacity({ tournamentId }));
  }

  /**
   * Get high-level allocation status for UI:
   * - availableServerCount: number of servers that can be allocated *right now*
   * - gracePeriodSeconds: the effective grace period currently in use
   * - nextAllocationInSeconds: if all servers are in a grace window, the number
   *   of seconds until the *first* server exits that window and becomes
   *   eligible for allocation again. Returns null when no grace window applies.
   * - requiredServerCount: how many matches are waiting for servers
   * - servers: the integration's per-server snapshot, so UIs can surface which
   *   servers are still busy or within their cooldown window.
   */
  async getAllocationStatus(tournamentId: number): Promise<{
    availableServerCount: number;
    gracePeriodSeconds: number;
    nextAllocationInSeconds: number | null;
    requiredServerCount: number;
    servers: ResourcePoolStatus['resources'];
  }> {
    const integration = await this.integrationForTournament(tournamentId);
    const pool = integration.poolStatus
      ? await integration.poolStatus({ tournamentId })
      : EMPTY_POOL;
    const {
      availableCount: availableServerCount,
      gracePeriodSeconds,
      nextAllocationInSeconds,
      offlineCount,
      busyCount,
      graceWindowCount,
    } = pool;

    // How many matches are currently waiting for servers (ready + no server_id)
    const readyMatches = await this.getReadyMatches(tournamentId);
    const requiredServerCount = readyMatches.length;

    // This method is called both by UI endpoints (the start dialog polls it
    // every few seconds) and allocator helpers. Summarise contention once when
    // it starts or changes; repeats of the same picture go to debug.
    if (requiredServerCount > 0 && availableServerCount === 0) {
      const summary =
        `[ALLOCATION] Status: ${requiredServerCount} match(es) waiting for servers, ` +
        `${availableServerCount} allocatable, ${offlineCount} offline, ` +
        `${busyCount} busy, ${graceWindowCount} in grace window`;
      if (summary !== this.lastContentionSummary) {
        this.lastContentionSummary = summary;
        log.info(summary);
      } else {
        log.debug(summary);
      }

      if (nextAllocationInSeconds !== null) {
        log.debug(
          `[ALLOCATION] Next server exits grace window in ~${nextAllocationInSeconds}s (grace=${gracePeriodSeconds}s)`
        );
      }
    } else {
      this.lastContentionSummary = null;
    }

    return {
      availableServerCount,
      gracePeriodSeconds,
      nextAllocationInSeconds,
      requiredServerCount,
      servers: pool.resources,
    };
  }

  /** Teams that are in a loaded or live match, or one being loaded (#224). */
  private async getBusyTeamIds(): Promise<Set<string>> {
    const rows = await db.queryAsync<{ team1_id: string | null; team2_id: string | null }>(
      TEAM_BUSY_MATCH_SQL
    );
    const busy = new Set<string>();
    for (const row of rows) {
      if (row.team1_id) busy.add(row.team1_id);
      if (row.team2_id) busy.add(row.team2_id);
    }
    return busy;
  }

  /** Ready match rows waiting for a server, in queue order (see getReadyMatches). */
  private async getReadyMatchRows(tournamentId: number): Promise<DbMatchRow[]> {
    const matches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches
       WHERE tournament_id = ?
       AND status = 'ready'
       AND (server_id IS NULL OR server_id = '')
       ORDER BY ${QUEUE_ORDER_SQL}`,
      [tournamentId]
    );

    const startable = withoutBusyTeams(
      matches.map((row) => ({ row, team1Id: row.team1_id, team2Id: row.team2_id })),
      await this.getBusyTeamIds()
    );
    return startable.map(({ row }) => row);
  }

  /**
   * Get all ready matches that need server allocation, in queue order. A match
   * whose team is still playing (or claimed by an earlier match in the queue)
   * is not ready yet: see withoutBusyTeams.
   */
  async getReadyMatches(tournamentId: number): Promise<BracketMatch[]> {
    const rows = await this.getReadyMatchRows(tournamentId);
    return Promise.all(rows.map((row) => this.rowToMatch(row)));
  }

  /**
   * Ready bracket matches waiting for a server, in queue order, without the
   * team lookups getReadyMatches does. Matches allocateSingleMatch would refuse
   * anyway (a team missing, or both slots the same team, or a team still
   * playing: see withoutBusyTeams) are left out so they cannot hold up the
   * matches behind them.
   */
  private async getAllocationQueue(tournamentId: number): Promise<QueueEntry[]> {
    const rows = await db.queryAsync<{
      id: number;
      slug: string;
      round: number;
      match_number: number;
      bracket: string | null;
      team1_id: string;
      team2_id: string;
    }>(
      `SELECT id, slug, round, match_number, bracket, team1_id, team2_id FROM matches
       WHERE tournament_id = ?
       AND status = 'ready'
       AND (server_id IS NULL OR server_id = '')
       AND team1_id IS NOT NULL AND team2_id IS NOT NULL AND team1_id != team2_id
       ORDER BY ${QUEUE_ORDER_SQL}`,
      [tournamentId]
    );
    const queue = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      round: row.round,
      matchNumber: row.match_number,
      bracket: row.bracket,
      team1Id: row.team1_id,
      team2Id: row.team2_id,
    }));
    return withoutBusyTeams(queue, await this.getBusyTeamIds());
  }

  /**
   * Hand a wave of ready matches to the integration in one go. It pairs them
   * with the resources free right now, in queue order; the rest come back as
   * "No available servers" and are retried by later passes/polling.
   */
  private async allocateWave(
    tournamentId: number,
    rows: DbMatchRow[],
    baseUrl: string
  ): Promise<MatchAllocationResult[]> {
    const integration = await this.integrationForTournament(tournamentId);
    const ctxs = await Promise.all(rows.map((row) => matchContextFor(row)));
    const outcomes = integration.allocateBatch
      ? await integration.allocateBatch(ctxs, { baseUrl })
      : await Promise.all(ctxs.map((ctx) => integration.allocate(ctx, { baseUrl })));
    return outcomes.map((outcome, i) => toMatchAllocationResult(rows[i].slug, outcome));
  }

  /**
   * Allocate servers to ready matches
   * Returns allocation results for each match
   */
  async allocateServersToMatches(
    tournamentId: number,
    baseUrl: string
  ): Promise<MatchAllocationResult[]> {
    log.info('[ALLOCATION] Getting ready matches...');
    const readyMatches = await this.getReadyMatchRows(tournamentId);
    log.info(`Found ${readyMatches.length} ready match(es) to allocate`);

    if (readyMatches.length === 0) {
      log.info('[ALLOCATION] No ready matches to allocate');
      return [];
    }

    const results = await this.allocateWave(tournamentId, readyMatches, baseUrl);

    log.info(
      `[ALLOCATION] Allocation complete: ${results.filter((r) => r.success).length} successful, ${
        results.filter((r) => !r.success).length
      } failed`
    );

    return results;
  }

  /**
   * Allocate servers to a specific list of matches (by slug), using the same
   * strategy as allocateServersToMatches but restricted to the provided
   * matches. Used by shuffle round advancement so that only the newly
   * generated round's matches are considered.
   */
  async allocateSpecificMatches(
    tournamentId: number,
    matchSlugs: string[],
    baseUrl: string
  ): Promise<MatchAllocationResult[]> {
    const uniqueSlugs = Array.from(new Set(matchSlugs));
    if (uniqueSlugs.length === 0) {
      return [];
    }

    log.info(
      `[ALLOCATION] Allocating specific matches: ${uniqueSlugs.length} match(es) requested`,
      { matchSlugs: uniqueSlugs }
    );

    const allReadyMatches = await this.getReadyMatchRows(tournamentId);
    const readyMatches = allReadyMatches.filter((m) => uniqueSlugs.includes(m.slug));

    if (readyMatches.length === 0) {
      log.info('[ALLOCATION] No ready matches among requested slugs');
      return uniqueSlugs.map((slug) => ({
        matchSlug: slug,
        success: false,
        error: 'Match is not ready or does not exist',
      }));
    }

    // For shuffle round advancement and other batch-style allocations we want
    // to avoid starting only a subset of a round's matches while the rest sit
    // "waiting for server". Follow the MatchZy guidance and poll until we have
    // enough truly idle servers (status=idle, beyond grace period) to cover
    // the requested ready matches, or until a reasonable timeout is reached.
    // Never wait for more servers than exist (#226): with more matches than
    // servers, start one per server and poll the rest (see batchServerTarget).
    const { servers: configuredServers } = await this.getAllocationStatus(tournamentId);
    const requiredServers = batchServerTarget(readyMatches.length, configuredServers);
    const POLL_INTERVAL_MS = 10_000; // 10s, per MatchZy best practices
    const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes hard cap
    const deadline = Date.now() + MAX_WAIT_MS;

    let availableServers = await this.getAvailableServerCount(tournamentId);
    while (
      availableServers > 0 &&
      availableServers < requiredServers &&
      Date.now() < deadline
    ) {
      log.info(
        `[ALLOCATION] Waiting for idle servers before batch allocation: ${availableServers}/${requiredServers} available`
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      availableServers = await this.getAvailableServerCount(tournamentId);
    }

    // The integration takes the final snapshot of free servers as it allocates.
    log.info(
      `[ALLOCATION] Allocating ${readyMatches.length} specific match(es) (required=${requiredServers})`
    );
    const results = await this.allocateWave(tournamentId, readyMatches, baseUrl);

    log.info(
      `[ALLOCATION] Specific allocation complete: ${
        results.filter((r) => r.success).length
      } successful, ${results.filter((r) => !r.success).length} failed`
    );

    return results;
  }

  /**
   * Allocate a single specific match to the first available server, once it
   * is its turn in the queue.
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
      // Check if match already has a server and is structurally valid
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
        matchSlug,
      ]);
      if (!match) {
        return { success: false, error: 'Match not found' };
      }

      if (match.server_id) {
        return { success: false, error: 'Match already has a server allocated' };
      }

      if (match.status !== 'ready') {
        return { success: false, error: `Match is not ready (status: ${match.status})` };
      }

      // Hard safety checks: do not ever allocate / load matches that are not
      // structurally valid in the *bracket*. For manual matches (round = 0,
      // no tournament_id) we allow ad‑hoc teams that only exist in the config,
      // so we skip the DB team_id checks entirely.
      const isBracketMatch =
        typeof match.round === 'number' && match.round >= 1 && match.tournament_id !== null;

      if (isBracketMatch) {
        if (!match.team1_id || !match.team2_id) {
          return {
            success: false,
            error: 'Match does not have both teams assigned yet',
          };
        }
        if (match.team1_id === match.team2_id) {
          return {
            success: false,
            error: 'Invalid match: team1 and team2 are the same team',
          };
        }
      }

      const integration = integrationForMatch(match);
      const freeServerCount = capacityCount(
        await integration.capacity({ tournamentId: match.tournament_id ?? null, slug: matchSlug })
      );
      if (freeServerCount === 0) {
        return { success: false, error: 'No available servers' };
      }

      // Hand servers out in queue order. Each ready match polls on its own
      // timer, so without this the first poller to tick after a server frees
      // up takes it, whatever its queue position.
      const queue = await this.getAllocationQueue(tournamentIdForMatch(match));
      // A team plays one match at a time (#224): a bracket match is left out of
      // the queue while either team is in a loaded/live match, or an earlier
      // match in the queue has claimed it. Hold it; it is retried later.
      if (isBracketMatch && !queue.some((entry) => entry.slug === matchSlug)) {
        return { success: false, error: TEAM_BUSY_ERROR };
      }
      const turn = checkQueueTurn(queue, matchSlug, freeServerCount);
      if (!turn.allowed) {
        log.debug(
          `[ALLOCATION] Holding match ${matchSlug} (queue position ${turn.position}) for ${turn.ahead.length} earlier match(es); ${freeServerCount} server(s) free`,
          { ahead: turn.ahead.map((entry) => entry.slug) }
        );
        // The matches ahead must be retried, or this one waits forever.
        for (const entry of turn.ahead) {
          this.startPollingForServer(entry.slug, baseUrl);
        }
        return {
          success: false,
          error: `Waiting for ${turn.ahead.length} earlier match(es) in the queue`,
        };
      }

      // Its turn: the integration picks the server and loads the match.
      const outcome = await integration.allocate(await matchContextFor(match), { baseUrl });
      const { success, serverId, error } = toMatchAllocationResult(matchSlug, outcome);
      return {
        success,
        ...(serverId ? { serverId } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // If anything goes wrong after a server_id was assigned, clear it so
      // polling/allocation can safely retry on another server.
      try {
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
      } catch (rollbackError) {
        log.error(
          `Failed to roll back server_id for match ${matchSlug} after allocation error`,
          rollbackError
        );
      }
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
  async startTournament(tournamentId: number, baseUrl: string): Promise<{
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
    log.info('==================== STARTING TOURNAMENT ====================');
    log.info(`Base URL: ${baseUrl}`);

    // Check if tournament exists and is ready
    const tournament = await tournamentService.getTournament(tournamentId);
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

    // Hard safety check: ensure all referenced teams still exist at the moment
    // the tournament is started. This prevents brackets from silently using
    // "ghost" teams that were deleted or renamed after initial setup.
    if (tournament.type !== 'shuffle' && tournament.teamIds.length > 0) {
      const teamIds = tournament.teamIds;
      const placeholders = teamIds.map(() => '?').join(',');
      const existingTeams = await db.queryAsync<{ id: string }>(
        `SELECT id FROM teams WHERE id IN (${placeholders})`,
        teamIds
      );
      const existingIds = new Set(existingTeams.map((t) => t.id));
      const missingIds = teamIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        const message =
          missingIds.length === 1
            ? `Cannot start tournament: team '${missingIds[0]}' no longer exists. Update the Teams list on the tournament setup page and regenerate the bracket.`
            : `Cannot start tournament: ${missingIds.length} teams referenced by this tournament no longer exist (${missingIds.join(
                ', '
              )}). Update the Teams list on the tournament setup page and regenerate the bracket.`;

        log.warn('[TOURNAMENT] Start rejected due to missing teams', { missingIds });
        return {
          success: false,
          message,
          allocated: 0,
          failed: 0,
          results: [],
        };
      }
    }

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

    // Check if bracket/matches exist (coerce COUNT(*) to number explicitly)
    const matchCountRow = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = ?',
      [tournamentId]
    );
    const totalMatches = Number(matchCountRow?.count ?? 0);

    if (totalMatches === 0) {
      // For shuffle tournaments, generate the first round (regardless of BO format / servers)
      if (tournament.type === 'shuffle') {
        log.info('No matches found - generating first round for shuffle tournament');
        try {
          const result = await advanceToNextRound(tournamentId);
          if (!result) {
            // This should not normally happen for a brand new shuffle tournament where
            // no rounds have been generated yet. Treat it as a hard failure so the UI
            // can surface a clear error instead of silently doing nothing.
            log.error('Failed to generate first round for shuffle tournament (no result returned)');
            return {
              success: false,
              message:
                'First round generation failed for shuffle tournament. Please check tournament configuration and registered players.',
              allocated: 0,
              failed: 0,
              results: [],
            };
          }
          log.success(
            `Generated round ${result.roundNumber} with ${result.matches.length} match(es)`
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error('Failed to generate first round for shuffle tournament', err);
          return {
            success: false,
            message:
              `First round generation failed for shuffle tournament: ${errorMessage}. ` +
              'Please check tournament configuration and registered players.',
            allocated: 0,
            failed: 0,
            results: [],
          };
        }
      } else {
        // For other tournament types, regenerate bracket
        log.warn('No matches found - regenerating bracket before starting');
        try {
          await tournamentService.regenerateBracket(tournamentId, true);
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
    } else if (tournament.type === 'shuffle') {
      // Extra safety: if tournament is shuffle and there are *no* shuffle matches yet,
      // ensure we still generate round 1 before proceeding (helps in edge cases with stale data)
      const shuffleMatchCountRow = await db.queryOneAsync<{ count: number | string }>(
        "SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND slug LIKE 'shuffle-%'",
        [tournamentId]
      );
      const shuffleMatches = Number(shuffleMatchCountRow?.count ?? 0);

      if (shuffleMatches === 0) {
        log.info(
          'Shuffle tournament has existing matches but no shuffle rounds yet - generating first round'
        );
        try {
          const result = await advanceToNextRound(tournamentId);
          if (!result) {
            // In this path we know matches exist but none are shuffle rounds yet.
            // If advanceToNextRound returns null, it usually means the current round
            // is not complete. Surface a more helpful explanation.
            log.error(
              'Failed to generate first round for shuffle tournament (post existing-match check, no result returned)'
            );
            return {
              success: false,
              message:
                'Cannot generate next shuffle round: current round is not complete or tournament state is inconsistent. Please ensure all matches are completed before advancing.',
              allocated: 0,
              failed: 0,
              results: [],
            };
          }
          log.success(
            `Generated round ${result.roundNumber} with ${result.matches.length} match(es) for shuffle tournament`
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error(
            'Failed to generate first round for shuffle tournament (post existing-match check)',
            err
          );
          return {
            success: false,
            message:
              `First round generation failed for shuffle tournament: ${errorMessage}. ` +
              'Please check configuration and registered players.',
            allocated: 0,
            failed: 0,
            results: [],
          };
        }
      }
    }

    // Check server availability before starting
    const availableServerCount = await this.getAvailableServerCount(tournamentId);
    const hasAvailableServers = availableServerCount > 0;

    // Determine if this tournament uses veto system: the game has a veto
    // (pre-match phase) and the format is a series. Shuffle tournaments
    // *never* use veto, even if format is BO1. This gate is tournament-wide on
    // purpose: the per-match `isReadyToAllocate` only holds matches for the
    // simulation auto-veto (see makeMatchReady), so `/restart` of a veto
    // tournament still allocates nothing here.
    const integration = await this.integrationForTournament(tournamentId);
    const requiresVeto =
      integration.capabilities.veto &&
      tournament.type !== 'shuffle' &&
      ['bo1', 'bo3', 'bo5'].includes(tournament.format.toLowerCase());

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
          [tournamentId]
        );
        log.success(`Tournament started! Teams can now begin map veto.`);

        // Emit tournament update so teams know veto is available
        emitTournamentUpdate({ id: tournamentId, status: 'in_progress' });
        emitBracketUpdate({ action: 'tournament_started' });
      }

      // In simulation mode, automatically perform veto and side picks for all matches
      // that are structurally ready (both teams assigned) but have not yet gone
      // through veto. This includes:
      // - Fresh bracket matches in 'pending' status, and
      // - Matches in 'ready' status with no veto_state and no server assigned
      //   (e.g. finals created before we enabled full auto-veto).
      const simulationEnabled = await settingsService.isSimulationModeEnabled();
      if (simulationEnabled) {
        log.info(
          '[VETO-SIM] Simulation mode enabled – auto-veto will run for all pending matches with resolved teams.'
        );

        // Matches with both teams assigned that have not completed veto. Future
        // TBD bracket slots are skipped; they are not "ready" for veto yet.
        const started = (await integration.startPendingPreMatchPhases?.(tournament.id)) ?? [];

        if (started.length === 0) {
          log.warn('[VETO-SIM] No pending matches found for tournament; nothing to auto-veto.');
        }

        let message =
          'Tournament started in simulation mode. Map veto and side picks will be completed automatically, and matches will load as servers become available.';
        if (!hasAvailableServers) {
          message +=
            ' No servers are currently available; matches will be allocated automatically once servers come online.';
          log.warn(
            '[WARNING] Tournament started (simulation mode) but no servers are available. Matches will wait for server availability.'
          );
        }

        return {
          success: true,
          message,
          allocated: 0,
          failed: 0,
          results: [],
        };
      }

      let message =
        'Tournament started! Teams can now complete map veto. Matches will load after veto completion.';
      if (!hasAvailableServers) {
        message +=
          ' No servers are currently available. Matches will be allocated automatically when servers become available.';
        log.warn(
          '[WARNING] Tournament started but no servers are available. Matches will wait for server availability.'
        );
      }

      return {
        success: true,
        message,
        allocated: 0,
        failed: 0,
        results: [],
      };
    } else {
      // Non-BO formats: Load matches immediately (no veto required)
      log.info('Non-BO format detected - loading matches immediately');

      // As soon as we begin the allocation process (or start polling when
      // there are no servers), we consider the tournament "started". This
      // allows UIs and webhooks to react immediately instead of waiting for
      // all allocations to complete.
      if (tournament.status === 'setup' || tournament.status === 'ready') {
        await db.updateAsync(
          'tournament',
          {
            status: 'in_progress',
            started_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
          },
          'id = ?',
          [tournamentId]
        );
        log.success('Tournament started (non-BO format)');

        emitTournamentUpdate({ id: tournamentId, status: 'in_progress' });
        emitBracketUpdate({ action: 'tournament_started' });
      }

      // Check server availability
      if (!hasAvailableServers) {
        log.warn(
          '[WARNING] No servers are currently available. Tournament will start but matches will wait for server availability.'
        );

        // Start polling for all ready matches
        const readyMatches = await this.getReadyMatches(tournamentId);
        for (const match of readyMatches) {
          this.startPollingForServer(match.slug, baseUrl);
        }
        log.info(
          `Started polling for ${readyMatches.length} ready match(es) - will allocate when servers become available`
        );

        return {
          success: true,
          message: `Tournament started! No servers are currently available. ${readyMatches.length} match(es) will be allocated automatically when servers become available.`,
          allocated: 0,
          failed: 0,
          results: [],
        };
      }

      // Allocate servers to matches
      log.info('Allocating servers to matches...');
      results = await this.allocateServersToMatches(tournamentId, baseUrl);
      log.info(`Allocation complete: ${results.length} matches processed`);

      allocated = results.filter((r) => r.success).length;
      failed = results.filter((r) => !r.success).length;

      // Start polling for matches that couldn't be allocated
      const unallocatedMatches = results.filter((r) => !r.success);
      for (const result of unallocatedMatches) {
        this.startPollingForServer(result.matchSlug, baseUrl);
      }
      if (unallocatedMatches.length > 0) {
        log.info(
          `Started polling for ${unallocatedMatches.length} unallocated match(es) - will allocate when servers become available`
        );
      }

      // For shuffle tournaments: auto-generate first round if no matches exist
      if (tournament.type === 'shuffle') {
        const existingMatches = await db.queryAsync<DbMatchRow>(
          'SELECT * FROM matches WHERE tournament_id = ? LIMIT 1',
          [tournamentId]
        );

        if (existingMatches.length === 0) {
          // No matches exist yet - generate first round automatically
          try {
            log.info('Shuffle tournament: Auto-generating first round...');
            const roundResult = await generateRoundMatches(tournamentId, 1);
            log.success(
              `Shuffle tournament: Generated ${roundResult.matches.length} matches for round 1`
            );

            // Allocate servers to the newly generated matches
            // Allocate servers to all matches at once
            const shuffleResults = await this.allocateServersToMatches(tournamentId, baseUrl);

            const shuffleAllocated = shuffleResults.filter((r) => r.success).length;
            const shuffleFailed = shuffleResults.length - shuffleAllocated;

            allocated += shuffleAllocated;
            failed += shuffleFailed;

            // Add shuffle results to main results array
            results.push(...shuffleResults);

            log.info(
              `Shuffle tournament: Allocated ${shuffleAllocated} servers, ${shuffleFailed} failed`
            );
          } catch (error) {
            log.error('Failed to auto-generate first round for shuffle tournament', error);
            throw new Error(
              `Failed to start shuffle tournament: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`
            );
          }
        }
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
           WHERE tournament_id = ? 
           AND status = 'pending'`,
          [tournamentId]
        );

        // Reuse the earlier requiresVeto flag so that shuffle tournaments
        // (which skip veto entirely) are never treated as waiting on veto.
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
  async restartTournament(tournamentId: number, baseUrl: string): Promise<{
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
    log.info('[RESTART] ==================== RESTARTING TOURNAMENT ====================');
    log.info(`Base URL: ${baseUrl}`);

    // Check if tournament exists
    const tournament = await tournamentService.getTournament(tournamentId);
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
       WHERE tournament_id = ? 
       AND status IN ('loaded', 'live')
       AND server_id IS NOT NULL 
       AND server_id != ''`,
      [tournamentId]
    );

    log.info(`Found ${loadedMatches.length} loaded/live match(es) to restart`);

    // Restart each server with a loaded match
    const serverIds = new Set<string>();

    for (const match of loadedMatches) {
      if (match.server_id) {
        serverIds.add(match.server_id);
      }
    }

    log.info(`Restarting ${serverIds.size} server(s)...`);

    // Wait a moment after each restart for the server to clean up
    const { ended: restarted, failed: restartFailed } = await this.endMatchesOnResources(
      loadedMatches,
      { reason: 'tournament-restart', logPrefix: '[RESTART]', delayAfterEachMs: 2000 }
    );

    // Reset all loaded/live matches back to 'ready' status
    if (loadedMatches.length > 0) {
      await db.runAsync(
        `UPDATE matches 
         SET status = 'ready', 
             loaded_at = NULL,
             server_id = NULL
         WHERE tournament_id = ? 
         AND status IN ('loaded', 'live')`,
        [tournamentId]
      );
      log.info(`[RESTART] Reset ${loadedMatches.length} match(es) to 'ready' status`);
    }

    // Now run the normal start tournament flow
    log.info('Starting tournament allocation after restart...');
    const startResult = await this.startTournament(tournamentId, baseUrl);

    log.info('[RESTART] ========================================================');

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
   * End the given matches on their resources, one resource at a time, in the
   * order given (tournament restart, reset, delete and the dev simulation
   * reset). A resource running several of the matches is told once. Counts
   * resources, not matches; a resource that could not be told counts as
   * failed and never stops the rest.
   */
  async endMatchesOnResources(
    matches: DbMatchRow[],
    options: { reason: CancelReason; logPrefix?: string; delayAfterEachMs?: number }
  ): Promise<EndMatchesOutcome> {
    const prefix = options.logPrefix ? `${options.logPrefix} ` : '';
    const byResource = new Map<string, DbMatchRow>();
    for (const match of matches) {
      if (match.server_id && !byResource.has(match.server_id)) {
        byResource.set(match.server_id, match);
      }
    }

    let ended = 0;
    let failed = 0;
    for (const [resourceId, match] of byResource) {
      try {
        log.info(`${prefix}Ending match on server: ${resourceId}`);
        const integration = integrationForMatch(match);
        await integration.cancel?.(await matchContextFor(match), options.reason);
        ended++;

        if (options.delayAfterEachMs && options.delayAfterEachMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayAfterEachMs));
        }
      } catch (error) {
        log.error(`${prefix}Failed to end match on server ${resourceId}`, error);
        failed++;
      }
    }

    return { ended, failed };
  }

  /**
   * The tournament start preflight: the integration checks its resources
   * (CS2: enabled servers run an up-to-date build). A failed check blocks the
   * start.
   */
  async checkStart(tournamentId: number): Promise<StartCheckResult> {
    const integration = await this.integrationForTournament(tournamentId);
    return integration.checkStart ? integration.checkStart({ tournamentId }) : { ok: true };
  }

  /** Get the integration's resources ready for a tournament start (CS2: webhook bootstrap). */
  async prepareStart(tournamentId: number): Promise<void> {
    const integration = await this.integrationForTournament(tournamentId);
    await integration.prepareStart?.({ tournamentId });
  }

  /**
   * The `baseUrl` the tournament's integration needs for allocation (CS2:
   * the webhook URL from Settings). Rejects when the integration needs one
   * and it is not configured; `''` when it needs none, so a game with no
   * servers starts without a webhook URL.
   */
  async resolveBaseUrl(tournamentId: number): Promise<string> {
    const integration = await this.integrationForTournament(tournamentId);
    return integration.resolveBaseUrl ? integration.resolveBaseUrl({ tournamentId }) : '';
  }

  /** `resolveBaseUrl` for one match's integration (the admin match actions). */
  async resolveBaseUrlForMatch(match: DbMatchRow): Promise<string> {
    const integration = integrationForMatch(match);
    return integration.resolveBaseUrl
      ? integration.resolveBaseUrl({ tournamentId: match.tournament_id, slug: match.slug })
      : '';
  }

  /**
   * Admin "load": put the match on the resource it is assigned to. Null when
   * the match's integration has no load action.
   */
  async loadMatch(
    match: DbMatchRow,
    opts: { baseUrl: string; skipWebhook?: boolean }
  ): Promise<ResourceActionResult | null> {
    const integration = integrationForMatch(match);
    if (!integration.load) return null;
    return integration.load(await matchContextFor(match), opts);
  }

  /** Admin "restart": restart the match on its resource. */
  async restartMatch(match: DbMatchRow, opts: { baseUrl: string }): Promise<ResourceActionResult> {
    return integrationForMatch(match).restart(await matchContextFor(match), opts);
  }

  /** Admin "reallocate": move a match that has not gone live to another free resource. */
  async reallocateMatch(match: DbMatchRow, opts: { baseUrl: string }): Promise<ResourceActionResult> {
    return integrationForMatch(match).restart(await matchContextFor(match), {
      ...opts,
      moveResource: true,
    });
  }

  /**
   * Best-effort end of one match on its resource (force-cancel). Rejects when
   * the resource could not be told; the caller records the cancel regardless.
   */
  async cancelMatch(match: DbMatchRow, reason: CancelReason): Promise<void> {
    await integrationForMatch(match).cancel?.(await matchContextFor(match), reason);
  }

  /**
   * A match has just become ready (both teams, a config, status `ready`):
   * try to allocate it now, in its queue turn. Polling and later passes pick
   * it up when it cannot go yet.
   */
  async allocateReadyMatch(matchSlug: string): Promise<void> {
    try {
      const webhookUrl = await settingsService.getWebhookUrl();

      if (!webhookUrl) {
        log.warn(
          'Webhook URL is not configured. Skipping auto-allocation for match. Configure the webhook URL in Settings.'
        );
        return;
      }

      const result = await this.allocateSingleMatch(matchSlug, webhookUrl);

      if (result.success) {
        log.success(`Auto-allocated match ${matchSlug} to server ${result.serverId}`);
        emitBracketUpdate({
          action: 'match_allocated',
          matchSlug,
          serverId: result.serverId,
        });
      } else {
        log.warn(`Could not auto-allocate match ${matchSlug}: ${result.error}`);
      }
    } catch (error) {
      log.error('Error in auto-allocate server', error, { matchSlug });
    }
  }

  /**
   * A new round (shuffle) was generated: allocate its matches as one batch,
   * but only after the inter-round grace window, so there is a pause between
   * rounds even when resources are already free. Matches that cannot go then
   * start polling.
   */
  async scheduleRoundAllocation(
    tournamentId: number,
    roundNumber: number,
    matchSlugs: string[]
  ): Promise<void> {
    try {
      const webhookUrl = await settingsService.getWebhookUrl();
      if (webhookUrl) {
        const delaySeconds = await this.getEffectiveGracePeriodSeconds(tournamentId);
        const slugs = matchSlugs;

        log.info(
          `[ALLOCATION] Scheduling batch allocation of ${slugs.length} shuffle match(es) for round ${roundNumber} in ${delaySeconds}s (inter-round grace window)`
        );

        setTimeout(() => {
          void (async () => {
            try {
              const allocationResults = await this.allocateSpecificMatches(
                tournamentId,
                slugs,
                webhookUrl
              );

              const successful = allocationResults.filter((r) => r.success).length;
              const failed = allocationResults.length - successful;

              if (successful > 0) {
                log.success(`Auto-allocated ${successful} match(es) to servers`);
              }

              if (failed > 0) {
                log.info(
                  `${failed} match(es) could not be allocated immediately; starting polling where appropriate`
                );
                for (const result of allocationResults.filter((r) => !r.success)) {
                  this.startPollingForServer(result.matchSlug, webhookUrl);
                }
              }
            } catch (error) {
              log.error(
                'Error auto-allocating servers to new round matches after grace window',
                error
              );
            }
          })();
        }, delaySeconds * 1000);
      } else {
        log.warn('Webhook URL not configured - cannot auto-allocate servers to new round matches');
      }
    } catch (error) {
      log.error('Error scheduling auto-allocation for new round matches', error);
      // Don't throw - allocation scheduling failure shouldn't break round advancement
    }
  }

  // Track polling intervals to avoid duplicate polling
  private pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

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

    log.info(
      `[POLLING] Starting server polling for match ${matchSlug} (checking every 10 seconds)`
    );

    const pollInterval = setInterval(async () => {
      try {
        // Check if match still exists and is ready
        const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
          matchSlug,
        ]);

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
          log.debug(
            `Match ${matchSlug} is no longer ready (status: ${match.status}), stopping polling`
          );
          this.stopPollingForServer(matchSlug);
          return;
        }

        // Try to allocate server
        log.debug(`[Polling] Attempting to allocate server for match ${matchSlug}...`);
        const result = await this.allocateSingleMatch(matchSlug, baseUrl);

        if (result.success) {
          log.success(
            `[POLLING] Successfully allocated server ${result.serverId} to match ${matchSlug}`
          );
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

  /**
   * Attempt immediate allocation for all ready matches.
   * This should be called when servers become available (match completes, deleted, etc.)
   * to avoid waiting for the next polling cycle.
   */
  async tryImmediateAllocation(): Promise<void> {
    try {
      const webhookUrl = await settingsService.getWebhookUrl();
      if (!webhookUrl) {
        return;
      }

      // Fleet-level trigger (a server freed up): no single tournament in the
      // call chain. 3.1 walks every tournament with ready matches here.
      const tournamentId = resolveTournamentId();
      const readyMatches = await this.getReadyMatches(tournamentId);
      if (readyMatches.length === 0) {
        return;
      }

      const availableCount = await this.getAvailableServerCount(tournamentId);
      if (availableCount === 0) {
        return;
      }

      log.info(
        `[ALLOCATION] Triggering immediate allocation attempt for ${readyMatches.length} ready match(es) (${availableCount} server(s) available)`
      );

      // Try to allocate each ready match (will stop when no more servers available)
      const results = await this.allocateSpecificMatches(
        tournamentId,
        readyMatches.map((m) => m.slug),
        webhookUrl
      );

      const successful = results.filter((r) => r.success).length;
      if (successful > 0) {
        log.success(`[ALLOCATION] Immediately allocated ${successful} match(es)`);
      }

      // Start polling for matches that couldn't be allocated immediately
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0 && failed.length < readyMatches.length) {
        // Only start polling if some (but not all) matches failed,
        // indicating we might have servers available soon
        for (const result of failed) {
          this.startPollingForServer(result.matchSlug, webhookUrl);
        }
      }
    } catch (error) {
      log.error('Error in tryImmediateAllocation', error);
    }
  }
}

export const scheduler = new Scheduler();

/**
 * An allocation "failure" that only means the match is queued: no server is
 * free yet, or earlier matches are ahead of it. Normal, so not warn-worthy.
 */
export function isQueuedAllocationResult(error: string | undefined | null): boolean {
  return (
    typeof error === 'string' &&
    (error === 'No available servers' ||
      error === TEAM_BUSY_ERROR ||
      /earlier match\(es\) in the queue/.test(error))
  );
}
