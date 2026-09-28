/**
 * The host channel's process-wide pieces (FLEET.md §18): the gateway on
 * `/api/fleet/host`, sending commands to a machine, the inventory ↔ Ready Up
 * join (§18.3) and the 90-day host token rotation. Started with the fleet
 * (../../startup.ts).
 */

import type { Server as HttpServer } from 'http';
import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { getIO } from '../../../../services/socketService';
import { ulid } from '../credentials';
import { FLEET_TENANT } from '../registry';
import { fleetBus } from '../service';
import { FLEET_CLOSE } from '../protocol/v1';
import {
  HOST_DISRUPTIVE_TYPES,
  validateHostPayload,
  type HostCommandType,
  type HostCommands,
  type HostForce,
  type HostInventoryServer,
} from '../protocol/host/v1';
import { HostGateway, hostEvents } from './gateway';
import * as registry from './registry';

const ROTATION_CHECK_MS = 60 * 60 * 1000;

const gateway = new HostGateway();
let rotationTimer: NodeJS.Timeout | null = null;

gateway.onHostReady(async (hostId) => {
  const due = await registry.hostsDueForRotation();
  if (due.includes(hostId)) await rotateHostToken(hostId);
});

export { hostEvents };

export function isHostOnline(hostId: string): boolean {
  return gateway.session(hostId) !== null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export class HostCommandError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly code: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HostCommandError';
  }
}

export interface SentHostCommand {
  command: registry.HostCommandRecord;
  /** Written to the host's open socket now (else it goes when csm reconnects). */
  delivered: boolean;
}

/** The servers a command touches: its `server`, its `servers`, or every server on the host. */
export function commandTargets(
  type: HostCommandType,
  payload: Record<string, unknown>,
  inventory: HostInventoryServer[]
): string[] {
  if (typeof payload.server === 'string') return [payload.server];
  if (Array.isArray(payload.servers)) return payload.servers.filter((s): s is string => typeof s === 'string');
  if (type === 'host.update_game' || type === 'host.update_plugins') return inventory.map((s) => s.name);
  return [];
}

/**
 * Send a command to a machine (FLEET.md §18.2): schema check, the audit row
 * (`cs2_fleet_host_commands`, with `forced_by` for a forced disruptive
 * action) before the outbox row, then the socket when csm is online.
 *
 * Disruptive commands for a server with a match in progress (its inventory
 * says `update_safe: false`, or its Ready Up server is busy) are refused with
 * `match_in_progress` unless `force` is given. csm checks the same itself.
 */
export async function sendHostCommand<T extends HostCommandType>(
  hostId: string,
  type: T,
  payload: HostCommands[T],
  opts: { issuedBy: string | null; force?: { reason: string } | null } = { issuedBy: null }
): Promise<SentHostCommand> {
  const host = await registry.getHost(hostId);
  if (!host || host.tenant_id !== FLEET_TENANT) throw new HostCommandError('Machine not found', 404, 'not_found');
  if (host.status !== 'enrolled') throw new HostCommandError('Only an enrolled machine takes commands', 409, 'not_enrolled');

  const body: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete body.force;
  // The fleet key and URL are the platform's to add, at send time (./gateway.ts).
  if (type === 'server.create') delete body.fleet;

  let force: HostForce | null = null;
  if (HOST_DISRUPTIVE_TYPES.has(type)) {
    const view = await hostServers(hostId);
    const targets = commandTargets(type, body, view);
    const busy = view.filter((s) => targets.includes(s.name) && s.matchInProgress).map((s) => s.name);
    if (busy.length > 0 && !opts.force) {
      throw new HostCommandError(
        `A match is in progress on ${busy.join(', ')}; confirm with force to interrupt it`,
        409,
        'match_in_progress',
        { servers: busy }
      );
    }
    if (opts.force) {
      force = { by: (opts.issuedBy ?? 'unknown').slice(0, 128), reason: opts.force.reason.slice(0, 500) };
      body.force = force;
    }
  }

  const check = validateHostPayload(type, body);
  if (!check.ok) throw new HostCommandError(`Invalid ${type}: ${check.errors.join('; ')}`, 400, 'invalid_payload');

  const id = ulid();
  await registry.recordHostCommand({
    id,
    hostId,
    type,
    server: typeof body.server === 'string' ? body.server : null,
    payload: body,
    issuedBy: opts.issuedBy,
    forcedBy: force?.by ?? null,
    forceReason: force?.reason ?? null,
  });
  if (force) {
    log.warn(`[FLEET-HOST] ${hostId}: ${type} forced by ${force.by} during a match (${force.reason})`);
  }
  await registry.appendHostOutbox(hostId, { id, type, payload: body });
  const session = gateway.session(hostId);
  const delivered = session ? await session.flushOutbox() : false;
  const command = await registry.getHostCommand(id);
  if (!command) throw new Error('fleet: host command vanished');
  return { command, delivered };
}

/** The answer to command `id`: resolves once it is not pending, or null after `timeoutMs`. */
export async function awaitHostResult(id: string, timeoutMs = 15_000): Promise<registry.HostCommandRecord | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (record: registry.HostCommandRecord | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      hostEvents.off('result', onResult);
      resolve(record);
    };
    const onResult = (_hostId: string, record: registry.HostCommandRecord) => {
      if (record.id === id) finish(record);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    hostEvents.on('result', onResult);
    void registry
      .getHostCommand(id)
      .then((record) => {
        if (record && record.status !== 'pending') finish(record);
      })
      .catch(() => undefined);
  });
}

// ---------------------------------------------------------------------------
// Inventory ↔ Ready Up (FLEET.md §18.3)
// ---------------------------------------------------------------------------

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

interface FleetServerJoinRow {
  id: string;
  name: string;
  status: string;
  install_id: string | null;
  availability: string | null;
  versions: string | null;
}

async function fleetServerIndex(): Promise<{ byInstall: Map<string, FleetServerJoinRow>; byId: Map<string, FleetServerJoinRow> }> {
  const rows = await db.queryAsync<FleetServerJoinRow>(
    'SELECT id, name, status, install_id, availability, versions FROM cs2_fleet_servers WHERE tenant_id = ?',
    [FLEET_TENANT]
  );
  return {
    byInstall: new Map(rows.filter((r) => r.install_id).map((r) => [r.install_id as string, r])),
    byId: new Map(rows.map((r) => [r.id, r])),
  };
}

export function joinInventory(
  servers: HostInventoryServer[],
  index: { byInstall: Map<string, FleetServerJoinRow>; byId: Map<string, FleetServerJoinRow> },
  isOnline: (serverId: string) => boolean
): HostServerView[] {
  return servers.map((s) => {
    const row =
      (s.readyup.install_id ? index.byInstall.get(s.readyup.install_id) : undefined) ??
      (s.readyup.server_id ? index.byId.get(s.readyup.server_id) : undefined) ??
      null;
    let readyUpVersion: string | null = null;
    if (row?.versions) {
      try {
        readyUpVersion = (JSON.parse(row.versions) as { core?: string }).core ?? null;
      } catch {
        readyUpVersion = null;
      }
    }
    const fleetServer: HostFleetServerRef | null = row
      ? {
          id: row.id,
          name: row.name,
          status: row.status,
          online: isOnline(row.id),
          availability: row.availability,
          readyUpVersion,
        }
      : null;
    return {
      ...s,
      fleetServer,
      matchInProgress: s.readyup.update_safe === false || fleetServer?.availability === 'busy',
    };
  });
}

/** One machine's servers: csm's process view next to Ready Up's. */
export async function hostServers(hostId: string): Promise<HostServerView[]> {
  const host = await registry.getHostView(hostId);
  if (!host?.inventory) return [];
  const bus = fleetBus();
  return joinInventory(host.inventory.servers, await fleetServerIndex(), (id) => bus.isConnected(id));
}

export interface HostAdminView extends registry.FleetHostView {
  servers: HostServerView[];
  /** Ready Up servers enrolled with a key minted for this machine that its inventory does not list (yet). */
  enrolledServers: HostFleetServerRef[];
  commands: registry.HostCommandRecord[];
  health: registry.HostHealthRecord[];
}

export async function listHostViews(opts: { commands?: number; health?: number } = {}): Promise<HostAdminView[]> {
  const hosts = await registry.listHosts();
  if (hosts.length === 0) return [];
  const index = await fleetServerIndex();
  const bus = fleetBus();
  const keyed = await db.queryAsync<{ host_id: string; id: string }>(
    `SELECT k.host_id, s.id FROM cs2_fleet_servers s JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
      WHERE s.tenant_id = ? AND k.host_id IS NOT NULL`,
    [FLEET_TENANT]
  );
  const out: HostAdminView[] = [];
  for (const host of hosts) {
    const servers = joinInventory(host.inventory?.servers ?? [], index, (id) => bus.isConnected(id));
    const listed = new Set(servers.map((s) => s.fleetServer?.id).filter(Boolean));
    const enrolledServers = keyed
      .filter((k) => k.host_id === host.id && !listed.has(k.id))
      .map((k) => index.byId.get(k.id))
      .filter((r): r is FleetServerJoinRow => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        online: bus.isConnected(r.id),
        availability: r.availability,
        readyUpVersion: null,
      }));
    out.push({
      ...host,
      online: gateway.session(host.id) !== null,
      servers,
      enrolledServers,
      commands: await registry.listHostCommands(host.id, opts.commands ?? 10),
      health: await registry.listHealth(host.id, opts.health ?? 5),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Hand a machine a new host token over its live socket (FLEET.md §4.3, §18.1). */
export async function rotateHostToken(hostId: string): Promise<boolean> {
  const session = gateway.session(hostId);
  if (!session) return false;
  const started = await registry.beginHostRotation(hostId);
  if (!started) return false;
  if (started.alreadyPending) return true;
  await registry.appendHostOutbox(hostId, {
    type: 'auth.rotate',
    payload: { token_id: started.tokenId, old_valid_until: started.oldValidUntil },
  });
  await gateway.session(hostId)?.flushOutbox();
  log.info(`[FLEET-HOST] ${hostId}: token rotation sent`);
  return true;
}

/** Revoke a machine (tokens, codes, its server.create keys) and close its socket with 4403. */
export async function revokeHostAndDisconnect(hostId: string): Promise<boolean> {
  const revoked = await registry.revokeHost(hostId);
  if (revoked) gateway.close(hostId, FLEET_CLOSE.REVOKED, 'revoked by an admin');
  return revoked;
}

export function disconnectHost(hostId: string, reason: string): boolean {
  return gateway.close(hostId, FLEET_CLOSE.REVOKED, reason);
}

async function rotateDue(): Promise<void> {
  const due = new Set(await registry.hostsDueForRotation());
  for (const hostId of gateway.connectedHostIds()) {
    if (!due.has(hostId)) continue;
    await rotateHostToken(hostId).catch((error) => {
      log.warn(`[FLEET-HOST] ${hostId}: token rotation failed: ${(error as Error).message}`);
    });
  }
}

export async function startFleetHosts(server?: HttpServer): Promise<void> {
  const http = server ?? (getIO().httpServer as HttpServer | undefined);
  if (!http) {
    log.warn('[FLEET-HOST] no HTTP server to attach the host gateway to; csm cannot connect');
    return;
  }
  await registry.markAllHostsOffline();
  gateway.attach(http);
  if (!rotationTimer) {
    rotationTimer = setInterval(() => {
      void rotateDue().catch((error) => log.warn(`[FLEET-HOST] rotation check failed: ${(error as Error).message}`));
    }, ROTATION_CHECK_MS);
    rotationTimer.unref?.();
  }
}

export function stopFleetHosts(): void {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  gateway.shutdown();
}
