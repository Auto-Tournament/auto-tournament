/**
 * CS2 server pool: which servers can take a match, and getting a match onto
 * one.
 *
 * This is the server side of allocation, behind `capacity()`, `allocate()`,
 * `allocateBatch()`, `restart()`, `load()` and `cancel()` on the CS2
 * integration. The core (`core/scheduler`) owns the rest:
 * which matches are ready, the queue order, a team playing one match at a
 * time, batch waves, and starting or restarting a tournament.
 *
 * A server is free when it is enabled, has reported in, answers RCON, reports
 * idle through the MatchZy convars, has no loaded/live match in our database,
 * is past its turnover (grace period, demo upload; see utils/serverTurnover),
 * runs a verified CS2 build, and has recently proven it can reach our webhook.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { settingsService } from '../../services/settingsService';
import { emitBracketUpdate, emitMatchUpdate } from '../../services/socketService';
import type { DbMatchRow } from '../../types/database.types';
import type { ServerResponse } from '../../types/server.types';
import { matchBracketOf } from '../../core/allocationQueue';
import type { ResourcePoolStatus } from '../types';
import { rconService } from './services/rconService';
import { serverService } from './services/serverService';
import {
  serverStatusService,
  ServerStatus,
  isAllocatableStatus,
} from './services/serverStatusService';
import { getLastServerTestEvent } from './services/serverConnectivityService';
import { serverAllocationTracker } from './services/serverAllocationTracker';
import { cancelQueuedLoad, loadMatchOnServer } from './services/matchLoadingService';
import { serverTurnoverTracker } from './utils/serverTurnover';

/** One attempt to put a match on a server, as the allocator reports it. */
export interface ServerAllocationResult {
  matchSlug: string;
  serverId?: string;
  success: boolean;
  error?: string;
}

/** Per-server row of the allocation status views (server availability, start dialog). */
export type ServerPoolEntry = {
  id: string;
  name: string;
  online: boolean;
  status: ServerStatus | null;
  matchSlug: string | null;
  matchNumber: number | null;
  matchRound: number | null;
  matchBracket: string | null;
  updatedAt: number | null;
  // True when the server is idle but still within the grace period window
  // before it can be safely reused.
  inGraceWindow: boolean;
  secondsUntilReady: number | null;
  // True when the allocator would currently consider this server
  // allocatable for a new match.
  allocatable: boolean;
  /** Set when a 'loaded' row was overridden as stale, so the UI can offer to cancel it. */
  staleMatchSlug: string | null;
  /** Why this server cannot take a match, for operators staring at an idle server. */
  notAllocatableReason:
    | 'offline'
    | 'busy'
    | 'grace-window'
    | 'demo-upload'
    | 'cs2-out-of-date'
    | 'cs2-unverified'
    | null;
};

/** What an admin action on a match's server (load, restart, move) reports back. */
export type ServerActionResult =
  | {
      ok: true;
      message: string;
      serverId?: string;
      details?: Record<string, unknown>;
    }
  | { ok: false; error: string; conflict?: boolean; details?: Record<string, unknown> };

export class Cs2ServerPool {
  // Grace period in seconds after server becomes idle before allowing allocation.
  // This ensures demo uploads complete and match reset finishes.
  //
  // It is the fallback. When MAT saw the series end and the plugin's demo
  // upload report back (or no upload was expected), an idle server is released
  // straight away; a server whose demo is still uploading is held past the
  // window. See utils/serverTurnover.
  //
  // For "real" tournaments we want to be conservative, but still responsive for
  // typical events. Two minutes is usually enough time for demo uploads and a
  // full reset without making brackets feel "stuck".
  private static readonly ALLOCATION_GRACE_PERIOD_SECONDS = 120; // 2 minutes for real matches
  private static readonly SIMULATION_GRACE_PERIOD_SECONDS = 30; // Fast path for simulated matches
  /**
   * How long a match may sit in 'loaded' while the server reports IDLE before
   * the row is treated as stale rather than as a server that is busy.
   *
   * Deliberately not the allocation grace period: that one answers "how long
   * should an idle server settle before reuse", which is a different question
   * from "how long before we stop believing our own database".
   */
  private static readonly STALE_LOADED_SECONDS = 600; // 10 minutes

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
      ? Cs2ServerPool.SIMULATION_GRACE_PERIOD_SECONDS
      : Cs2ServerPool.ALLOCATION_GRACE_PERIOD_SECONDS;
  }

  /**
   * Servers that can take a match right now: available, and not being handed
   * a match by a concurrent allocation (the reservation can be taken while the
   * availability probe runs).
   */
  async getFreeServerCount(): Promise<number> {
    const availableServers = await this.getAvailableServers();
    return availableServers.filter((candidate) => !this.allocatingServers.has(candidate.id)).length;
  }

  /**
   * Per-server snapshot for the allocation status views:
   * - availableCount: number of servers that can be allocated *right now*
   * - gracePeriodSeconds: the effective grace period currently in use
   * - nextAllocationInSeconds: if all servers are in a grace window, the number
   *   of seconds until the *first* server exits that window and becomes
   *   eligible for allocation again. Returns null when no grace window applies.
   */
  async getPoolStatus(): Promise<ResourcePoolStatus & { resources: ServerPoolEntry[] }> {
    const enabledServers = await serverService.getAllServers(true);

    // Filter out unconfigured servers from allocation status
    // These servers haven't sent any events yet and cannot be used
    const configuredServers = enabledServers.filter((server) => server.lastSeen !== null);

    // For the high‑level allocation *status* view we intentionally include all
    // configured servers, even if the in‑memory allocation tracker currently
    // considers them "busy" or "preparing". The tracker is an optimisation
    // aid for the allocator itself, but the authoritative truth about whether
    // a server is actually idle comes from MatchZy's ConVars plus our DB
    // (loaded/live matches). By not filtering on `serverAllocationTracker` here
    // we ensure that UIs – including the manual match creator – always see a
    // complete snapshot of online servers together with their allocatable flag.
    const statusChecks = await Promise.all(
      configuredServers.map(async (server) => {
        try {
          // Use the short-lived status cache for availability checks so we don't
          // block the entire API on fresh RCON calls every time the UI polls.
          const serverStatus = await serverStatusService.getServerStatus(server.id, true);
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

    // For the status view we primarily trust the MatchZy tournament status
    // (convars) as the source of truth about whether a server is actually idle.
    // We still surface any DB‑backed "busy" matches as metadata so the UI can
    // highlight potential mismatches, but we no longer block allocatability
    // purely on the DB view. This avoids servers getting "stuck" as busy in
    // the UI after manual restarts when the plugin reports them as idle.
    const dbBusyRows = await db.queryAsync<{
      server_id: string;
      slug: string;
      match_number: number;
      round: number;
      loaded_at: number | null;
      status: string;
      bracket: string | null;
    }>(
      `SELECT server_id, slug, match_number, round, loaded_at, status, bracket
         FROM matches
        WHERE server_id IS NOT NULL
          AND server_id != ''
          AND status IN ('loaded', 'live')`
    );
    const dbBusyByServer = new Map<
      string,
      {
        slug: string;
        matchNumber: number;
        round: number;
        bracket: string | null;
        loadedAt: number | null;
        status: string;
      }
    >();
    for (const row of dbBusyRows) {
      if (row.server_id && !dbBusyByServer.has(row.server_id)) {
        dbBusyByServer.set(row.server_id, {
          slug: row.slug,
          matchNumber: row.match_number,
          round: row.round,
          bracket: matchBracketOf({ slug: row.slug, bracket: row.bracket }),
          loadedAt: row.loaded_at ?? null,
          status: row.status,
        });
      }
    }

    const GRACE_PERIOD_SECONDS = await this.getEffectiveGracePeriodSeconds();
    const now = Math.floor(Date.now() / 1000);

    let availableCount = 0;
    let nextAllocationInSeconds: number | null = null;
    const servers: ServerPoolEntry[] = [];

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

      // Determine if server is truly idle:
      // - Plugin must report IDLE status
      // - AND database must not show a loaded/live match
      // This prevents servers from showing as "Available" when they have
      // a match in warmup but the plugin hasn't updated the ConVar yet.
      const pluginSaysIdle = isAllocatableStatus(status, matchSlug);
      const dbSaysBusy = dbBusy !== null;

      // A freshly loaded match legitimately looks idle for a moment: MatchZy has
      // not flipped its convar yet. Past that window, a server the plugin calls
      // idle while our own row still says "loaded" means the row is stale - the
      // match was abandoned, or the load only appeared to succeed. Holding the
      // server hostage on that row is what made servers stop being allocated
      // after their first match, recoverable only by deleting the matches.
      //
      // Two refinements on top of that:
      //
      // Only 'loaded' rows are overridden. A 'live' row against an idle-looking
      // plugin is a much bigger disagreement, and getting it wrong means
      // handing out a server with a match actually running on it. That is not
      // a call this function should make on a timer, so live rows keep
      // blocking and are surfaced instead.
      //
      // And it runs on its own, longer clock. The allocation grace period is
      // 120s (30s simulated), which is about how long a server should sit idle
      // before being handed out — not how long to wait before declaring our own
      // database wrong. Ten minutes is comfortably past any real load while
      // still clearing an abandoned row promptly.
      const dbBusyIsRecent =
        dbBusy !== null &&
        (dbBusy.loadedAt === null || now - dbBusy.loadedAt < Cs2ServerPool.STALE_LOADED_SECONDS);
      const dbRecordIsStale =
        dbSaysBusy && pluginSaysIdle && !dbBusyIsRecent && dbBusy?.status === 'loaded';

      if (dbRecordIsStale) {
        log.warn(
          `[ALLOCATION] ${server.id} reports idle but match ${dbBusy?.slug} is still marked loaded; ` +
            `treating the record as stale and allowing allocation`
        );
      }

      const isIdle = pluginSaysIdle && (!dbSaysBusy || dbRecordIsStale);

      let inGraceWindow = false;
      let demoUploadPending = false;
      let secondsUntilReady: number | null = null;
      let allocatable = false;

      // If the server has reported a CS2 update is required, it must not be
      // allocated to new matches.
      const isOutOfDate = typeof server.cs2RequiredVersion === 'number';
      // Safer default: require that MAT has verified CS2 version at least once.
      const isCs2Verified =
        typeof server.cs2BuildId === 'number' && typeof server.cs2UpdateCheckedAt === 'number';

      const turnover = isIdle ? serverTurnoverTracker.evaluate(server.id, updatedAt ?? null, now) : null;

      if (isIdle && turnover?.demoUploadPending) {
        // The previous series' demo is still uploading: never hand the server
        // out, however long it has been idle.
        demoUploadPending = true;
        secondsUntilReady = turnover.demoUploadGiveUpInSeconds;
      } else if (isIdle) {
        if (updatedAt && !turnover?.releaseEarly) {
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
            allocatable = !isOutOfDate && isCs2Verified;
          }
        } else {
          // No timestamp – treat as long‑idle and allocatable.
          allocatable = !isOutOfDate && isCs2Verified;
        }
      }

      if (!isIdle && online) {
        busyCount += 1;
      }

      if (allocatable) {
        availableCount += 1;
      }

      let notAllocatableReason: ServerPoolEntry['notAllocatableReason'] = null;
      if (!allocatable) {
        if (!online) notAllocatableReason = 'offline';
        else if (!isIdle) notAllocatableReason = 'busy';
        else if (demoUploadPending) notAllocatableReason = 'demo-upload';
        else if (inGraceWindow) notAllocatableReason = 'grace-window';
        else if (isOutOfDate) notAllocatableReason = 'cs2-out-of-date';
        else if (!isCs2Verified) notAllocatableReason = 'cs2-unverified';
      }

      servers.push({
        id: server.id,
        name: server.name,
        online,
        status: status ?? null,
        matchSlug: effectiveMatchSlug,
        matchNumber: dbBusy?.matchNumber ?? null,
        matchRound: dbBusy?.round ?? null,
        matchBracket: dbBusy?.bracket ?? null,
        updatedAt: updatedAt ?? null,
        inGraceWindow,
        secondsUntilReady,
        allocatable,
        notAllocatableReason,
        staleMatchSlug: dbRecordIsStale ? (dbBusy?.slug ?? null) : null,
      });
    }

    return {
      availableCount,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
      nextAllocationInSeconds,
      resources: servers,
      offlineCount,
      busyCount,
      graceWindowCount,
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

    // Filter out unconfigured servers (never sent server_configured event)
    // These servers cannot be used for matches until they've been initialized
    // and have sent their first event (which sets lastSeen timestamp)
    const configuredServers = enabledServers.filter((server) => {
      if (!server.lastSeen) {
        log.debug(
          `[ALLOCATION] Skipping unconfigured server ${server.id} (${server.name}) - no events received yet`
        );
        return false;
      }
      return true;
    });

    // We intentionally do NOT pre‑filter enabled servers by DB "busy" state
    // here. Instead we trust the MatchZy tournament status convars as the
    // authoritative view: if the plugin reports the server as idle, we allow
    // allocation even if our DB still has legacy loaded/live matches attached.
    const candidateServers = configuredServers;

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

    const GRACE_PERIOD_SECONDS = await this.getEffectiveGracePeriodSeconds();
    const now = Math.floor(Date.now() / 1000);

    // Check database for matches that are currently loaded/live on servers
    const dbBusyRows = await db.queryAsync<{ server_id: string; slug: string }>(
      `SELECT server_id, slug
         FROM matches
        WHERE server_id IS NOT NULL
          AND server_id != ''
          AND status IN ('loaded', 'live')`
    );
    const dbBusyServers = new Set(dbBusyRows.map((row) => row.server_id));

    // Filter servers based on MatchZy tournament status
    const availableServers: ServerResponse[] = [];
    for (const check of onlineServers) {
      const { server, status, matchSlug, updatedAt } = check;

      if (typeof server.cs2RequiredVersion === 'number') {
        log.debug(
          `[ALLOCATION] Skipping out-of-date server ${server.id} (${server.name}) - cs2RequiredVersion=${server.cs2RequiredVersion}`
        );
        continue;
      }

      const isCs2Verified =
        typeof server.cs2BuildId === 'number' && typeof server.cs2UpdateCheckedAt === 'number';
      if (!isCs2Verified) {
        log.debug(
          `[ALLOCATION] Skipping unverified server ${server.id} (${server.name}) - cs2BuildId=${server.cs2BuildId ?? null}, cs2UpdateCheckedAt=${server.cs2UpdateCheckedAt ?? null}`
        );
        continue;
      }

      // Follow MatchZy spec: only allocate an idle server (or one left in
      // 'error' - see isAllocatableStatus). "postgame" and "queued" are busy: a
      // load sent then is queued by the plugin and runs minutes later.
      if (!isAllocatableStatus(status, matchSlug)) {
        log.debug(
          `Server ${server.id} (${server.name}) not available: status is '${status}' (not idle)`
        );
        continue;
      }

      // Also check database - if DB shows a loaded/live match, don't allocate
      // even if plugin says idle (prevents race conditions during warmup)
      if (dbBusyServers.has(server.id)) {
        log.debug(
          `Server ${server.id} (${server.name}) not available: database shows loaded/live match`
        );
        continue;
      }

      // Never load onto a server whose previous demo is still uploading.
      const turnover = serverTurnoverTracker.evaluate(server.id, updatedAt ?? null, now);
      if (turnover.demoUploadPending) {
        log.debug(
          `Server ${server.id} (${server.name}) is idle but its previous demo upload has not reported back yet`
        );
        continue;
      }

      // Check grace period: if status was recently updated to idle, wait before allocating.
      // Skipped when the series end and demo upload were both seen (releaseEarly).
      if (turnover.releaseEarly) {
        log.debug(
          `Server ${server.id} (${server.name}) is idle after series end with no demo upload pending, skipping grace period`
        );
      } else if (updatedAt) {
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
    matchSlug: string,
    server: ServerResponse,
    baseUrl: string
  ): Promise<ServerAllocationResult> {
    try {
      // Final live status check right before allocation so we don't rely on
      // the older snapshot returned from getAvailableServers.
      const statusInfo = await serverStatusService.getServerStatus(server.id);

      if (!statusInfo.online || !isAllocatableStatus(statusInfo.status, statusInfo.matchSlug)) {
        log.debug(
          `[ALLOCATION] Refusing to allocate match ${matchSlug} to server ${server.id} (${server.name}) because it is not idle (status=${statusInfo.status}, matchSlug=${statusInfo.matchSlug})`
        );
        return {
          matchSlug,
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
        [server.id, matchSlug]
      );
      if ((existingActive?.count ?? 0) > 0) {
        log.debug(
          `[ALLOCATION] Refusing to allocate match ${matchSlug} to server ${server.id} (${server.name}) because another active match is already using this server`
        );
        return {
          matchSlug,
          success: false,
          serverId: server.id,
          error: `Server ${server.id} already has an active match`,
        };
      }

      log.info(`[ALLOCATION] Allocating match ${matchSlug} to server ${server.name} (${server.id})`);

      // Mark server as "in allocation" to prevent concurrent allocations
      this.allocatingServers.add(server.id);
      serverAllocationTracker.markAllocated(server.id, matchSlug);

      // Persist server_id on the match so UIs and webhooks see the assignment
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Emit websocket event for server assignment
      await this.emitServerAssigned(matchSlug, server.id);

      // Load match on server and let MatchZy validate the config
      const loadResult = await loadMatchOnServer(matchSlug, server.id, { baseUrl });

      if (loadResult.success) {
        log.matchAllocated(matchSlug, server.id, server.name);
        return {
          matchSlug,
          serverId: server.id,
          success: true,
        };
      }

      // Roll back server_id if loading failed so this match can be retried later.
      try {
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
      } catch (rollbackError) {
        log.error(
          `[ALLOCATION] Failed to roll back server_id for match ${matchSlug} after load failure`,
          rollbackError
        );
      }
      // The match may go to another server next; do not let this one load it later.
      if (loadResult.mayHaveQueued) {
        await cancelQueuedLoad(server.id, matchSlug);
      }

      const errorMessage = loadResult.error || 'Failed to load match';
      log.error(
        `[ALLOCATION] Failed to load match ${matchSlug} on ${server.name} (${server.id})`,
        undefined,
        { error: loadResult.error }
      );

      return {
        matchSlug,
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
        await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
      } catch (rollbackError) {
        log.error(
          `[ALLOCATION] Failed to roll back server_id for match ${matchSlug} after allocation error`,
          rollbackError
        );
      }

      log.error(`[ALLOCATION] Failed to allocate match ${matchSlug} to server ${server.id}`, error);

      return {
        matchSlug,
        serverId: server.id,
        success: false,
        error: errorMessage,
      };
    } finally {
      // Clear the "allocating" flag for this server for future attempts
      this.allocatingServers.delete(server.id);
    }
  }

  private async emitServerAssigned(matchSlug: string, serverId: string): Promise<void> {
    const matchWithServer = await db.queryOneAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE slug = ?',
      [matchSlug]
    );
    if (matchWithServer) {
      emitMatchUpdate(matchWithServer);
      emitBracketUpdate({ action: 'server_assigned', matchSlug, serverId });
    }
  }

  /**
   * Put a wave of matches on servers, in the order given.
   *
   * Optimistic, parallel allocation:
   * - Take one snapshot of available servers and pair up to N matches with N
   *   servers (1:1), in order.
   * - Fire the load sequence for each pair in parallel so we don't wait for
   *   server 1 to finish before starting on server 2, 3, ...
   * - Matches that don't get a server in this pass are reported as
   *   "No available servers" and are retried by later passes/polling.
   */
  async allocateBatch(matchSlugs: string[], baseUrl: string): Promise<ServerAllocationResult[]> {
    const availableServers = await this.getAvailableServers();
    log.info(`Found ${availableServers.length} available server(s)`);

    if (availableServers.length === 0) {
      log.warn('[ALLOCATION] No available servers for match allocation');
      return matchSlugs.map((matchSlug) => ({
        matchSlug,
        success: false,
        error: 'No available servers',
      }));
    }

    log.info(
      `[ALLOCATION] Allocating ${matchSlugs.length} match(es) to ${availableServers.length} server(s)`
    );

    const results: ServerAllocationResult[] = [];
    const maxAllocations = Math.min(matchSlugs.length, availableServers.length);
    const allocationTasks: Array<Promise<ServerAllocationResult>> = [];

    for (let i = 0; i < matchSlugs.length; i++) {
      if (i < maxAllocations) {
        allocationTasks.push(this.allocateMatchToServerOnce(matchSlugs[i], availableServers[i], baseUrl));
      } else {
        results.push({
          matchSlug: matchSlugs[i],
          success: false,
          error: 'No available servers',
        });
      }
    }

    const allocationResults = await Promise.all(allocationTasks);
    // Left-over matches first, then the attempts: the order the batch
    // allocator has always reported them in.
    return [...results, ...allocationResults];
  }

  /**
   * Put one match on the first available server. The caller has already
   * checked that the match is ready and that it is its turn in the queue.
   */
  async allocate(matchSlug: string, baseUrl: string): Promise<ServerAllocationResult> {
    let allocatedServerId: string | null = null;
    try {
      // Get first available server, respecting the in‑memory "allocating" guard
      // so concurrent allocations never pick the same server.
      const availableServers = await this.getAvailableServers();
      if (availableServers.length === 0) {
        return { matchSlug, success: false, error: 'No available servers' };
      }

      let server: ServerResponse | null = null;
      for (const candidate of availableServers) {
        // Skip servers that are already in the process of being allocated by
        // this service instance.
        if (this.allocatingServers.has(candidate.id)) {
          continue;
        }

        // Reserve this server *before* we perform any asynchronous checks so
        // that concurrent allocations cannot race and pick the same physical
        // server. If later DB guards fail, we will release this reservation
        // and move on to the next candidate.
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
        return { matchSlug, success: false, error: 'No available servers' };
      }

      // Track server allocation for higher‑level views
      serverAllocationTracker.markAllocated(server.id, matchSlug);

      // Update match with server_id
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Emit websocket event for server assignment
      await this.emitServerAssigned(matchSlug, server.id);

      // Load match on server
      const loadResult = await loadMatchOnServer(matchSlug, server.id, { baseUrl });

      if (loadResult.success) {
        log.matchAllocated(matchSlug, server.id, server.name);
        return { matchSlug, success: true, serverId: server.id };
      }

      // Rollback server_id if loading failed
      await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
      // The match may go to another server next; do not let this one load it later.
      if (loadResult.mayHaveQueued) {
        await cancelQueuedLoad(server.id, matchSlug);
      }
      return {
        matchSlug,
        success: false,
        serverId: server.id,
        error: loadResult.error || 'Failed to load match',
      };
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
      return { matchSlug, success: false, error: errorMessage };
    } finally {
      // Always clear the "allocating" flag for this specific server so it can
      // be considered again for future matches after this attempt finishes.
      if (allocatedServerId) {
        this.allocatingServers.delete(allocatedServerId);
      }
    }
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

      if (endResult.unconfirmed) {
        log.warn(
          `[RESTART] Restart sent for match ${matchSlug} on ${serverId}; no RCON reply (server was restarting), continuing`
        );
      } else {
        log.success(`[RESTART] Match ${matchSlug} ended successfully`);
      }

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

  /**
   * Load a match on the server it is assigned to (the admin "load" action).
   *
   * For manual matches (round = 0), double‑check that the selected server is
   * still truly available at load time. The admin UI already filters
   * "busy"/non‑allocatable servers out of the dropdown, but there is still a
   * race window where a server can become allocated between the time the
   * modal is opened and the match is created. If that happens, we try to
   * transparently re‑allocate the match to a different idle server instead
   * of letting it hang forever.
   */
  async loadAssigned(
    match: { id: number; slug: string; round: number; server_id?: string | null },
    options: { baseUrl: string; skipWebhook?: boolean }
  ): Promise<ServerActionResult> {
    const slug = match.slug;
    let serverIdToUse = match.server_id;
    if (typeof match.round === 'number' && match.round === 0 && match.server_id) {
      const busy = await db.queryOneAsync<{ count: number }>(
        `SELECT COUNT(*) as count
           FROM matches
          WHERE server_id = ?
            AND slug != ?
            AND status IN ('ready', 'loaded', 'live')`,
        [match.server_id, slug]
      );

      if (busy && busy.count > 0) {
        log.warn(
          `Manual match ${slug} requested busy server ${match.server_id}; attempting re‑allocation`
        );

        const availableServers = await this.getAvailableServers();
        const fallback = availableServers.find((s) => s.id !== match.server_id);

        if (fallback) {
          await db.updateAsync('matches', { server_id: fallback.id }, 'id = ?', [match.id]);
          serverIdToUse = fallback.id;
          log.success(
            `Re‑allocated manual match ${slug} from busy server ${match.server_id} to ${fallback.id}`
          );
        } else {
          return {
            ok: false,
            conflict: true,
            error:
              'Selected server is now busy with another match and no alternative idle servers are available. Please try again in a moment or free up a server.',
          };
        }
      }
    }

    // Use centralized match loading service
    const result = await loadMatchOnServer(slug, serverIdToUse as string, {
      skipWebhook: options.skipWebhook,
      baseUrl: options.baseUrl,
    });

    const details = {
      webhookConfigured: result.webhookConfigured,
      demoUploadConfigured: result.demoUploadConfigured,
      rconResponses: result.rconResponses,
    };
    if (result.success) {
      return {
        ok: true,
        message: result.webhookConfigured
          ? 'Match loaded and webhook configured'
          : 'Match loaded (webhook skipped)',
        ...(serverIdToUse ? { serverId: serverIdToUse } : {}),
        details,
      };
    }
    return { ok: false, error: result.error || 'Failed to load match', details };
  }

  /**
   * Move a match that has not gone live to another idle server (pre-live
   * recovery, e.g. the assigned server is out of date). The caller has checked
   * the match is 'ready' or 'loaded' and has a server.
   */
  async moveToOtherServer(
    matchSlug: string,
    oldServerId: string,
    baseUrl: string
  ): Promise<ServerActionResult> {
    const availableServers = await this.getAvailableServers();
    const fallback = availableServers.find((s) => s.id !== oldServerId);

    if (!fallback) {
      return {
        ok: false,
        conflict: true,
        error:
          'No alternative idle servers are available for reallocation. Please free up a server or update existing ones.',
      };
    }

    // Free old server from allocation tracker immediately.
    serverAllocationTracker.markIdle(oldServerId);

    // Reserve the new server in the tracker so the allocator won't race us.
    serverAllocationTracker.markAllocated(fallback.id, matchSlug);

    // Update match to point to the new server and reset it to a clean pre-load state.
    await db.updateAsync(
      'matches',
      {
        server_id: fallback.id,
        status: 'ready',
        loaded_at: null,
      },
      'slug = ?',
      [matchSlug]
    );

    // Only now that server_id points at the new server: drop any load of this
    // match queued on the old server, then restart it so it returns to a clean
    // state. In that order, a restart that makes an old plugin fetch its queued
    // config is refused by the config route instead of starting a second copy.
    await cancelQueuedLoad(oldServerId, matchSlug);
    try {
      await rconService.sendCommand(oldServerId, 'css_restart');
    } catch (err) {
      log.warn(`Failed to restart old server during reallocation (continuing)`, {
        matchSlug,
        serverId: oldServerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Load on the new server.
    const load = await loadMatchOnServer(matchSlug, fallback.id, { baseUrl });

    if (!load.success) {
      // Roll back the tracker reservation; keep match assigned to the new server
      // so the admin can retry once the underlying issue is fixed.
      serverAllocationTracker.markIdle(fallback.id);
      return {
        ok: false,
        error: load.error || 'Failed to load match on the reallocated server',
        details: { rconResponses: load.rconResponses },
      };
    }

    return {
      ok: true,
      message: `Match reallocated from ${oldServerId} to ${fallback.id}`,
      serverId: fallback.id,
      details: { rconResponses: load.rconResponses },
    };
  }

  /**
   * Best-effort end of a match on its server (force-cancel). Throws when the
   * server cannot be told; the caller carries on regardless.
   *
   * `css_endmatch` is the MatchZy console command that ends and resets the
   * current match (`ConsoleCommand("css_endmatch", "Ends and resets the
   * current match")` in `src/ConsoleCommands.cs` of the plugin — it's
   * registered as an alias of the legacy `get5_endmatch` name, both bound to
   * the same handler). It's the same command the admin "End Match" route
   * already uses (`routes/rcon.ts`), and — unlike `css_restart` — it does not
   * restart the server, so there is no `unconfirmed`-reply case to handle.
   */
  async endMatchOnServer(serverId: string, matchSlug: string): Promise<void> {
    const result = await rconService.sendCommand(serverId, 'css_endmatch');

    if (!result.success) {
      throw new Error(result.error ?? 'css_endmatch failed');
    }

    log.info(`Successfully sent end match command to server ${serverId} for match ${matchSlug}`);
  }

  /**
   * End whatever match is running on the server by restarting it
   * (`css_restart`): tournament restart, reset and delete. Rejects when the
   * command failed. A restart whose RCON reply was lost (the server restarted
   * before answering) counts as ended.
   */
  async restartServerToEndMatch(serverId: string): Promise<void> {
    const result = await rconService.sendCommand(serverId, 'css_restart');

    if (!result.success) {
      throw new Error(result.error ?? 'css_restart failed');
    }

    if (result.unconfirmed) {
      log.warn(
        `Restart sent to server ${serverId}; no RCON reply (server was restarting), counting the match as ended`
      );
    } else {
      log.success(`Match ended on server ${serverId}`);
    }
  }

  /** The series is over: the server is free for the allocator again. */
  markIdle(serverId: string): void {
    serverAllocationTracker.markIdle(serverId);
  }
}

export const cs2ServerPool = new Cs2ServerPool();
