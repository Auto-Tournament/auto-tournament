import { log } from '../utils/logger';

/**
 * Lightweight in-memory tracking of "test event" connectivity checks
 * from MatchZy servers back to this API.
 *
 * When a server sends a special test event (e.g. via css_te), the
 * events route records that here. The server status route can then
 * query this map after triggering the RCON command to verify that
 * the server was able to reach our /api/events endpoint.
 */

const lastTestEventByServer = new Map<string, number>();

export function recordServerTestEvent(serverId: string): void {
  const timestamp = Date.now();
  lastTestEventByServer.set(serverId, timestamp);
  log.debug('[CONNECTIVITY] Recorded test event from server', { serverId, timestamp });
}

export function getLastServerTestEvent(serverId: string): number | null {
  return lastTestEventByServer.get(serverId) ?? null;
}


