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
import { settingsService } from '../../../../services/settingsService';
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
  type HostInventoryPayload,
} from '../protocol/host/v1';
import { HostGateway, hostEvents } from './gateway';
import {
  commandTargets,
  indexFleetServers,
  newServersOf,
  joinInventory,
  toServerRef,
  type FleetServerIndex,
  type FleetServerJoinRow,
  type HostFleetServerRef,
  type HostServerView,
} from './join';
import * as registry from './registry';
import { bundleFor, pluginSetForCreate, validatePluginSet, type PluginSet } from '../push/pluginSets';
import { autoUpdateStatus, startAutoUpdates, stopAutoUpdates } from './autoUpdate';
import { syncLinkedAddress } from '../link';

/** The plugin set a server.create was stored with (meta.plugins), if any. */
function pluginSetOfMeta(meta: Record<string, unknown> | null): PluginSet | null {
  if (!meta?.plugins) return null;
  const check = validatePluginSet(meta.plugins);
  return check.ok ? check.value : null;
}

const ROTATION_CHECK_MS = 60 * 60 * 1000;

const gateway = new HostGateway();
let inventoryListener: ((hostId: string, payload: HostInventoryPayload) => void) | null = null;
let rotationTimer: NodeJS.Timeout | null = null;

gateway.onHostReady(async (hostId) => {
  const due = await registry.hostsDueForRotation();
  if (due.includes(hostId)) await rotateHostToken(hostId);
});

export { hostEvents, commandTargets, joinInventory };
export type { HostFleetServerRef, HostServerView };

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

/**
 * Send a command to a machine (FLEET.md §18.2): schema check, the audit row
 * (`cs2_fleet_host_commands`, with `forced_by` for a forced disruptive
 * action) before the outbox row, then the socket when csm is online.
 *
 * Disruptive commands for a server with a match in progress (its inventory
 * says `update_safe: false`, or its Ready Up server is busy) are refused with
 * `match_in_progress` unless `force` is given. csm checks the same itself.
 */
/**
 * The license use the admin accepted under Settings > License, or null.
 * Read from the stored record (core's `license_consent` setting) since the
 * module reaches core only through its bridge.
 */
async function acceptedLicenseUse(): Promise<'noncommercial' | 'commercial' | null> {
  try {
    const raw = await settingsService.getSetting('license_consent');
    const use = raw ? (JSON.parse(raw) as { use?: unknown }).use : null;
    return use === 'noncommercial' || use === 'commercial' ? use : null;
  } catch {
    return null;
  }
}

export async function sendHostCommand<T extends HostCommandType>(
  hostId: string,
  type: T,
  payload: HostCommands[T],
  opts: { issuedBy: string | null; force?: { reason: string } | null; meta?: Record<string, unknown> } = { issuedBy: null }
): Promise<SentHostCommand> {
  const host = await registry.getHost(hostId);
  if (!host || host.tenant_id !== FLEET_TENANT) throw new HostCommandError('Machine not found', 404, 'not_found');
  if (host.status !== 'enrolled') throw new HostCommandError('Only an enrolled machine takes commands', 409, 'not_enrolled');

  const body: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete body.force;
  // The fleet key is the platform's to add, at send time (./gateway.ts).
  if (type === 'server.create') delete body.enroll_key;
  // Installs carry the license use the admin accepted on the platform, so
  // csm can run Ready Up's installer unattended on a host whose operator
  // gave no answer of their own (theirs always wins on the host).
  if (type === 'server.create' || type === 'host.update_plugins') {
    const use = await acceptedLicenseUse();
    if (use) body.accept_license = use;
  }

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

  // server.create: remember which servers exist now, to find the new ones
  // for the Ready Up install that follows (csm decision 10), and the plugin
  // set they get once they enroll: the create's own, else the fleet default
  // (../push/pluginSets.ts).
  let meta: Record<string, unknown> | null = opts.meta ?? null;
  // server.remove: remember the Ready Up fleet server that lives in it, so
  // its fleet entry goes too once csm has removed the server.
  if (type === 'server.remove') {
    const inventory = (await registry.getHostView(hostId))?.inventory;
    const target = inventory?.servers.find((sv) => sv.name === body.server) as
      | { readyup?: { server_id?: string } }
      | undefined;
    if (target?.readyup?.server_id) meta = { ...(meta ?? {}), fleetServerId: target.readyup.server_id };
  }
  if (type === 'server.create') {
    const inventory = (await registry.getHostView(hostId))?.inventory;
    const own = meta?.plugins ? validatePluginSet(meta.plugins) : null;
    if (own && !own.ok) throw new HostCommandError(`Invalid plugins: ${own.error}`, 400, 'invalid_plugins');
    const plugins = await pluginSetForCreate(own?.ok ? own.value : null);
    meta = { ...(meta ?? {}), serversBefore: inventory?.servers.map((s) => s.name) ?? [] };
    if (plugins) meta.plugins = plugins;
    else delete meta.plugins;
  }

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
    meta,
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

/** Who the platform's own follow-up commands are issued by. */
export const PLATFORM_ACTOR = 'platform';

/**
 * The Ready Up bundle new servers get (csm decision 12: default = install.sh
 * essentials). A create whose plugin set needs more gets `skins` (full):
 * ../push/pluginSets.ts bundleFor.
 */
export const NEW_SERVER_READYUP = { version: 'latest', bundle: 'default' } as const;

/**
 * csm creates servers as copies of its master install, which has no Ready Up
 * (csm decision 10), so an enrolling `server.create` that succeeded is
 * followed by `host.update_plugins` for the new servers. They then start,
 * self-enroll with the command's key and appear under the machine.
 */
async function followUpCreate(hostId: string, record: registry.HostCommandRecord): Promise<void> {
  if (record.type !== 'server.create' || record.status !== 'ok' || record.payload.enroll !== true) return;
  if (record.meta?.followUp) return;
  const inventory = (await registry.getHostView(hostId))?.inventory;
  const servers = newServersOf(record.output, record.meta?.serversBefore, inventory?.servers.map((s) => s.name) ?? []);
  if (servers.length === 0) {
    log.warn(`[FLEET-HOST] ${hostId}: server.create ${record.id} succeeded but named no new server; Ready Up not installed`);
    return;
  }
  const sent = await sendHostCommand(
    hostId,
    'host.update_plugins',
    { servers, readyup: { ...NEW_SERVER_READYUP, bundle: bundleFor(pluginSetOfMeta(record.meta)) } },
    { issuedBy: PLATFORM_ACTOR, meta: { followUpOf: record.id } }
  );
  await registry.mergeHostCommandMeta(record.id, { followUp: sent.command.id, newServers: servers });
  log.info(`[FLEET-HOST] ${hostId}: installing Ready Up on ${servers.join(', ')} (after server.create ${record.id})`);
}

/**
 * A server csm removed (`server.remove` ok): its Ready Up fleet entry goes
 * too (unlinked from the match pool, disconnected, deleted), so it does not
 * linger as an offline server.
 */
async function cleanUpRemoved(hostId: string, record: registry.HostCommandRecord): Promise<void> {
  if (record.type !== 'server.remove' || record.status !== 'ok') return;
  const fleetServerId = record.meta?.fleetServerId;
  if (typeof fleetServerId !== 'string') return;
  const { unlinkFleetServer } = await import('../link');
  const { deleteFleetServer } = await import('../registry');
  await unlinkFleetServer(fleetServerId).catch(() => null);
  fleetBus().disconnect(fleetServerId, FLEET_CLOSE.REVOKED, 'removed with its csm server');
  await deleteFleetServer(fleetServerId);
  log.info(`[FLEET-HOST] ${hostId}: fleet server ${fleetServerId} removed with its csm server`);
}

hostEvents.on('result', (hostId: string, record: registry.HostCommandRecord) => {
  void followUpCreate(hostId, record).catch((error) => {
    log.warn(`[FLEET-HOST] ${hostId}: Ready Up install after server.create failed: ${(error as Error).message}`);
  });
  void cleanUpRemoved(hostId, record).catch((error) => {
    log.warn(`[FLEET-HOST] ${hostId}: removing the fleet entry after server.remove failed: ${(error as Error).message}`);
  });
});

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

async function fleetServerIndex(): Promise<FleetServerIndex> {
  const rows = await db.queryAsync<FleetServerJoinRow>(
    'SELECT id, name, status, install_id, availability, versions FROM cs2_fleet_servers WHERE tenant_id = ?',
    [FLEET_TENANT]
  );
  return indexFleetServers(rows);
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
  /** What the platform's automatic updates are doing on this machine (./autoUpdate.ts), once it has looked. */
  autoUpdate: { at: number; game: string; readyUp: string } | null;
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
      .map((r) => toServerRef(r, bus.isConnected(r.id)));
    out.push({
      ...host,
      online: gateway.session(host.id) !== null,
      servers,
      autoUpdate: autoUpdateStatus(host.id),
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
  // The platform starts CS2 and Ready Up updates on enrolled machines (./autoUpdate.ts).
  startAutoUpdates();
  // A machine's address (inventory.address) is where its servers' players
  // connect unless a server reports its own: move their linked rows to it.
  if (!inventoryListener) {
    inventoryListener = (_hostId: string, payload: HostInventoryPayload) => {
      for (const s of payload.servers) {
        const id = s.readyup.server_id;
        if (id) void syncLinkedAddress(id).catch((error) => log.warn(`[FLEET-HOST] address sync for ${id}: ${(error as Error).message}`));
      }
    };
    hostEvents.on('inventory', inventoryListener);
  }
  if (!rotationTimer) {
    rotationTimer = setInterval(() => {
      void rotateDue().catch((error) => log.warn(`[FLEET-HOST] rotation check failed: ${(error as Error).message}`));
    }, ROTATION_CHECK_MS);
    rotationTimer.unref?.();
  }
}

export function stopFleetHosts(): void {
  stopAutoUpdates();
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  gateway.shutdown();
}
