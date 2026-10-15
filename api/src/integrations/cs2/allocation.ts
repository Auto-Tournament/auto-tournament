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
 * The pool is the Ready Up servers linked on the fleet link (`transport =
 * 'fleet'`, fleet/link.ts). One is free when its socket is up, it reports
 * `available`, it has no loaded/live match in our database and its previous
 * demo is not still uploading. Everything done to a server goes through its
 * driver (./driver.ts).
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { settingsService } from '../../services/settingsService';
import { emitBracketUpdate, emitMatchUpdate } from '../../services/socketService';
import type { DbMatchRow } from '../../types/database.types';
import type { ServerResponse } from '../../types/server.types';
import { matchBracketOf } from '../../core/allocationQueue';
import type { ResourcePoolStatus } from '../types';
import { serverService } from './services/serverService';
import { ServerStatus } from './services/serverStatusService';
import { serverAllocationTracker } from './services/serverAllocationTracker';
import { serverTurnoverTracker } from './utils/serverTurnover';
import { driverFor } from './driver';
import { fleetServerIsIdle } from './fleet/driver';
import { reserveCount } from './fleet/failoverSettings';
import { pickReserved } from './fleet/failoverPlan';

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

/** Ready Up's series-end kick delay when its server settings name none (match_end.h). */
const READY_UP_KICK_DELAY_DEFAULT = 30;
/** The longest kick delay the server settings allow (fleet/push/settings.ts). */
const KICK_DELAY_MAX_SECONDS = 3600;

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
  // How long callers that schedule a delayed allocation pass (shuffle round
  // advancement) wait for servers to come free. Ready Up servers themselves
  // report `available` only once they are clean, so the pool adds no window.
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
  /**
   * Seconds a server sits out after its match ends: the series-end kick delay Ready Up uses
   * (its server settings, `server.config.series_end_kick_delay`, the longest of the three
   * cases; Ready Up's default is 30 s each), plus 15 s for the kick and reset. Simulation
   * (bots only), or a kick delay of 0: none. The match-rules page had a second copy of this
   * value that Ready Up never read (Vikunja #355).
   */
  async serverCooldownSeconds(fleetServerId: string): Promise<number> {
    if (await settingsService.isSimulationModeEnabled()) return 0;
    const { effectiveSettings } = await import('./fleet/push/settings');
    const kick = (await effectiveSettings(fleetServerId).catch(() => null))?.effective.config
      ?.series_end_kick_delay;
    const delay = Math.max(
      ...(['no_demo', 'demo_no_upload', 'demo_upload'] as const).map((k) =>
        typeof kick?.[k] === 'number' ? (kick[k] as number) : READY_UP_KICK_DELAY_DEFAULT
      )
    );
    // A kick delay of 0 is an admin who wants the server back at once: no wait either.
    return delay > 0 ? delay + 15 : 0;
  }

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
    const enabledServers = (await serverService.getAllServers(true)).filter(
      (server) => server.transport === 'fleet'
    );

    const statusChecks = await Promise.all(
      enabledServers.map(async (server) => {
        try {
          const fleet = await fleetServerIsIdle(server.id);
          return {
            server,
            status: fleet.status,
            matchSlug: null as string | null,
            updatedAt: fleet.idleSince,
            online: fleet.online,
            fleetIdle: fleet.idle,
          };
        } catch {
          return {
            server,
            status: null as ServerStatus | null,
            matchSlug: null as string | null,
            updatedAt: null as number | null,
            online: false,
            fleetIdle: false,
          };
        }
      })
    );

    // Matches our database has loaded/live on a server.
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
    const nextAllocationInSeconds: number | null = null;
    const servers: ServerPoolEntry[] = [];

    let offlineCount = 0;
    let busyCount = 0;
    const graceWindowCount = 0;

    for (const check of statusChecks) {
      const { server, status, matchSlug, updatedAt, online } = check;

      if (!online) {
        offlineCount += 1;
      }

      const dbBusy = dbBusyByServer.get(server.id) || null;
      const effectiveMatchSlug = matchSlug || dbBusy?.slug || null;

      // Idle: Ready Up reports `available` and our own records have no
      // loaded/live match on it. A 'loaded' row older than STALE_LOADED_SECONDS
      // while Ready Up says available is stale (an abandoned load) and does not
      // hold the server; a 'live' row always does, and is surfaced instead.
      const serverSaysIdle = check.fleetIdle === true;
      const dbSaysBusy = dbBusy !== null;
      const dbBusyIsRecent =
        dbBusy !== null &&
        (dbBusy.loadedAt === null || now - dbBusy.loadedAt < Cs2ServerPool.STALE_LOADED_SECONDS);
      const dbRecordIsStale =
        dbSaysBusy && serverSaysIdle && !dbBusyIsRecent && dbBusy?.status === 'loaded';

      if (dbRecordIsStale) {
        log.warn(
          `[ALLOCATION] ${server.id} reports available but match ${dbBusy?.slug} is still marked loaded; ` +
            `treating the record as stale and allowing allocation`
        );
      }

      const isIdle = serverSaysIdle && (!dbSaysBusy || dbRecordIsStale);

      let demoUploadPending = false;
      let secondsUntilReady: number | null = null;
      let allocatable = false;

      const turnover = isIdle
        ? serverTurnoverTracker.evaluate(server.id, updatedAt ?? null, now)
        : null;

      if (isIdle && turnover?.demoUploadPending) {
        // The previous series' demo is still uploading: never hand the server
        // out, however long it has been idle.
        demoUploadPending = true;
        secondsUntilReady = turnover.demoUploadGiveUpInSeconds;
      } else if (isIdle) {
        // Ready Up says `available` only once the previous match is unloaded
        // and its players are gone: no grace window on top.
        allocatable = true;
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
        inGraceWindow: false,
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
   * Servers that can take a match now (enabled, for tournament use, linked
   * Ready Up servers that are free: see `availableFleetServers`). The
   * failover reserve (fleet/failoverSettings.ts) is left out unless
   * `includeFleetReserve` (failover itself asks with it).
   */
  async getAvailableServers(
    options: { includeFleetReserve?: boolean } = {}
  ): Promise<ServerResponse[]> {
    const servers = (await serverService.getAllServers(true)).filter(
      (s) => s.tournamentUse !== false && s.transport === 'fleet'
    );
    await serverAllocationTracker.releaseFinished();

    const dbBusyRows = await db.queryAsync<{ server_id: string; slug: string }>(
      `SELECT server_id, slug
         FROM matches
        WHERE server_id IS NOT NULL
          AND server_id != ''
          AND status IN ('loaded', 'live')`
    );
    const dbBusyServers = new Set(dbBusyRows.map((row) => row.server_id));
    const now = Math.floor(Date.now() / 1000);

    // A server that just finished a match keeps its players for the series-end kick delay
    // (the result, a gg): Ready Up reports itself free as soon as the match is unassigned,
    // so the next match loaded the next map 1 s after the last one ended, over the end
    // card (2026-10-15). Hold it until the delay has passed, plus a margin.
    const recent = await db.queryAsync<{ server_id: string; ended: number }>(
      `SELECT server_id, MAX(completed_at) AS ended
         FROM matches
        WHERE server_id IS NOT NULL AND server_id != '' AND completed_at IS NOT NULL
          AND completed_at > ?
        GROUP BY server_id`,
      [now - (KICK_DELAY_MAX_SECONDS + 15)]
    );
    for (const row of recent) {
      const cooldown = await this.serverCooldownSeconds(row.server_id);
      const since = now - Number(row.ended);
      if (since >= cooldown) continue;
      log.debug(
        `Server ${row.server_id} finished a match ${since}s ago; free in ${cooldown - since}s`
      );
      dbBusyServers.add(row.server_id);
    }

    const available = await this.availableFleetServers(
      servers,
      dbBusyServers,
      now,
      options.includeFleetReserve === true
    );
    log.debug(`Found ${available.length} available servers out of ${servers.length} enabled`);
    return available;
  }

  /**
   * The Ready Up servers of the pool that can take a match now: connected and
   * `available` (fleet/driver.ts), not being handed a match, not busy in our
   * own records, and past their turnover (a demo upload still running holds
   * the server). No webhook check: events come over the same socket. The
   * failover reserve (idle servers kept for FLEET.md §11) is held back unless
   * `includeReserve`.
   */
  private async availableFleetServers(
    servers: ServerResponse[],
    dbBusyServers: Set<string>,
    now: number,
    includeReserve = false
  ): Promise<ServerResponse[]> {
    const available: ServerResponse[] = [];
    for (const server of servers) {
      if (this.allocatingServers.has(server.id) || serverAllocationTracker.isBusy(server.id))
        continue;
      if (dbBusyServers.has(server.id)) {
        log.debug(
          `Fleet server ${server.id} (${server.name}) not available: database shows loaded/live match`
        );
        continue;
      }
      const fleet = await fleetServerIsIdle(server.id);
      if (!fleet.idle) {
        log.debug(
          `Fleet server ${server.id} (${server.name}) not available (online=${fleet.online}, status=${fleet.status})`
        );
        continue;
      }
      if (serverTurnoverTracker.evaluate(server.id, fleet.idleSince, now).demoUploadPending) {
        log.debug(
          `Fleet server ${server.id} (${server.name}) is available but its previous demo is still uploading`
        );
        continue;
      }
      available.push(server);
      serverAllocationTracker.markIdle(server.id);
    }
    // The reserve is there to fail a live match over to; with no match live
    // there is nothing to fail over, and it never takes the last free server
    // (the 2026-10-12 final waited behind a reserve of one).
    if (includeReserve || available.length <= 1 || dbBusyServers.size === 0) return available;
    const { effective } = await reserveCount();
    const held = pickReserved(available, Math.min(effective, available.length - 1));
    if (held.size > 0)
      log.debug(`Fleet servers held in reserve for failover: ${[...held].join(', ')}`);
    return available.filter((server) => !held.has(server.id));
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
    server: ServerResponse
  ): Promise<ServerAllocationResult> {
    try {
      // Final live status check right before allocation so we don't rely on
      // the older snapshot returned from getAvailableServers.
      const driver = await driverFor(server.id);
      const statusInfo = await driver.checkIdle(server.id);

      if (!statusInfo.idle) {
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
      // and ensures that even if the server's state is momentarily misleading, we
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

      log.info(
        `[ALLOCATION] Allocating match ${matchSlug} to server ${server.name} (${server.id})`
      );

      // Mark server as "in allocation" to prevent concurrent allocations
      this.allocatingServers.add(server.id);
      serverAllocationTracker.markAllocated(server.id, matchSlug);

      // Persist server_id on the match so UIs and webhooks see the assignment
      await db.updateAsync('matches', { server_id: server.id }, 'slug = ?', [matchSlug]);

      // Emit websocket event for server assignment
      await this.emitServerAssigned(matchSlug, server.id);

      // Assign the match to the server (Ready Up validates the config)
      const loadResult = await driver.loadMatch(matchSlug, server.id);

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
      // A Ready Up server that refused (busy, draining): free for the next pass.
      if (loadResult.retryElsewhere) serverAllocationTracker.markIdle(server.id);

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
  async allocateBatch(matchSlugs: string[]): Promise<ServerAllocationResult[]> {
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
        allocationTasks.push(this.allocateMatchToServerOnce(matchSlugs[i], availableServers[i]));
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
  async allocate(matchSlug: string): Promise<ServerAllocationResult> {
    // Ready Up servers that refused the match in this call (busy, draining, no answer).
    const refused = new Set<string>();
    for (;;) {
      const { retryElsewhere, ...result } = await this.allocateOnce(matchSlug, refused);
      if (!retryElsewhere || !result.serverId || refused.size >= 16) return result;
      log.warn(
        `[ALLOCATION] ${result.serverId} refused match ${matchSlug} (${result.error}); trying another server`
      );
      refused.add(result.serverId);
    }
  }

  /**
   * Put one match on the server an admin picked (the failover reserve
   * included). Refused when that server is not free right now.
   */
  async allocateTo(matchSlug: string, serverId: string): Promise<ServerAllocationResult> {
    const result = await this.allocateOnce(matchSlug, new Set(), serverId);
    delete result.retryElsewhere;
    return result;
  }

  private async allocateOnce(
    matchSlug: string,
    skip: ReadonlySet<string>,
    only?: string
  ): Promise<ServerAllocationResult & { retryElsewhere?: boolean }> {
    let allocatedServerId: string | null = null;
    try {
      // Get first available server, respecting the in‑memory "allocating" guard
      // so concurrent allocations never pick the same server. An admin's pick
      // (`only`) may take a failover reserve server too.
      const availableServers = (
        await this.getAvailableServers(only ? { includeFleetReserve: true } : undefined)
      ).filter((s) => !skip.has(s.id) && (!only || s.id === only));
      if (availableServers.length === 0) {
        return {
          matchSlug,
          success: false,
          error: only ? 'That server is not free right now' : 'No available servers',
        };
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
      const driver = await driverFor(server.id);
      const loadResult = await driver.loadMatch(matchSlug, server.id);

      if (loadResult.success) {
        log.matchAllocated(matchSlug, server.id, server.name);
        return { matchSlug, success: true, serverId: server.id };
      }

      // Rollback server_id if loading failed
      await db.updateAsync('matches', { server_id: null }, 'slug = ?', [matchSlug]);
      if (loadResult.retryElsewhere) serverAllocationTracker.markIdle(server.id);
      return {
        matchSlug,
        success: false,
        serverId: server.id,
        error: loadResult.error || 'Failed to load match',
        ...(loadResult.retryElsewhere ? { retryElsewhere: true } : {}),
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
  async restartMatch(matchSlug: string): Promise<{
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
      const driver = await driverFor(serverId);

      // Step 1: end the current match (match.unassign)
      log.info(`Ending match ${matchSlug} on server ${serverId}`);
      const endResult = await driver.stopForReload(serverId, matchSlug);

      if (!endResult.ok) {
        return {
          success: false,
          message: `Failed to end match: ${endResult.error}`,
          error: endResult.error,
        };
      }

      if (endResult.unconfirmed) {
        log.warn(
          `[RESTART] Unassign sent for match ${matchSlug} on ${serverId}; no answer yet, continuing`
        );
      } else {
        log.success(`[RESTART] Match ${matchSlug} ended successfully`);
      }

      // Step 3: Reset match status to 'ready'
      await db.updateAsync('matches', { status: 'ready', loaded_at: null }, 'slug = ?', [
        matchSlug,
      ]);

      // Step 4: Reload the match on the same server
      log.info(`Reloading match ${matchSlug} on server ${serverId}`);
      const loadResult = await driver.loadMatch(matchSlug, serverId);

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
  async loadAssigned(match: {
    id: number;
    slug: string;
    round: number;
    server_id?: string | null;
  }): Promise<ServerActionResult> {
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

    const result = await (
      await driverFor(serverIdToUse as string)
    ).loadMatch(slug, serverIdToUse as string);
    if (result.success) {
      return {
        ok: true,
        message: 'Match sent to the server',
        ...(serverIdToUse ? { serverId: serverIdToUse } : {}),
      };
    }
    return { ok: false, error: result.error || 'Failed to load match' };
  }

  /**
   * Move a match that has not gone live to another idle server (pre-live
   * recovery, e.g. the assigned server is out of date). The caller has checked
   * the match is 'ready' or 'loaded' and has a server.
   */
  async moveToOtherServer(matchSlug: string, oldServerId: string): Promise<ServerActionResult> {
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

    // Only now that server_id points at the new server: the old one gets
    // match.unassign {moved}.
    await (await driverFor(oldServerId)).releaseForMove(oldServerId, matchSlug);

    // Load on the new server.
    const load = await (await driverFor(fallback.id)).loadMatch(matchSlug, fallback.id);

    if (!load.success) {
      // Roll back the tracker reservation; keep match assigned to the new server
      // so the admin can retry once the underlying issue is fixed.
      serverAllocationTracker.markIdle(fallback.id);
      return {
        ok: false,
        error: load.error || 'Failed to load match on the reallocated server',
      };
    }

    return {
      ok: true,
      message: `Match reallocated from ${oldServerId} to ${fallback.id}`,
      serverId: fallback.id,
    };
  }

  /**
   * Best-effort end of a match on its server (force-cancel: match.unassign
   * {cancelled}). Throws when the server cannot be told; the caller carries
   * on regardless.
   */
  async endMatchOnServer(serverId: string, matchSlug: string): Promise<void> {
    await (await driverFor(serverId)).endMatch(serverId, matchSlug);

    log.info(`Successfully sent end match command to server ${serverId} for match ${matchSlug}`);
  }

  /**
   * End whatever match is running on the server (every assignment unassigned):
   * tournament restart, reset and delete. Rejects when it failed.
   */
  async restartServerToEndMatch(serverId: string): Promise<void> {
    const result = await (await driverFor(serverId)).resetServer(serverId);

    if (result.unconfirmed) {
      log.warn(`Unassign sent to server ${serverId}; no answer yet, counting the match as ended`);
    } else {
      log.success(`Match ended on server ${serverId}`);
    }
  }

  /** The series is over: the server is free for the allocator again. */
  markIdle(serverId: string): void {
    serverAllocationTracker.markIdle(serverId);
  }

  /**
   * The series is over and stored: tell the server (match.unassign {ended}).
   * Never throws.
   */
  async seriesDone(serverId: string, matchSlug: string): Promise<void> {
    try {
      await (await driverFor(serverId)).seriesDone(serverId, matchSlug);
    } catch (error) {
      log.warn(`[RELEASE] Could not tell server ${serverId} that ${matchSlug} is over`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const cs2ServerPool = new Cs2ServerPool();
