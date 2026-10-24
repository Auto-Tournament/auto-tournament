/**
 * The host channel's process-wide pieces (FLEET.md §18): the gateway on
 * `/api/fleet/host`, sending commands to a machine, the inventory ↔ Ready Up
 * join (§18.3) and the 90-day host token rotation. Started with the fleet
 * (../../startup.ts).
 */

import { licenseService } from '../../../../services/license/licenseService';
import { LicenseLimitError } from '../../../../services/license/gate';
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
import { pushHostChanged } from './adminPush';
import {
  claimableIndex,
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
import {
  bundleFor,
  pluginSetForCreate,
  validatePluginSet,
  type PluginSet,
} from '../push/pluginSets';
import { autoUpdateStatus, startAutoUpdates, stopAutoUpdates } from './autoUpdate';
import { syncLinkedAddress } from '../link';
import { getLicenseHandoff } from '../../services/updateHoldService';

/** The plugin set a server.create was stored with (meta.plugins), if any. */
function pluginSetOfMeta(meta: registry.HostCommandMeta | null): PluginSet | null {
  if (!meta?.plugins) return null;
  const check = validatePluginSet(meta.plugins);
  return check.ok ? check.value : null;
}

const ROTATION_CHECK_MS = 60 * 60 * 1000;
/** A command csm hasn't started (no answer, no progress) this long after it reached the machine fails. */
const COMMAND_NOT_STARTED_S = 3 * 60;
/** A command whose progress stopped this long ago fails (CS2 downloads report as they go). */
const COMMAND_STALLED_S = 15 * 60;
const QUIET_CHECK_MS = 30 * 1000;

const gateway = new HostGateway();
let inventoryListener: ((hostId: string, payload: HostInventoryPayload) => void) | null = null;
let rotationTimer: NodeJS.Timeout | null = null;
let quietTimer: NodeJS.Timeout | null = null;

gateway.onHostReady(async (hostId) => {
  const due = await registry.hostsDueForRotation();
  if (due.includes(hostId)) await rotateHostToken(hostId);
  await pushLicense(hostId, true);
});

// ---------------------------------------------------------------------------
// The license, to csm (host.license)
// ---------------------------------------------------------------------------

/** How often the license is looked at for a change to pass on (renewal lease, a new key, a stopped license). */
const LICENSE_PUSH_CHECK_MS = 60 * 1000;
let licenseTimer: NodeJS.Timeout | null = null;
/** The license revision each host was last sent, so an unchanged one isn't sent again. */
const licenseSent = new Map<string, string>();

/**
 * Sends the platform's license (key, lease, state: the hold poll's hand-off)
 * to a host that takes it (`license.push`): csm writes it into Ready Up on the
 * servers this platform owns there, and limits this platform's creates by it.
 * After every welcome, and whenever the revision changes.
 */
async function pushLicense(hostId: string, force = false): Promise<void> {
  const host = await registry.getHostView(hostId);
  if (!host || !host.capabilities.includes('license.push') || !isHostOnline(hostId)) return;
  const handoff = await getLicenseHandoff();
  if (!force && licenseSent.get(hostId) === handoff.revision) return;
  const state = handoff.state
    ? {
        status: handoff.state.status,
        ...(handoff.state.stops_on ? { stops_on: handoff.state.stops_on } : {}),
        ...(handoff.state.valid_until ? { valid_until: handoff.state.valid_until } : {}),
      }
    : undefined;
  try {
    await sendHostCommand(
      hostId,
      'host.license',
      {
        key: handoff.key,
        ...(handoff.lease ? { lease: handoff.lease } : {}),
        ...(state ? { state } : {}),
        ...(handoff.use ? { use: handoff.use } : {}),
        revision: handoff.revision,
      },
      { issuedBy: null }
    );
    licenseSent.set(hostId, handoff.revision);
  } catch (error) {
    log.warn(`[FLEET-HOST] ${hostId}: could not send the license: ${(error as Error).message}`);
  }
}

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
    readonly status: 400 | 402 | 404 | 409,
    readonly code: string,
    readonly details?: { servers: string[] }
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
    const use = raw ? (JSON.parse(raw) as { use?: string }).use : null;
    return use === 'noncommercial' || use === 'commercial' ? use : null;
  } catch {
    return null;
  }
}

/** The fields sendHostCommand reads or sets on a command's payload. */
interface CommandBody {
  expires_at?: number;
  server?: string;
  servers?: string[];
  count?: number;
  force?: HostForce;
  enroll_key?: string;
  accept_license?: 'noncommercial' | 'commercial';
}

export async function sendHostCommand<T extends HostCommandType>(
  hostId: string,
  type: T,
  payload: HostCommands[T],
  opts: {
    issuedBy: string | null;
    force?: { reason: string } | null;
    meta?: registry.HostCommandMeta;
  } = { issuedBy: null }
): Promise<SentHostCommand> {
  const host = await registry.getHost(hostId);
  if (!host || host.tenant_id !== FLEET_TENANT)
    throw new HostCommandError('Machine not found', 404, 'not_found');
  if (host.status !== 'enrolled')
    throw new HostCommandError('Only an enrolled machine takes commands', 409, 'not_enrolled');

  const body: CommandBody = { ...payload };
  delete body.force;
  // A paid license's server limit, before a machine is asked to create any.
  if (type === 'server.create' || type === 'server.enroll') {
    const count = type === 'server.enroll' ? (body.servers?.length ?? 1) : Number(body.count ?? 1);
    try {
      await licenseService.assertCanCreateServers(Number.isInteger(count) && count > 0 ? count : 1);
    } catch (error) {
      if (error instanceof LicenseLimitError)
        throw new HostCommandError(error.message, 402, error.code);
      throw error;
    }
  }
  // The fleet key is the platform's to add, at send time (./gateway.ts).
  if (type === 'server.create' || type === 'server.enroll') delete body.enroll_key;
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
    const busy = view
      .filter((s) => targets.includes(s.name) && s.matchInProgress)
      .map((s) => s.name);
    if (busy.length > 0 && !opts.force) {
      throw new HostCommandError(
        `A match is in progress on ${busy.join(', ')}; confirm with force to interrupt it`,
        409,
        'match_in_progress',
        { servers: busy }
      );
    }
    if (opts.force) {
      force = {
        by: (opts.issuedBy ?? 'unknown').slice(0, 128),
        reason: opts.force.reason.slice(0, 500),
      };
      body.force = force;
    }
  }

  const check = validateHostPayload(type, body);
  if (!check.ok)
    throw new HostCommandError(
      `Invalid ${type}: ${check.errors.join('; ')}`,
      400,
      'invalid_payload'
    );

  // server.create: remember which servers exist now, to find the new ones
  // for the Ready Up install that follows (csm decision 10), and the plugin
  // set they get once they enroll: the create's own, else the fleet default
  // (../push/pluginSets.ts).
  let meta: registry.HostCommandMeta | null = opts.meta ?? null;
  // server.remove: remember the Ready Up fleet server that lives in it, so
  // its fleet entry goes too once csm has removed the server.
  if (type === 'server.remove') {
    const target = (await hostServers(hostId)).find((sv) => sv.name === body.server);
    if (target?.fleetServer) meta = { ...(meta ?? {}), fleetServerId: target.fleetServer.id };
  }
  if (type === 'server.create') {
    const inventory = (await registry.getHostView(hostId))?.inventory;
    const own = meta?.plugins ? validatePluginSet(meta.plugins) : null;
    if (own && !own.ok)
      throw new HostCommandError(`Invalid plugins: ${own.error}`, 400, 'invalid_plugins');
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
    log.warn(
      `[FLEET-HOST] ${hostId}: ${type} forced by ${force.by} during a match (${force.reason})`
    );
  }
  await registry.appendHostOutbox(hostId, { id, type, payload: body });
  const session = gateway.session(hostId);
  const delivered = session ? await session.flushOutbox() : false;
  const command = await registry.getHostCommand(id);
  if (!command) throw new Error('fleet: host command vanished');
  // The Servers page shows the new command at once (it is pending now).
  pushHostChanged(hostId);
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
  if (record.type !== 'server.create' || record.status !== 'ok' || record.payload.enroll !== true)
    return;
  if (record.meta?.followUp) return;
  const inventory = (await registry.getHostView(hostId))?.inventory;
  const servers = newServersOf(
    record.output,
    record.meta?.serversBefore,
    inventory?.servers.map((s) => s.name) ?? []
  );
  if (servers.length === 0) {
    log.warn(
      `[FLEET-HOST] ${hostId}: server.create ${record.id} succeeded but named no new server; Ready Up not installed`
    );
    return;
  }
  const sent = await sendHostCommand(
    hostId,
    'host.update_plugins',
    {
      servers,
      readyup: { ...NEW_SERVER_READYUP, bundle: bundleFor(pluginSetOfMeta(record.meta)) },
    },
    { issuedBy: PLATFORM_ACTOR, meta: { followUpOf: record.id } }
  );
  await registry.mergeHostCommandMeta(record.id, {
    followUp: sent.command.id,
    newServers: servers,
  });
  log.info(
    `[FLEET-HOST] ${hostId}: installing Ready Up on ${servers.join(', ')} (after server.create ${record.id})`
  );
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
    log.warn(
      `[FLEET-HOST] ${hostId}: Ready Up install after server.create failed: ${(error as Error).message}`
    );
  });
  void cleanUpRemoved(hostId, record).catch((error) => {
    log.warn(
      `[FLEET-HOST] ${hostId}: removing the fleet entry after server.remove failed: ${(error as Error).message}`
    );
  });
});

// ---------------------------------------------------------------------------
// Commands csm refused `busy` (another job held the machine or the server)
// ---------------------------------------------------------------------------

/** How long a refused command waits when the machine finishes nothing meanwhile, and how often it is tried. */
export const BUSY_RETRY_MS = 30_000;
export const BUSY_RETRY_MAX = 20;

/** Whether a refused command is sent again (pure: tested on its own). */
export function retriesBusy(record: {
  status: string;
  errorCode: string | null;
  meta: registry.HostCommandMeta | null;
}): boolean {
  if (record.status !== 'rejected' || record.errorCode !== 'busy') return false;
  if (record.meta?.retriedAs) return false;
  return Number(record.meta?.busyRetries ?? 0) < BUSY_RETRY_MAX;
}

/** Refused commands waiting per machine, with their fallback timers. */
const busyWaiting = new Map<string, Map<string, NodeJS.Timeout>>();

/**
 * Send a refused command again as a new one (csm answers an id once), with
 * the same payload, actor and force, and remember the link both ways. The
 * refused row is then hidden from the Servers page (listHostViews).
 */
async function resendBusy(hostId: string, id: string): Promise<void> {
  const waiting = busyWaiting.get(hostId);
  const timer = waiting?.get(id);
  if (timer) clearTimeout(timer);
  waiting?.delete(id);
  const record = await registry.getHostCommand(id);
  if (!record || !retriesBusy(record)) return;
  const attempts = Number(record.meta?.busyRetries ?? 0) + 1;
  const payload = Object.fromEntries(Object.entries(record.payload).filter(([k]) => k !== 'force'));
  try {
    const sent = await sendHostCommand(hostId, record.type as HostCommandType, payload as never, {
      issuedBy: record.issuedBy,
      force: record.forcedBy ? { reason: record.forceReason ?? 'retried after busy' } : null,
      meta: { ...(record.meta ?? {}), retryOf: record.id, busyRetries: attempts },
    });
    await registry.mergeHostCommandMeta(record.id, { retriedAs: sent.command.id });
    log.info(
      `[FLEET-HOST] ${hostId}: ${record.type} was refused busy; sent again as ${sent.command.id} (try ${attempts})`
    );
  } catch (error) {
    log.warn(
      `[FLEET-HOST] ${hostId}: sending ${record.type} again after busy failed: ${(error as Error).message}`
    );
  }
}

hostEvents.on('result', (hostId: string, record: registry.HostCommandRecord) => {
  if (retriesBusy(record)) {
    // Wait for the job that holds the machine: its answer sends this one again,
    // and so does the timer when the machine answers nothing meanwhile.
    const waiting = busyWaiting.get(hostId) ?? new Map<string, NodeJS.Timeout>();
    busyWaiting.set(hostId, waiting);
    if (!waiting.has(record.id)) {
      const timer = setTimeout(() => void resendBusy(hostId, record.id), BUSY_RETRY_MS);
      timer.unref?.();
      waiting.set(record.id, timer);
    }
    return;
  }
  // Another job finished: whatever it held up goes now.
  for (const id of [...(busyWaiting.get(hostId)?.keys() ?? [])]) void resendBusy(hostId, id);
});

/** The answer to command `id`: resolves once it is not pending, or null after `timeoutMs`. */
export async function awaitHostResult(
  id: string,
  timeoutMs = 15_000
): Promise<registry.HostCommandRecord | null> {
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

/** What `hostId`'s inventory may join, given every machine's inventory (./join.ts). */
function claimsOf(
  hosts: registry.FleetHostView[],
  rows: FleetServerJoinRow[],
  hostId: string
): FleetServerIndex {
  const others = hosts
    .filter((h) => h.id !== hostId && h.status === 'enrolled')
    .map((h) => h.inventory?.servers ?? []);
  return claimableIndex(hostId, rows, others);
}

/** One machine's servers: csm's process view next to Ready Up's. */
export async function hostServers(hostId: string): Promise<HostServerView[]> {
  const hosts = await registry.listHosts();
  const host = hosts.find((h) => h.id === hostId);
  if (!host?.inventory) return [];
  const bus = fleetBus();
  return joinInventory(
    host.inventory.servers,
    claimsOf(hosts, await registry.fleetServerJoinRows(), hostId),
    (id) => bus.isConnected(id)
  );
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

/** How long after a create, an install or an enroll a machine's unenrolled servers are left alone. */
const ENROLL_QUIET_S = 15 * 60;

/**
 * A machine's servers with Ready Up that are not enrolled here (a machine
 * linked again, e.g. to a fresh install: their old credentials are refused)
 * get a new fleet key (`server.enroll`, csm with the servers.enroll
 * capability) and join the match pool on their first hello. Not while a
 * create, a Ready Up install or an enroll on that machine is under way (a
 * new server enrolls by itself).
 */
async function enrollStrayServers(hostId: string): Promise<void> {
  const host = await registry.getHostView(hostId);
  if (
    !host?.inventory ||
    host.status !== 'enrolled' ||
    !host.capabilities.includes('servers.enroll')
  )
    return;
  const stray = (await hostServers(hostId))
    .filter((s) => !!s.readyup.installed && !s.fleetServer)
    .map((s) => s.name);
  if (stray.length === 0) return;
  const recent = await db.queryOneAsync<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM cs2_fleet_host_commands
      WHERE host_id = ? AND type IN ('server.create', 'host.update_plugins', 'server.enroll') AND created_at > ?`,
    [hostId, Math.floor(Date.now() / 1000) - ENROLL_QUIET_S]
  );
  if (Number(recent?.n ?? 0) > 0) return;
  await sendHostCommand(hostId, 'server.enroll', { servers: stray }, { issuedBy: PLATFORM_ACTOR });
  log.info(`[FLEET-HOST] ${hostId}: ${stray.join(', ')} not enrolled here; sent server.enroll`);
}

export async function listHostViews(
  opts: { commands?: number; health?: number } = {}
): Promise<HostAdminView[]> {
  const hosts = await registry.listHosts();
  if (hosts.length === 0) return [];
  const rows = await registry.fleetServerJoinRows();
  const index = indexFleetServers(rows);
  const bus = fleetBus();
  const keyed = await db.queryAsync<{ host_id: string; id: string }>(
    `SELECT k.host_id, s.id FROM cs2_fleet_servers s JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
      WHERE s.tenant_id = ? AND k.host_id IS NOT NULL`,
    [FLEET_TENANT]
  );
  const out: HostAdminView[] = [];
  for (const host of hosts) {
    const servers = joinInventory(
      host.inventory?.servers ?? [],
      claimsOf(hosts, rows, host.id),
      (id) => bus.isConnected(id)
    );
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
      // A command sent again after a busy refusal is shown once, as the new one.
      commands: (await registry.listHostCommands(host.id, opts.commands ?? 10)).filter(
        (c) => !c.meta?.retriedAs
      ),
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
    inventoryListener = (hostId: string, payload: HostInventoryPayload) => {
      void enrollStrayServers(hostId).catch((error) =>
        log.warn(`[FLEET-HOST] ${hostId}: enrolling its servers: ${(error as Error).message}`)
      );
      for (const s of payload.servers) {
        const id = s.readyup.server_id;
        if (id)
          void syncLinkedAddress(id).catch((error) =>
            log.warn(`[FLEET-HOST] address sync for ${id}: ${(error as Error).message}`)
          );
      }
    };
    hostEvents.on('inventory', inventoryListener);
  }
  // csm commands nobody answers fail with a reason instead of waiting forever.
  if (!quietTimer) {
    quietTimer = setInterval(() => {
      void registry
        .timeOutQuietCommands({ notStartedS: COMMAND_NOT_STARTED_S, stalledS: COMMAND_STALLED_S })
        .then((records) => {
          for (const record of records) {
            log.warn(
              `[FLEET-HOST] ${record.hostId}: ${record.type} ${record.id} timed out: ${record.errorMessage}`
            );
            hostEvents.emit('result', record.hostId, record);
          }
        })
        .catch((error) =>
          log.warn(`[FLEET-HOST] command timeout check failed: ${(error as Error).message}`)
        );
    }, QUIET_CHECK_MS);
    quietTimer.unref?.();
  }
  if (!licenseTimer) {
    licenseTimer = setInterval(() => {
      void (async () => {
        for (const view of await listHostViews({ commands: 0, health: 0 })) {
          if (isHostOnline(view.id)) await pushLicense(view.id);
        }
      })().catch((error) =>
        log.warn(`[FLEET-HOST] license push check failed: ${(error as Error).message}`)
      );
    }, LICENSE_PUSH_CHECK_MS);
    licenseTimer.unref?.();
  }
  if (!rotationTimer) {
    rotationTimer = setInterval(() => {
      void rotateDue().catch((error) =>
        log.warn(`[FLEET-HOST] rotation check failed: ${(error as Error).message}`)
      );
    }, ROTATION_CHECK_MS);
    rotationTimer.unref?.();
  }
}

export function stopFleetHosts(): void {
  stopAutoUpdates();
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  if (quietTimer) clearInterval(quietTimer);
  quietTimer = null;
  if (licenseTimer) clearInterval(licenseTimer);
  licenseTimer = null;
  gateway.shutdown();
}
