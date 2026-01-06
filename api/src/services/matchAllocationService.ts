import { db } from '../config/database';
import { serverService } from './serverService';
import { rconService } from './rconService';
import { tournamentService } from './tournamentService';
import { emitTournamentUpdate, emitBracketUpdate, emitMatchUpdate } from './socketService';
import { loadMatchOnServer } from './matchLoadingService';
import { serverStatusService, ServerStatus } from './serverStatusService';
import { generateRoundMatches, advanceToNextRound } from './shuffleTournamentService';
import { log } from '../utils/logger';
import { getLastServerTestEvent } from './serverConnectivityService';
import { settingsService } from './settingsService';
import { autoCompleteVetoForMatch } from './vetoSimulationService';
import type { ServerResponse } from '../types/server.types';
import type { DbMatchRow } from '../types/database.types';
import type { BracketMatch } from '../types/tournament.types';
import { serverAllocationTracker } from './serverAllocationTracker';

/**
 * Service for automatic server allocation to tournament matches
 */
export class MatchAllocationService {
  // Grace period in seconds after server becomes idle before allowing allocation.
  // This ensures demo uploads complete and match reset finishes.
  //
  // For "real" tournaments we want to be conservative, but still responsive for
  // typical events. Two minutes is usually enough time for demo uploads and a
  // full reset without making brackets feel "stuck".
  private static readonly ALLOCATION_GRACE_PERIOD_SECONDS = 120; // 2 minutes for real matches
  private static readonly SIMULATION_GRACE_PERIOD_SECONDS = 30; // Fast path for simulated matches

  /**
   * In-memory guard to prevent multiple matches being loaded onto the same server
   * concurrently from different allocation calls (e.g. auto-veto + polling).
   *
   * A server ID is added to this set while `loadMatchOnServer` is in progress
   * and removed afterwards. `getAvailableServers()` will skip any servers that
   * are currently marked as "allocating".
   */
  private readonly allocatingServers = new Set<string>();

  /**
   * Effective grace period to use for allocations in the current mode.
   * Mirrors the constants above so callers (e.g. shuffle round advancement)
   * can schedule delayed batch allocations without duplicating timings.
   */
  async getEffectiveGracePeriodSeconds(): Promise<number> {
    const isSimulation = await settingsService.isSimulationModeEnabled();
    return isSimulation
      ? MatchAllocationService.SIMULATION_GRACE_PERIOD_SECONDS
      : MatchAllocationService.ALLOCATION_GRACE_PERIOD_SECONDS;
  }

  /**
   * Get count of available servers (enabled, online, and ready for allocation)
   * Returns the number of servers that can be allocated
   */
  async getAvailableServerCount(): Promise<number> {
    const availableServers = await this.getAvailableServers();
    return availableServers.length;
  }

  /**
   * Get high-level allocation status for UI:
   * - availableServerCount: number of servers that can be allocated *right now*
   * - gracePeriodSeconds: the effective grace period currently in use
   * - nextAllocationInSeconds: if all servers are in a grace window, the number
   *   of seconds until the *first* server exits that window and becomes
   *   eligible for allocation again. Returns null when no grace window applies.
   */
  async getAllocationStatus(): Promise<{
    availableServerCount: number;
    gracePeriodSeconds: number;
    nextAllocationInSeconds: number | null;
    // How many matches are currently waiting for servers (ready & no server_id)
    requiredServerCount: number;
    // Per‑server snapshot so UIs can surface which servers are still busy or
    // within their cooldown window.
    servers: Array<{
      id: string;
      name: string;
      online: boolean;
      status: ServerStatus | null;
      matchSlug: string | null;
      updatedAt: number | null;
      // True when the server is idle but still within the grace period window
      // before it can be safely reused.
      inGraceWindow: boolean;
      secondsUntilReady: number | null;
      // True when the allocator would currently consider this server
      // allocatable for a new match.
      allocatable: boolean;
    }>;
  }> {
    const enabledServers = await serverService.getAllServers(true);

    // For the high‑level allocation *status* view we intentionally include all
    // enabled servers, even if the in‑memory allocation tracker currently
    // considers them "busy" or "preparing". The tracker is an optimisation
    // aid for the allocator itself, but the authoritative truth about whether
    // a server is actually idle comes from MatchZy's ConVars plus our DB
    // (loaded/live matches). By not filtering on `serverAllocationTracker` here
    // we ensure that UIs – including the manual match creator – always see a
    // complete snapshot of online servers together with their allocatable flag.
    const statusChecks = await Promise.all(
      enabledServers.map(async (server) => {
        try {
          const connectionResult = await rconService.testConnection(server.id);

          if (!connectionResult.success) {
            return {
              server,
              status: null as ServerStatus | null,
              matchSlug: null as string | null,
              updatedAt: null as number | null,
              online: false,
            };
          }

          const serverStatus = await serverStatusService.getServerStatus(server.id);
          return {
            server,
            ...serverStatus,
          };
        } catch {
          return {
            server,
            status: null as ServerStatus | null,
            matchSlug: null as string | null,
            updatedAt: null as number | null,
            online: false,
          };
        }
      })
    );

    let onlineServers = statusChecks.filter((s) => s.online);
    onlineServers = onlineServers.filter((s) => !this.allocatingServers.has(s.server.id));

    // For the status view we primarily trust the MatchZy tournament status
    // (convars) as the source of truth about whether a server is actually idle.
    // We still surface any DB‑backed "busy" matches as metadata so the UI can
    // highlight potential mismatches, but we no longer block allocatability
    // purely on the DB view. This avoids servers getting "stuck" as busy in
    // the UI after manual restarts when the plugin reports them as idle.
    const dbBusyRows = await db.queryAsync<{ server_id: string; slug: string }>(
      `SELECT server_id, slug
         FROM matches
        WHERE server_id IS NOT NULL
          AND server_id != ''
          AND status IN ('loaded', 'live')`
    );
    const dbBusyByServer = new Map<string, { slug: string }>();
    for (const row of dbBusyRows) {
      if (row.server_id && !dbBusyByServer.has(row.server_id)) {
        dbBusyByServer.set(row.server_id, { slug: row.slug });
      }
    }

    const isSimulation = await settingsService.isSimulationModeEnabled();
    const GRACE_PERIOD_SECONDS = isSimulation
      ? MatchAllocationService.SIMULATION_GRACE_PERIOD_SECONDS
      : MatchAllocationService.ALLOCATION_GRACE_PERIOD_SECONDS;
    const now = Math.floor(Date.now() / 1000);

    let availableServerCount = 0;
    let nextAllocationInSeconds: number | null = null;
    const servers: Array<{
      id: string;
      name: string;
      online: boolean;
      status: ServerStatus | null;
      matchSlug: string | null;
      updatedAt: number | null;
      inGraceWindow: boolean;
      secondsUntilReady: number | null;
      allocatable: boolean;
    }> = [];

    let offlineCount = 0;
    let busyCount = 0;
    let graceWindowCount = 0;

    for (const check of statusChecks) {
      const { server, status, matchSlug, updatedAt, online } = check;

      if (!online) {
        offlineCount += 1;
      }

      const dbBusy = dbBusyByServer.get(server.id) || null;
      const effectiveMatchSlug = matchSlug || dbBusy?.slug || null;

      // Follow MatchZy guidance strictly: only treat explicit "idle" as
      // allocatable. All other states (including "postgame") remain busy.
      // If the plugin says the server is idle but our DB still has a
      // loaded/live match attached, we now trust the plugin and allow
      // allocation, while still showing the DB match slug in the metadata
      // so admins can see the mismatch.
      const isIdle = status === ServerStatus.IDLE;
      let inGraceWindow = false;
      let secondsUntilReady: number | null = null;
      let allocatable = false;

      if (isIdle) {
        if (updatedAt) {
          const age = now - updatedAt;
          if (age < GRACE_PERIOD_SECONDS) {
            inGraceWindow = true;
            secondsUntilReady = GRACE_PERIOD_SECONDS - age;
            graceWindowCount += 1;

            // Track the *minimum* remaining time so the UI can show a single
            // countdown until the next allocation attempt is allowed.
            if (nextAllocationInSeconds === null || secondsUntilReady < nextAllocationInSeconds) {
              nextAllocationInSeconds = secondsUntilReady;
            }
          } else {
            allocatable = true;
          }
        } else {
          // No timestamp – treat as long‑idle and allocatable.
          allocatable = true;
        }
      }

      if (!isIdle && online) {
        busyCount += 1;
      }

      if (allocatable) {
        availableServerCount += 1;
      }

      servers.push({
        id: server.id,
        name: server.name,
        online,
        status: status ?? null,
        matchSlug: effectiveMatchSlug,
        updatedAt: updatedAt ?? null,
        inGraceWindow,
        secondsUntilReady,
        allocatable,
      });
    }

    // This method is called both by UI endpoints and allocator helpers; only
    // emit a summary when there is contention so logs stay readable.
    if (requiredServerCount > 0 && availableServerCount === 0) {
      log.warn(
        `[ALLOCATION] Status: ${requiredServerCount} match(es) waiting for servers, ` +
          `${availableServerCount} allocatable, ${offlineCount} offline, ` +
          `${busyCount} busy, ${graceWindowCount} in grace window`
      );

      if (nextAllocationInSeconds !== null) {
        log.warn(
          `[ALLOCATION] Next server exits grace window in ~${nextAllocationInSeconds}s (grace=${GRACE_PERIOD_SECONDS}s)`
        );
      }
    }

    // How many matches are currently waiting for servers (ready + no server_id)
    const readyMatches = await this.getReadyMatches();
    const requiredServerCount = readyMatches.length;

    return {
      availableServerCount,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
      nextAllocationInSeconds,
      requiredServerCount,
      servers,
    };
  }

  /**
   * Get all available servers (enabled, online, and ready for allocation)
   * Uses MatchZy's matchzy_tournament_status convar to determine availability
   *
   * According to MatchZy server allocation status documentation:
   * - Only allocate when status is effectively idle (idle / postgame)
   * - Wait a short grace period after status becomes idle/postgame
   * - Check `matchzy_tournament_match` and `matchzy_tournament_updated` convars
   */
  async getAvailableServers(): Promise<ServerResponse[]> {
    const enabledServers = await serverService.getAllServers(true); // Get only enabled servers

    // We intentionally do NOT pre‑filter enabled servers by DB "busy" state
    // here. Instead we trust the MatchZy tournament status convars as the
    // authoritative view: if the plugin reports the server as idle, we allow
    // allocation even if our DB still has legacy loaded/live matches attached.
    const candidateServers = enabledServers;

    // Check each server's MatchZy tournament status
    const statusChecks = await Promise.all(
      candidateServers.map(async (server) => {
        try {
          // First, perform a lightweight connectivity check using the standard
          // `status` command. This mirrors the manual "Test server" check in
          // the UI and avoids trying to allocate obviously-dead servers.
          const connectionResult = await rconService.testConnection(server.id);

          if (!connectionResult.success) {
            log.warn(
              `[ALLOCATION] Server ${server.id} (${server.name}) is offline or unreachable, skipping from allocation`,
              { error: connectionResult.error }
            );

            return {
              server,
              status: null,
              matchSlug: null,
              updatedAt: null,
              online: false,
            };
          }

          // If the basic RCON connection works, query the MatchZy tournament
          // status convars to determine whether the server is actually idle
          // and ready to be used for a match.
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
    let onlineServers = statusChecks.filter((s) => s.online);

    // Also filter out servers that are currently in the process of being allocated
    // a match. This prevents multiple concurrent loads (`matchzy_loadmatch_url`)
    // from different code paths targeting the same physical server.
    onlineServers = onlineServers.filter((s) => !this.allocatingServers.has(s.server.id));

    // Finally, respect our internal allocation tracker so that once we decide a
    // server is "busy" for a match, *no other* match will be allocated to it
    // until the match lifecycle handler explicitly marks it as idle again.
    onlineServers = onlineServers.filter((s) => !serverAllocationTracker.isBusy(s.server.id));

    const isSimulation = await settingsService.isSimulationModeEnabled();
    const GRACE_PERIOD_SECONDS = isSimulation
      ? MatchAllocationService.SIMULATION_GRACE_PERIOD_SECONDS
      : MatchAllocationService.ALLOCATION_GRACE_PERIOD_SECONDS;
    const now = Math.floor(Date.now() / 1000);

    // Filter servers based on MatchZy tournament status
    const availableServers: ServerResponse[] = [];
    for (const check of onlineServers) {
      const { server, status, matchSlug, updatedAt } = check;

      // Follow MatchZy spec: ONLY allocate when status is "idle". All other
      // states, including "postgame", are considered busy.
      if (status !== ServerStatus.IDLE) {
        log.debug(
          `Server ${server.id} (${server.name}) not available: status is '${status}' (not idle)`
        );
        continue;
      }

      // Check grace period: if status was recently updated to idle, wait before allocating.
      // This ensures demo uploads complete and match reset finishes.
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

        // Status is idle and timestamp is old enough, proceed to connectivity checks
        if (matchSlug && matchSlug.trim() !== '') {
          log.debug(
            `Server ${server.id} (${server.name}) is idle with old match ID '${matchSlug}' (${age}s old), proceeding to connectivity checks`
          );
        }
      } else {
        // No timestamp available - server might have been idle for a long time
        // Allow allocation but log it
        log.debug(
          `Server ${server.id} (${server.name}) is idle (no timestamp available), assuming ready for allocation`
        );
      }

      // Bi-directional connectivity safeguard:
      // Only allocate servers that have sent a recent connectivity test event
      // so we know they can reach our /api/events webhook.
      //
      // If we haven't seen a recent test event, actively trigger css_te here so the
      // admin doesn't need to manually hit "Test server" in the UI.
      let lastTestEvent = getLastServerTestEvent(server.id);
      const TEST_EVENT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
      const nowMs = Date.now();
      if (!lastTestEvent || nowMs - lastTestEvent > TEST_EVENT_MAX_AGE_MS) {
        const previousTestEventTs = lastTestEvent ?? 0;
        try {
          // Ask the server to send a test event back to /api/events
          await rconService.sendCommand(server.id, 'css_te');

          const timeoutMs = 5000;
          const pollIntervalMs = 250;
          const deadline = Date.now() + timeoutMs;

          while (Date.now() < deadline) {
            const ts = getLastServerTestEvent(server.id) ?? 0;
            if (ts > previousTestEventTs) {
              lastTestEvent = ts;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        } catch (error) {
          log.warn(`[ALLOCATION] Failed to send css_te connectivity test to server ${server.id}`, {
            error,
          });
        }

        // If we still don't have a fresh test event after the active check, skip this server.
        if (!lastTestEvent || Date.now() - lastTestEvent > TEST_EVENT_MAX_AGE_MS) {
          log.warn(
            `[ALLOCATION] Skipping server ${server.id} (${server.name}) because no recent connectivity test event was received from it.`
          );
          continue;
        }
      }

      // Server is available!
      availableServers.push(server);
      serverAllocationTracker.markIdle(server.id);
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
   * Internal helper to allocate a single match to a specific server exactly once.
   *
   * This is intentionally "optimistic": we pick one server for the match, perform
   * a final status sanity check, assign `server_id`, and then call
   * `loadMatchOnServer`. If anything fails, we roll back `server_id` so the
   * match can be retried by a future allocation pass or polling, but we do NOT
   * try a second server within the same call. This allows us to fan out
   * allocations across multiple servers in parallel without long per‑server
   * waterfalls.
   */
  private async allocateMatchToServerOnce(
    match: BracketMatch,
    server: ServerResponse,
    baseUrl: string,
    context: 'bulk' | 'specific'
  ): Promise<{
    matchSlug: string;
    serverId?: string;
    success: boolean;
    error?: string;
  }> {
    const ctxLabel = context === 'specific' ? ' (specific)' : '';

    try {
      // Final live status check right before allocation so we don't rely on
      // the older snapshot returned from getAvailableServers.
      const statusInfo = await serverStatusService.getServerStatus(server.id);

      if (!statusInfo.online || statusInfo.status !== ServerStatus.IDLE) {
        log.debug(
          `[ALLOCATION]${ctxLabel} Refusing to allocate match ${match.slug} to server ${server.id} (${server.name}) because it is not idle (status=${statusInfo.status}, matchSlug=${statusInfo.matchSlug})`
        );
        return {
          matchSlug: match.slug,
          success: false,
          serverId: server.id,
          error: `Server ${server.id} is not idle (status=${statusInfo.status})`,
        };
      }

      // Defensive DB‑level guard: never allow *another* non‑completed match to
      // share the same server. This complements the live status check above
      // and ensures that even if plugin state is momentarily misleading, we
      // will not double‑book the server in our own database.
      const existingActive = await db.queryOneAsync<{ count: number }>(
        `
          SELECT COUNT(*) as count
            FROM matches
           WHERE server_id = ?
             AND slug != ?
             AND status IN ('pending', 'ready', 'loaded', 'live')
        `,
        [server.id, match.slug]
      );
      if ((existingActive?.count ?? 0) > 0) {
        log.debug(
          `[ALLOCATION] Refusing to allocate match ${match.slug} to server ${server.id} (${server.name}) because another active match is already using this server`
        );
        return {
          matchSlug: match.slug,
          success: false,
          serverId: server.id,
          error: `Server ${server.id} already has an active match`,
        };
      }

      log.info(
        `[ALLOCATION]${ctxLabel} Allocating match ${match.slug} to server ${server.name} (${server.id})`
      );

      // Mark server as "in allocation" to prevent concurrent allocations
      this.allocatingServers.add(server.id);
      serverAllocationTracker.markAllocated(server.id, match.slug);

      // Persist server_id on the match so UIs and webhooks see the assignment
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [match.slug]);

      // Emit websocket event for server assignment
      const matchWithServer = await db.queryOneAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE slug = ?',
        [match.slug]
      );
      if (matchWithServer) {
        emitMatchUpdate(matchWithServer);
        emitBracketUpdate({
          action: 'server_assigned',
          matchSlug: match.slug,
          serverId: server.id,
        });
      }

      // Load match on server and let MatchZy validate the config
      const loadResult = await loadMatchOnServer(match.slug, server.id, { baseUrl });

      if (loadResult.success) {
        log.matchAllocated(match.slug, server.id, server.name);
        return {
          matchSlug: match.slug,
          serverId: server.id,
          success: true,
        };
      }

      // Roll back server_id if loading failed so this match can be retried later.
      try {
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [match.slug]);
      } catch (rollbackError) {
        log.error(
          `[ALLOCATION]${ctxLabel} Failed to roll back server_id for match ${match.slug} after load failure`,
          rollbackError
        );
      }

      const errorMessage = loadResult.error || 'Failed to load match';
      log.error(
        `[ALLOCATION]${ctxLabel} Failed to load match ${match.slug} on ${server.name} (${server.id})`,
        undefined,
        { error: loadResult.error }
      );

      return {
        matchSlug: match.slug,
        serverId: server.id,
        success: false,
        error: errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Roll back server_id on any hard failure so this match can be retried
      // by future allocation passes instead of getting stuck with a server
      // but no loadedAt.
      try {
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [match.slug]);
      } catch (rollbackError) {
        log.error(
          `[ALLOCATION]${ctxLabel} Failed to roll back server_id for match ${match.slug} after allocation error`,
          rollbackError
        );
      }

      log.error(
        `[ALLOCATION]${ctxLabel} Failed to allocate match ${match.slug} to server ${server.id}`,
        error
      );

      return {
        matchSlug: match.slug,
        serverId: server.id,
        success: false,
        error: errorMessage,
      };
    } finally {
      // Clear the "allocating" flag for this server for future attempts
      this.allocatingServers.delete(server.id);
    }
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
    log.info('[ALLOCATION] Getting available servers...');
    let availableServers = await this.getAvailableServers();
    log.info(`Found ${availableServers.length} available server(s)`);

    log.info('[ALLOCATION] Getting ready matches...');
    const readyMatches = await this.getReadyMatches();
    log.info(`Found ${readyMatches.length} ready match(es) to allocate`);

    if (readyMatches.length === 0) {
      log.info('[ALLOCATION] No ready matches to allocate');
      return [];
    }

    if (availableServers.length === 0) {
      log.warn('[ALLOCATION] No available servers for match allocation');
      return readyMatches.map((match) => ({
        matchSlug: match.slug,
        success: false,
        error: 'No available servers',
      }));
    }

    log.info(
      `[ALLOCATION] Allocating ${readyMatches.length} match(es) to ${availableServers.length} server(s)`
    );

    const results: Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }> = [];

    // Optimistic, parallel allocation:
    // - Pair up to N ready matches with N available servers (1:1) in this pass.
    // - Fire the load sequence for each pair in parallel so we don't wait for
    //   server 1 to finish before starting on server 2, 3, ...
    // - Matches that don't get a server in this pass are marked as failed with
    //   "No available servers" and will be retried by future passes/polling.

    const maxAllocations = Math.min(readyMatches.length, availableServers.length);
    const allocationTasks: Array<
      Promise<{
        matchSlug: string;
        serverId?: string;
        success: boolean;
        error?: string;
      }>
    > = [];

    for (let i = 0; i < readyMatches.length; i++) {
      const match = readyMatches[i];

      if (i < maxAllocations) {
        const server = availableServers[i];
        allocationTasks.push(this.allocateMatchToServerOnce(match, server, baseUrl, 'bulk'));
      } else {
        results.push({
          matchSlug: match.slug,
          success: false,
          error: 'No available servers',
        });
      }
    }

    const allocationResults = await Promise.all(allocationTasks);
    results.push(...allocationResults);

    log.info(
      `[ALLOCATION] Allocation complete: ${results.filter((r) => r.success).length} successful, ${
        results.filter((r) => !r.success).length
      } failed`
    );

    return results;
  }

  /**
   * Allocate servers to a specific list of matches (by slug), using the same
   * round-robin strategy as allocateServersToMatches but restricted to the
   * provided matches. Used by shuffle round advancement so that only the
   * newly generated round's matches are considered.
   */
  async allocateSpecificMatches(
    matchSlugs: string[],
    baseUrl: string
  ): Promise<
    Array<{
      matchSlug: string;
      serverId?: string;
      success: boolean;
      error?: string;
    }>
  > {
    const uniqueSlugs = Array.from(new Set(matchSlugs));
    if (uniqueSlugs.length === 0) {
      return [];
    }

    log.info(
      `[ALLOCATION] Allocating specific matches: ${uniqueSlugs.length} match(es) requested`,
      { matchSlugs: uniqueSlugs }
    );

    const allReadyMatches = await this.getReadyMatches();
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
    // all requested ready matches, or until a reasonable timeout is reached.
    const requiredServers = readyMatches.length;
    const POLL_INTERVAL_MS = 10_000; // 10s, per MatchZy best practices
    const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes hard cap
    const deadline = Date.now() + MAX_WAIT_MS;

    let availableServers = await this.getAvailableServers();
    while (
      availableServers.length > 0 &&
      availableServers.length < requiredServers &&
      Date.now() < deadline
    ) {
      log.info(
        `[ALLOCATION] Waiting for idle servers before batch allocation: ${availableServers.length}/${requiredServers} available`
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      availableServers = await this.getAvailableServers();
    }

    // Final snapshot after waiting (or immediate if we already had enough)
    availableServers = await this.getAvailableServers();
    log.info(
      `Found ${availableServers.length} available server(s) for specific match allocation (required=${requiredServers})`
    );

    if (availableServers.length === 0) {
      log.warn('[ALLOCATION] No available servers for specific match allocation');
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

    // Same optimistic, parallel strategy as the bulk allocator: pair up to N
    // ready matches with N available servers and fan out the load operations.
    const maxAllocations = Math.min(readyMatches.length, availableServers.length);
    const allocationTasks: Array<
      Promise<{
        matchSlug: string;
        serverId?: string;
        success: boolean;
        error?: string;
      }>
    > = [];

    for (let i = 0; i < readyMatches.length; i++) {
      const match = readyMatches[i];

      if (i < maxAllocations) {
        const server = availableServers[i];
        allocationTasks.push(this.allocateMatchToServerOnce(match, server, baseUrl, 'specific'));
      } else {
        results.push({
          matchSlug: match.slug,
          success: false,
          error: 'No available servers',
        });
      }
    }

    const allocationResults = await Promise.all(allocationTasks);
    results.push(...allocationResults);

    log.info(
      `[ALLOCATION] Specific allocation complete: ${
        results.filter((r) => r.success).length
      } successful, ${results.filter((r) => !r.success).length} failed`
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
    let allocatedServerId: string | null = null;
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

      // Get first available server, respecting the in‑memory "allocating" guard
      // so concurrent allocateSingleMatch calls never pick the same server.
      const availableServers = await this.getAvailableServers();
      if (availableServers.length === 0) {
        return { success: false, error: 'No available servers' };
      }

      let server: ServerResponse | null = null;
      for (const candidate of availableServers) {
        // Skip servers that are already in the process of being allocated by
        // this service instance.
        if (this.allocatingServers.has(candidate.id)) {
          continue;
        }

        // Reserve this server *before* we perform any asynchronous checks so
        // that concurrent allocateSingleMatch calls cannot race and pick the
        // same physical server. If later DB guards fail, we will release this
        // reservation and move on to the next candidate.
        this.allocatingServers.add(candidate.id);
        allocatedServerId = candidate.id;

        // Defensive DB‑level guard: avoid assigning a server that already has
        // another active (non‑completed) match attached in our own records.
        const existingActive = await db.queryOneAsync<{ count: number }>(
          `
            SELECT COUNT(*) as count
              FROM matches
             WHERE server_id = ?
               AND status IN ('pending', 'ready', 'loaded', 'live')
          `,
          [candidate.id]
        );
        if ((existingActive?.count ?? 0) > 0) {
          log.debug(
            `[ALLOCATION] Skipping server ${candidate.id} for single-match allocation because it already has an active match in the database`,
            { serverId: candidate.id, activeMatchCount: existingActive?.count, matchSlug }
          );
          // Release reservation and try the next candidate.
          this.allocatingServers.delete(candidate.id);
          allocatedServerId = null;
          continue;
        }

        server = candidate;
        break;
      }

      if (!server) {
        // All currently available servers are either being allocated right now
        // or already have an active match attached in the DB.
        return { success: false, error: 'No available servers' };
      }

      // Track server allocation for higher‑level views
      serverAllocationTracker.markAllocated(server.id, matchSlug);

      // Update match with server_id
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Emit websocket event for server assignment
      const matchWithServer = await db.queryOneAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE slug = ?',
        [matchSlug]
      );
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
      // If anything goes wrong after we've assigned a server_id, clear it so
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
    } finally {
      // Always clear the "allocating" flag for this specific server so it can
      // be considered again for future matches after this attempt finishes.
      if (allocatedServerId) {
        this.allocatingServers.delete(allocatedServerId);
      }
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
    log.info('==================== STARTING TOURNAMENT ====================');
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

    // Check if bracket/matches exist (coerce COUNT(*) to number explicitly)
    const matchCountRow = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1'
    );
    const totalMatches = Number(matchCountRow?.count ?? 0);

    if (totalMatches === 0) {
      // For shuffle tournaments, generate the first round (regardless of BO format / servers)
      if (tournament.type === 'shuffle') {
        log.info('No matches found - generating first round for shuffle tournament');
        try {
          const result = await advanceToNextRound();
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
    } else if (tournament.type === 'shuffle') {
      // Extra safety: if tournament is shuffle and there are *no* shuffle matches yet,
      // ensure we still generate round 1 before proceeding (helps in edge cases with stale data)
      const shuffleMatchCountRow = await db.queryOneAsync<{ count: number | string }>(
        "SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1 AND slug LIKE 'shuffle-%'"
      );
      const shuffleMatches = Number(shuffleMatchCountRow?.count ?? 0);

      if (shuffleMatches === 0) {
        log.info(
          'Shuffle tournament has existing matches but no shuffle rounds yet - generating first round'
        );
        try {
          const result = await advanceToNextRound();
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
    const availableServerCount = await this.getAvailableServerCount();
    const hasAvailableServers = availableServerCount > 0;

    // Determine if this tournament uses veto system
    // Shuffle tournaments *never* use veto, even if format is BO1
    const requiresVeto =
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
          [1]
        );
        log.success(`Tournament started! Teams can now begin map veto.`);

        // Emit tournament update so teams know veto is available
        emitTournamentUpdate({ id: 1, status: 'in_progress' });
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

        // Fetch all matches that already have both teams assigned and have not
        // yet completed veto. We deliberately skip future TBD bracket slots
        // where team1_id/team2_id are not yet known; those matches are not
        // "ready" for veto or loading.
        const pendingMatches = await db.queryAsync<DbMatchRow>(
          `SELECT * FROM matches 
           WHERE tournament_id = ? 
             AND status IN ('pending', 'ready')
             AND team1_id IS NOT NULL
             AND team2_id IS NOT NULL
             AND (veto_state IS NULL OR veto_state = '')
             AND (server_id IS NULL OR server_id = '')`,
          [tournament.id]
        );

        if (pendingMatches.length === 0) {
          log.warn('[VETO-SIM] No pending matches found for tournament; nothing to auto-veto.');
        } else {
          for (const m of pendingMatches) {
            const slug = m.slug;
            setImmediate(() => {
              void autoCompleteVetoForMatch(slug, { stepDelayMs: 1000 });
            });
          }
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
          [1]
        );
        log.success('Tournament started (non-BO format)');

        emitTournamentUpdate({ id: 1, status: 'in_progress' });
        emitBracketUpdate({ action: 'tournament_started' });
      }

      // Check server availability
      if (!hasAvailableServers) {
        log.warn(
          '[WARNING] No servers are currently available. Tournament will start but matches will wait for server availability.'
        );

        // Start polling for all ready matches
        const readyMatches = await this.getReadyMatches();
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
      results = await this.allocateServersToMatches(baseUrl);
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
          'SELECT * FROM matches WHERE tournament_id = 1 LIMIT 1'
        );

        if (existingMatches.length === 0) {
          // No matches exist yet - generate first round automatically
          try {
            log.info('Shuffle tournament: Auto-generating first round...');
            const roundResult = await generateRoundMatches(1);
            log.success(
              `Shuffle tournament: Generated ${roundResult.matches.length} matches for round 1`
            );

            // Allocate servers to the newly generated matches
            // Allocate servers to all matches at once
            const shuffleResults = await this.allocateServersToMatches(baseUrl);

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
           WHERE tournament_id = 1 
           AND status = 'pending'`
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
    log.info('[RESTART] ==================== RESTARTING TOURNAMENT ====================');
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
        log.info(`[RESTART] Ending match on server: ${serverId}`);
        const result = await rconService.sendCommand(serverId, 'css_restart');

        if (result.success) {
          log.success(`[RESTART] Match ended on server ${serverId}`);
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
      log.info(`[RESTART] Reset ${loadedMatches.length} match(es) to 'ready' status`);
    }

    // Now run the normal start tournament flow
    log.info('Starting tournament allocation after restart...');
    const startResult = await this.startTournament(baseUrl);

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
    log.info(`[RESTART] Restarting match: ${matchSlug}`);

    try {
      // Get the match
      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
        matchSlug,
      ]);

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

      log.success(`[RESTART] Match ${matchSlug} ended successfully`);

      // Step 2: Wait a few seconds for server to clean up
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Step 3: Reset match status to 'ready'
      await db.updateAsync('matches', { status: 'ready', loaded_at: null }, 'slug = ?', [
        matchSlug,
      ]);

      // Step 4: Reload the match on the same server
      log.info(`Reloading match ${matchSlug} on server ${serverId}`);
      const loadResult = await loadMatchOnServer(matchSlug, serverId, { baseUrl });

      if (loadResult.success) {
        log.success(`[RESTART] Match ${matchSlug} restarted successfully`);
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
}

export const matchAllocationService = new MatchAllocationService();
