/**
 * Which `cs2_servers` row a Ready Up fleet server plays matches as.
 *
 * Matches point at `cs2_servers` (`matches.server_id`), and so do the
 * allocator, the admin buttons and the match pages. A fleet server
 * (`cs2_fleet_servers`, enrolled over `/api/fleet/enroll`) takes matches once
 * an admin links it to a row: `transport = 'fleet'` and `fleet_server_id` on
 * that row (migration 006). Linking is explicit (`POST
 * /api/fleet/servers/:id/link`), so enrolling a server never puts it in the
 * match pool by itself.
 *
 * - Link to a new row (the default): its id is the fleet server's id, its
 *   address the one the server reported in its hello (for the connect
 *   string), and it has no RCON password.
 * - Link to an existing row (`serverId`): an RCON server that was moved to
 *   Ready Up keeps its id, so history and match links stay.
 * - Unlink: the row goes back to `transport = 'rcon'` and is disabled when it
 *   was created by the link (it has no RCON password to be driven with).
 */

import { db } from '../../../config/database';
import type { HostInfo } from './protocol/v1';
import { getFleetServer } from './registry';

export interface FleetLink {
  /** cs2_servers.id (matches.server_id). */
  cs2ServerId: string;
  /** cs2_fleet_servers.id. */
  fleetServerId: string;
}

interface LinkRow {
  id: string;
  fleet_server_id: string | null;
  transport: string | null;
}

/** The fleet server behind a cs2_servers row, or null for an RCON server. */
export async function fleetServerIdOf(cs2ServerId: string): Promise<string | null> {
  const row = await db.queryOneAsync<LinkRow>(
    'SELECT id, fleet_server_id, transport FROM cs2_servers WHERE id = ?',
    [cs2ServerId]
  );
  return row && row.transport === 'fleet' && row.fleet_server_id ? row.fleet_server_id : null;
}

/** The cs2_servers row a fleet server plays as, or null when it is not linked. */
export async function cs2ServerIdOf(fleetServerId: string): Promise<string | null> {
  const row = await db.queryOneAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport FROM cs2_servers WHERE fleet_server_id = ? AND transport = 'fleet'`,
    [fleetServerId]
  );
  return row?.id ?? null;
}

/** Every link, keyed by fleet server id (for the fleet list). */
export async function listFleetLinks(): Promise<Map<string, string>> {
  const rows = await db.queryAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport FROM cs2_servers WHERE transport = 'fleet' AND fleet_server_id IS NOT NULL`
  );
  return new Map(rows.map((r) => [r.fleet_server_id as string, r.id]));
}

function parseHost(raw: string | null): HostInfo | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HostInfo;
  } catch {
    return null;
  }
}

export type LinkOutcome =
  | { ok: true; link: FleetLink; created: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Link an enrolled fleet server to `serverId` (an existing cs2_servers row),
 * or to a new row named after it.
 */
export async function linkFleetServer(
  fleetServerId: string,
  options: { serverId?: string; name?: string } = {}
): Promise<LinkOutcome> {
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return { ok: false, status: 404, error: 'Fleet server not found' };
  if (fleet.status !== 'enrolled') {
    return { ok: false, status: 409, error: 'Only an enrolled fleet server can take matches' };
  }
  const existing = await cs2ServerIdOf(fleetServerId);
  if (existing && (!options.serverId || options.serverId === existing)) {
    return { ok: true, link: { cs2ServerId: existing, fleetServerId }, created: false };
  }
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `Fleet server is already linked to server ${existing}; unlink it first`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (options.serverId) {
    const row = await db.queryOneAsync<LinkRow>(
      'SELECT id, fleet_server_id, transport FROM cs2_servers WHERE id = ?',
      [options.serverId]
    );
    if (!row) return { ok: false, status: 404, error: `Server ${options.serverId} not found` };
    if (row.fleet_server_id && row.fleet_server_id !== fleetServerId) {
      return { ok: false, status: 409, error: `Server ${options.serverId} is linked to another fleet server` };
    }
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, updated_at = ? WHERE id = ?`,
      [fleetServerId, now, options.serverId]
    );
    return { ok: true, link: { cs2ServerId: options.serverId, fleetServerId }, created: false };
  }

  const host = parseHost(fleet.host);
  const address = host?.public_addr?.split(':')[0] || host?.hostname || '0.0.0.0';
  const port = host?.game_port ?? 27015;
  const taken = await db.queryOneAsync<{ id: string }>('SELECT id FROM cs2_servers WHERE id = ?', [
    fleetServerId,
  ]);
  if (taken) {
    // A row left from an earlier link: take it over.
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, host = ?, port = ?, enabled = 1, updated_at = ? WHERE id = ?`,
      [fleetServerId, address, port, now, fleetServerId]
    );
  } else {
    await db.runAsync(
      `INSERT INTO cs2_servers (id, name, host, port, password, enabled, transport, fleet_server_id, status)
       VALUES (?, ?, ?, ?, '', 1, 'fleet', ?, 'unknown')`,
      [fleetServerId, (options.name ?? fleet.name).slice(0, 100), address, port, fleetServerId]
    );
  }
  return { ok: true, link: { cs2ServerId: fleetServerId, fleetServerId }, created: !taken };
}

/** Undo a link. Returns the row that was linked, or null when there was none. */
export async function unlinkFleetServer(fleetServerId: string): Promise<string | null> {
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return null;
  const now = Math.floor(Date.now() / 1000);
  // A row the link created has no RCON password: disable it rather than leave
  // an RCON server nobody can reach in the pool.
  await db.runAsync(
    `UPDATE cs2_servers
        SET transport = 'rcon', fleet_server_id = NULL, updated_at = ?,
            enabled = CASE WHEN id = ? AND password = '' THEN 0 ELSE enabled END
      WHERE id = ?`,
    [now, fleetServerId, cs2ServerId]
  );
  return cs2ServerId;
}
