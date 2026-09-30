/**
 * How the platform drives a CS2 server: the `ServerDriver` for its
 * `cs2_servers.transport`.
 *
 * - `rcon`: MatchZy Enhanced over RCON (services/matchLoadingService.ts,
 *   utils/pluginRconCommands.ts). Every server before the fleet link; the
 *   calls below are the ones the pool (./allocation.ts) made directly, with
 *   the same commands and results.
 * - `fleet`: a Ready Up server on the fleet link (fleet/driver.ts):
 *   `match.assign` / `match.unassign` / `cmd` over the WebSocket, no RCON.
 *
 * The pool picks servers from both (a mixed pool) and goes through
 * `driverFor(serverId)` for everything it does to one.
 */

import { log } from '../../utils/logger';
import { db } from '../../config/database';
import type { ServerTransport } from '../../types/server.types';
import { rconService } from './services/rconService';
import {
  cancelQueuedLoad as rconCancelQueuedLoad,
  loadMatchOnServer,
  type MatchLoadOptions,
  type MatchLoadResult,
} from './services/matchLoadingService';
import { serverStatusService, isAllocatableStatus, type ServerStatus } from './services/serverStatusService';
import {
  assignMatch,
  CANCELLED_KICK_MESSAGE,
  fleetServerIsIdle,
  MOVED_KICK_MESSAGE,
  unassignAll,
  unassignMatch,
} from './fleet/driver';

export interface DriverLoadResult extends MatchLoadResult {
  /** The server cannot take the match now (fleet: busy, draining, offline, no answer): try another. */
  retryElsewhere?: boolean;
}

export interface ServerDriver {
  readonly transport: ServerTransport;
  /** Put the match on the server; on success the match is `loaded`. */
  loadMatch(matchSlug: string, serverId: string, options: MatchLoadOptions): Promise<DriverLoadResult>;
  /** After a failed load or a move: make sure the server does not start the match later. */
  cancelQueuedLoad(serverId: string, matchSlug: string): Promise<void>;
  /** The allocator's last look before it hands the server a match. */
  checkIdle(serverId: string): Promise<{ idle: boolean; online: boolean; status: ServerStatus | null; matchSlug: string | null }>;
  /** End the match and free the server (force-cancel). Throws when the server could not be told. */
  endMatch(serverId: string, matchSlug: string): Promise<void>;
  /** End whatever runs on the server (tournament restart, reset, delete). Throws when it failed. */
  resetServer(serverId: string): Promise<{ unconfirmed?: boolean }>;
  /** Stop the match so it can be loaded again on the same server (restart). */
  stopForReload(serverId: string, matchSlug: string): Promise<{ ok: boolean; error?: string; unconfirmed?: boolean }>;
  /** The match is moving to another server: free this one, never mind the outcome. */
  releaseForMove(serverId: string, matchSlug: string): Promise<void>;
  /** The series is over and stored. */
  seriesDone(serverId: string, matchSlug: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// RCON (MatchZy Enhanced)
// ---------------------------------------------------------------------------

export const rconDriver: ServerDriver = {
  transport: 'rcon',

  loadMatch(matchSlug, serverId, options) {
    return loadMatchOnServer(matchSlug, serverId, options);
  },

  async cancelQueuedLoad(serverId, matchSlug) {
    await rconCancelQueuedLoad(serverId, matchSlug);
  },

  async checkIdle(serverId) {
    const info = await serverStatusService.getServerStatus(serverId);
    return {
      idle: info.online && isAllocatableStatus(info.status, info.matchSlug),
      online: info.online,
      status: info.status,
      matchSlug: info.matchSlug,
    };
  },

  /**
   * `css_endmatch` ends and resets the current match without restarting the
   * server (see Cs2ServerPool.endMatchOnServer).
   */
  async endMatch(serverId) {
    const result = await rconService.sendCommand(serverId, 'css_endmatch');
    if (!result.success) {
      throw new Error(result.error ?? 'css_endmatch failed');
    }
  },

  async resetServer(serverId) {
    const result = await rconService.sendCommand(serverId, 'css_restart');
    if (!result.success) {
      throw new Error(result.error ?? 'css_restart failed');
    }
    return { unconfirmed: result.unconfirmed };
  },

  async stopForReload(serverId) {
    const result = await rconService.sendCommand(serverId, 'css_restart');
    if (!result.success) return { ok: false, error: result.error };
    // Give the server a few seconds to clean up before the reload.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return { ok: true, unconfirmed: result.unconfirmed };
  },

  async releaseForMove(serverId, matchSlug) {
    // Drop any load of this match queued on the old server, then restart it
    // so it returns to a clean state (the caller has already pointed the
    // match elsewhere, so a queued config fetch is refused).
    await rconCancelQueuedLoad(serverId, matchSlug);
    try {
      await rconService.sendCommand(serverId, 'css_restart');
    } catch (err) {
      log.warn(`Failed to restart old server during reallocation (continuing)`, {
        matchSlug,
        serverId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async seriesDone() {
    // The plugin resets itself after series_end.
  },
};

// ---------------------------------------------------------------------------
// Fleet (Ready Up)
// ---------------------------------------------------------------------------

export const fleetDriver: ServerDriver = {
  transport: 'fleet',

  async loadMatch(matchSlug, serverId) {
    const result = await assignMatch(matchSlug, serverId);
    return {
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
      ...(result.retryElsewhere ? { retryElsewhere: true } : {}),
      // Events come over the link; there is no webhook or upload URL to set.
      webhookConfigured: result.success,
      demoUploadConfigured: false,
    };
  },

  async cancelQueuedLoad(serverId, matchSlug) {
    // A failed assign is unassigned by assignMatch itself; this covers a
    // match that is moved away after it was accepted.
    await unassignMatch(serverId, matchSlug, 'moved', { kickMessage: MOVED_KICK_MESSAGE });
  },

  async checkIdle(serverId) {
    const s = await fleetServerIsIdle(serverId);
    return { idle: s.idle, online: s.online, status: s.status, matchSlug: null };
  },

  async endMatch(serverId, matchSlug) {
    await unassignMatch(serverId, matchSlug, 'cancelled', { kickMessage: CANCELLED_KICK_MESSAGE });
  },

  async resetServer(serverId) {
    await unassignAll(serverId, 'admin', CANCELLED_KICK_MESSAGE);
    return {};
  },

  async stopForReload(serverId, matchSlug) {
    const { sent, answer } = await unassignMatch(serverId, matchSlug, 'admin', {
      kickMessage: 'The match is being restarted by an admin. Reconnect in a moment.',
      wait: true,
    });
    if (sent && answer && answer.status !== 'ok' && answer.errorCode !== 'not_assigned') {
      return { ok: false, error: `Ready Up refused the unassign (${answer.errorCode ?? answer.status})` };
    }
    // No answer yet: the unassign is ahead of the new assign in the server's
    // stream, so the reload still lands after it.
    return { ok: true, unconfirmed: sent && !answer };
  },

  async releaseForMove(serverId, matchSlug) {
    try {
      await unassignMatch(serverId, matchSlug, 'moved', { kickMessage: MOVED_KICK_MESSAGE });
    } catch (err) {
      log.warn(`Failed to unassign the match from the old fleet server during reallocation (continuing)`, {
        matchSlug,
        serverId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async seriesDone(serverId, matchSlug) {
    // Players are kicked after Ready Up's series-end delay (no kick_message).
    await unassignMatch(serverId, matchSlug, 'ended');
  },
};

/** `cs2_servers.transport`; 'rcon' for an unknown server (the old behaviour). */
export async function transportOf(serverId: string): Promise<ServerTransport> {
  const row = await db.queryOneAsync<{ transport: string | null }>(
    'SELECT transport FROM cs2_servers WHERE id = ?',
    [serverId]
  );
  return row?.transport === 'fleet' ? 'fleet' : 'rcon';
}

export async function driverFor(serverId: string): Promise<ServerDriver> {
  return (await transportOf(serverId)) === 'fleet' ? fleetDriver : rconDriver;
}
