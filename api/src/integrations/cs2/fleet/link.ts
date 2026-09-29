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
 *   address where players connect (./address.ts: the server's
 *   `public_addr`, else the link's peer address; never the machine's
 *   hostname), and it has no RCON password. Each hello refreshes that
 *   address (`syncLinkedAddress`).
 * - Link to an existing row (`serverId`): an RCON server that was moved to
 *   Ready Up keeps its id, so history and match links stay, and its host /
 *   port, which an admin entered (`host_override`).
 * - `host` / `port` on the link (or `setLinkAddress` later) are an admin
 *   override: stored with `host_override = 1`, never replaced by a hello.
 *   `setLinkAddress(id, null)` goes back to the detected address.
 * - Unlink: the row goes back to `transport = 'rcon'` and is disabled when it
 *   was created by the link (it has no RCON password to be driven with).
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { chooseConnectAddress, DEFAULT_GAME_PORT, isValidConnectHost, type ConnectAddress } from './address';
import type { HostInfo } from './protocol/v1';
import { getFleetServer, type FleetServerRow } from './registry';

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
  host?: string;
  port?: number;
  host_override?: number | null;
}

/** Where players connect to a linked fleet server (the cs2_servers row's host / port). */
export interface LinkAddress {
  cs2ServerId: string;
  host: string;
  port: number;
  /** An admin set it; hellos leave it alone. */
  override: boolean;
}

/** An admin's connect address: host name or IP, optional port (default: the server's game port). */
export interface AddressOverride {
  host: string;
  port?: number;
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
  return new Map([...(await listLinkAddresses())].map(([fleetId, a]) => [fleetId, a.cs2ServerId]));
}

/** Every link with its connect address, keyed by fleet server id. */
export async function listLinkAddresses(): Promise<Map<string, LinkAddress>> {
  const rows = await db.queryAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport, host, port, host_override FROM cs2_servers
      WHERE transport = 'fleet' AND fleet_server_id IS NOT NULL`
  );
  return new Map(
    rows.map((r) => [
      r.fleet_server_id as string,
      { cs2ServerId: r.id, host: r.host ?? '', port: Number(r.port), override: Number(r.host_override ?? 0) === 1 },
    ])
  );
}

/** Where a fleet server's players would connect if it were linked now (null = nothing usable yet). */
export function detectedAddress(fleet: Pick<FleetServerRow, 'host' | 'peer_addr'>): ConnectAddress | null {
  return chooseConnectAddress(parseHost(fleet.host), fleet.peer_addr ?? null);
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/** Validate an admin's override (both blank = none); the error text is for the API response. */
export function checkAddressOverride(value: {
  host?: unknown;
  port?: unknown;
}): { ok: true; override: AddressOverride | null } | { ok: false; error: string } {
  if (blank(value.host) && blank(value.port)) return { ok: true, override: null };
  if (typeof value.host !== 'string' || !isValidConnectHost(value.host.trim())) {
    return { ok: false, error: 'host must be a host name or IP address (no port, scheme or path)' };
  }
  let port: number | undefined;
  if (!blank(value.port)) {
    port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'port must be 1-65535' };
  }
  return { ok: true, override: { host: value.host.trim(), ...(port ? { port } : {}) } };
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
  options: { serverId?: string; name?: string; address?: AddressOverride } = {}
): Promise<LinkOutcome> {
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return { ok: false, status: 404, error: 'Fleet server not found' };
  if (fleet.status !== 'enrolled') {
    return { ok: false, status: 409, error: 'Only an enrolled fleet server can take matches' };
  }
  const existing = await cs2ServerIdOf(fleetServerId);
  if (existing && (!options.serverId || options.serverId === existing)) {
    if (options.address) await setLinkAddress(fleetServerId, options.address);
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
    // Its host / port were entered by an admin for RCON: keep them unless
    // this link sets new ones.
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, host_override = 1, updated_at = ? WHERE id = ?`,
      [fleetServerId, now, options.serverId]
    );
    if (options.address) await setLinkAddress(fleetServerId, options.address);
    return { ok: true, link: { cs2ServerId: options.serverId, fleetServerId }, created: false };
  }

  const gamePort = parseHost(fleet.host)?.game_port ?? DEFAULT_GAME_PORT;
  const detected = detectedAddress(fleet);
  const override = options.address ?? null;
  // Nothing detected yet (never connected, enrolled before peer addresses
  // were kept): an address that is at least not the machine's name; the next
  // hello replaces it.
  const address = override?.host ?? detected?.host ?? '0.0.0.0';
  const port = override ? (override.port ?? gamePort) : (detected?.port ?? gamePort);
  const hostOverride = override ? 1 : 0;
  const taken = await db.queryOneAsync<{ id: string }>('SELECT id FROM cs2_servers WHERE id = ?', [
    fleetServerId,
  ]);
  if (taken) {
    // A row left from an earlier link: take it over.
    await db.runAsync(
      `UPDATE cs2_servers SET transport = 'fleet', fleet_server_id = ?, host = ?, port = ?, host_override = ?, enabled = 1, updated_at = ? WHERE id = ?`,
      [fleetServerId, address, port, hostOverride, now, fleetServerId]
    );
  } else {
    await db.runAsync(
      `INSERT INTO cs2_servers (id, name, host, port, password, enabled, transport, fleet_server_id, status, host_override)
       VALUES (?, ?, ?, ?, '', 1, 'fleet', ?, 'unknown', ?)`,
      [fleetServerId, (options.name ?? fleet.name).slice(0, 100), address, port, fleetServerId, hostOverride]
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

/**
 * Set (or with null, clear) the admin's connect address of a linked server.
 * Clearing goes back to the detected address right away when there is one.
 * Returns the address now stored, or null when the server is not linked.
 */
export async function setLinkAddress(
  fleetServerId: string,
  override: AddressOverride | null
): Promise<LinkAddress | null> {
  const cs2ServerId = await cs2ServerIdOf(fleetServerId);
  if (!cs2ServerId) return null;
  const now = Math.floor(Date.now() / 1000);
  if (override) {
    const fleet = await getFleetServer(fleetServerId);
    const port = override.port ?? parseHost(fleet?.host ?? null)?.game_port ?? DEFAULT_GAME_PORT;
    await db.runAsync(`UPDATE cs2_servers SET host = ?, port = ?, host_override = 1, updated_at = ? WHERE id = ?`, [
      override.host,
      port,
      now,
      cs2ServerId,
    ]);
  } else {
    await db.runAsync(`UPDATE cs2_servers SET host_override = 0, updated_at = ? WHERE id = ?`, [now, cs2ServerId]);
    await syncLinkedAddress(fleetServerId);
  }
  return (await listLinkAddresses()).get(fleetServerId) ?? null;
}

/**
 * After a hello: move the linked row to the address the server reports now
 * (unless an admin set it). Returns the new address when it changed.
 */
export async function syncLinkedAddress(fleetServerId: string): Promise<ConnectAddress | null> {
  const row = await db.queryOneAsync<LinkRow>(
    `SELECT id, fleet_server_id, transport, host, port, host_override FROM cs2_servers
      WHERE fleet_server_id = ? AND transport = 'fleet'`,
    [fleetServerId]
  );
  if (!row || Number(row.host_override ?? 0) === 1) return null;
  const fleet = await getFleetServer(fleetServerId);
  if (!fleet) return null;
  const next = detectedAddress(fleet);
  if (!next || (next.host === row.host && next.port === Number(row.port))) return null;
  await db.runAsync(`UPDATE cs2_servers SET host = ?, port = ?, updated_at = ? WHERE id = ?`, [
    next.host,
    next.port,
    Math.floor(Date.now() / 1000),
    row.id,
  ]);
  log.info(`[FLEET] ${fleetServerId}: connect address ${row.host}:${row.port} -> ${next.host}:${next.port} (${next.source})`);
  return next;
}
