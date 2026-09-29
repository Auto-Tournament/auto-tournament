/**
 * Pure helpers for the host channel (no database): which servers a command
 * touches, and the join of csm's inventory with Ready Up server records
 * (FLEET.md §18.3). Tests import this file directly.
 */

import type { HostCommandType, HostInventoryServer } from '../protocol/host/v1';

/** The servers a command touches: its `server`, its `servers`, or (updates) every server on the host. */
export function commandTargets(
  type: HostCommandType,
  payload: Record<string, unknown>,
  inventory: Array<Pick<HostInventoryServer, 'name'>>
): string[] {
  if (typeof payload.server === 'string') return [payload.server];
  if (Array.isArray(payload.servers)) return payload.servers.filter((s): s is string => typeof s === 'string');
  if (type === 'host.update_game' || type === 'host.update_plugins') return inventory.map((s) => s.name);
  return [];
}

export interface HostFleetServerRef {
  id: string;
  name: string;
  status: string;
  online: boolean;
  availability: string | null;
  readyUpVersion: string | null;
}

export interface HostServerView extends HostInventoryServer {
  /** The Ready Up server record this process is, joined on install_id (or server_id). */
  fleetServer: HostFleetServerRef | null;
  /** update_safe false, or its Ready Up server is busy with a match. */
  matchInProgress: boolean;
}

export interface FleetServerJoinRow {
  id: string;
  name: string;
  status: string;
  install_id: string | null;
  availability: string | null;
  versions: string | null;
}

export interface FleetServerIndex {
  byInstall: Map<string, FleetServerJoinRow>;
  byId: Map<string, FleetServerJoinRow>;
}

export function indexFleetServers(rows: FleetServerJoinRow[]): FleetServerIndex {
  return {
    byInstall: new Map(rows.filter((r) => r.install_id).map((r) => [r.install_id as string, r])),
    byId: new Map(rows.map((r) => [r.id, r])),
  };
}

function readyUpVersion(row: FleetServerJoinRow): string | null {
  if (!row.versions) return null;
  try {
    return (JSON.parse(row.versions) as { core?: string }).core ?? null;
  } catch {
    return null;
  }
}

export function toServerRef(row: FleetServerJoinRow, online: boolean): HostFleetServerRef {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    online,
    availability: row.availability,
    readyUpVersion: readyUpVersion(row),
  };
}

/**
 * One row per `server-N`: csm's process view next to its Ready Up server
 * (joined on `install_id`, else `server_id`), and whether a match is in
 * progress there (`update_safe: false`, or the Ready Up server is busy).
 */
export function joinInventory(
  servers: HostInventoryServer[],
  index: FleetServerIndex,
  isOnline: (serverId: string) => boolean
): HostServerView[] {
  return servers.map((s) => {
    const row =
      (s.readyup.install_id ? index.byInstall.get(s.readyup.install_id) : undefined) ??
      (s.readyup.server_id ? index.byId.get(s.readyup.server_id) : undefined) ??
      null;
    const fleetServer = row ? toServerRef(row, isOnline(row.id)) : null;
    return {
      ...s,
      fleetServer,
      matchInProgress: s.readyup.update_safe === false || fleetServer?.availability === 'busy',
    };
  });
}

/**
 * The servers a finished `server.create` made: `server-N` names in its
 * output (csm names them there) that were not there before, else what the
 * inventory has now that it did not have then.
 */
export function newServersOf(output: string | null, serversBefore: unknown, inventoryNow: string[]): string[] {
  const before = new Set(Array.isArray(serversBefore) ? serversBefore.filter((v): v is string => typeof v === 'string') : []);
  const named = [...new Set((output ?? '').match(/\bserver-[1-9][0-9]{0,3}\b/g) ?? [])].filter((n) => !before.has(n));
  if (named.length > 0) return named;
  return inventoryNow.filter((n) => !before.has(n));
}
