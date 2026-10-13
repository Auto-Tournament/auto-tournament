/**
 * How the platform drives a CS2 server: Ready Up on the fleet link
 * (fleet/driver.ts): `match.assign` / `match.unassign` / `cmd` over the
 * WebSocket. A server takes matches once it is linked to a `cs2_servers` row
 * (`transport = 'fleet'`); the pool (./allocation.ts) goes through
 * `driverFor(serverId)` for everything it does to one.
 */

import { log } from '../../utils/logger';
import { db } from '../../config/database';
import type { ServerStatus } from './services/serverStatusService';
import {
  assignMatch,
  CANCELLED_KICK_MESSAGE,
  fleetServerIsIdle,
  MOVED_KICK_MESSAGE,
  unassignAll,
  unassignMatch,
} from './fleet/driver';

export interface MatchLoadResult {
  success: boolean;
  error?: string;
}

export interface DriverLoadResult extends MatchLoadResult {
  /** The server cannot take the match now (fleet: busy, draining, offline, no answer): try another. */
  retryElsewhere?: boolean;
}

export interface ServerDriver {
  /** Put the match on the server; on success the match is `loaded`. */
  loadMatch(matchSlug: string, serverId: string): Promise<DriverLoadResult>;
  /** After a failed load or a move: make sure the server does not start the match later. */
  cancelQueuedLoad(serverId: string, matchSlug: string): Promise<void>;
  /** The allocator's last look before it hands the server a match. */
  checkIdle(serverId: string): Promise<{
    idle: boolean;
    online: boolean;
    status: ServerStatus | null;
    matchSlug: string | null;
  }>;
  /** End the match and free the server (force-cancel). Throws when the server could not be told. */
  endMatch(serverId: string, matchSlug: string): Promise<void>;
  /** End whatever runs on the server (tournament restart, reset, delete). Throws when it failed. */
  resetServer(serverId: string): Promise<{ unconfirmed?: boolean }>;
  /** Stop the match so it can be loaded again on the same server (restart). */
  stopForReload(
    serverId: string,
    matchSlug: string
  ): Promise<{ ok: boolean; error?: string; unconfirmed?: boolean }>;
  /** The match is moving to another server: free this one, never mind the outcome. */
  releaseForMove(serverId: string, matchSlug: string): Promise<void>;
  /** The series is over and stored. */
  seriesDone(serverId: string, matchSlug: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fleet (Ready Up)
// ---------------------------------------------------------------------------

export const fleetDriver: ServerDriver = {
  async loadMatch(matchSlug, serverId) {
    const result = await assignMatch(matchSlug, serverId);
    return {
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
      ...(result.retryElsewhere ? { retryElsewhere: true } : {}),
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
    // No Ready Up server behind the row: nothing could be told (the caller warns).
    if (!(await isLinkedServer(serverId))) {
      throw new Error(`no Ready Up server is linked to ${serverId}`);
    }
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
      return {
        ok: false,
        error: `Ready Up refused the unassign (${answer.errorCode ?? answer.status})`,
      };
    }
    // No answer yet: the unassign is ahead of the new assign in the server's
    // stream, so the reload still lands after it.
    return { ok: true, unconfirmed: sent && !answer };
  },

  async releaseForMove(serverId, matchSlug) {
    try {
      await unassignMatch(serverId, matchSlug, 'moved', { kickMessage: MOVED_KICK_MESSAGE });
    } catch (err) {
      log.warn(
        `Failed to unassign the match from the old fleet server during reallocation (continuing)`,
        {
          matchSlug,
          serverId,
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  },

  async seriesDone(serverId, matchSlug) {
    // Players are kicked after Ready Up's series-end delay (no kick_message).
    await unassignMatch(serverId, matchSlug, 'ended');
  },
};

/** Is the `cs2_servers` row a linked Ready Up server (the only kind that takes matches)? */
export async function isLinkedServer(serverId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ transport: string | null }>(
    'SELECT transport FROM cs2_servers WHERE id = ?',
    [serverId]
  );
  return row?.transport === 'fleet';
}

export async function driverFor(_serverId: string): Promise<ServerDriver> {
  return fleetDriver;
}
