/**
 * The automatic scaler: every pass (FLEET_AUTOSCALE_INTERVAL_MS, 15 s) it
 * reads what the bracket needs and what the csm machines have, plans with
 * ./plan.ts, and sends csm `server.start` / `server.stop` / `server.create`
 * through the host channel (../hosts/service.ts, which also refuses a
 * disruptive command for a server with a match in progress). Servers a
 * scaler `server.create` made are linked to the match pool once their Ready
 * Up enrolls (../link.ts). Every action is written to
 * `cs2_fleet_autoscale_events` with its reason.
 *
 * Managed servers: csm inventory servers joined to a Ready Up server that is
 * linked to an enabled `cs2_servers` row. Nothing else is touched. Servers
 * are never removed.
 *
 * Licensing never blocks it: every Ready Up server it creates is linked (an
 * enabled server row) and so counts toward the license; going over the
 * license's server count only adds a warning to the create's reason.
 */

import { db } from '../../../../config/database';
import { log } from '../../../../utils/logger';
import { licenseService } from '../../../../services/license/licenseService';
import { serverAllocationTracker } from '../../services/serverAllocationTracker';
import { serverTurnoverTracker } from '../../utils/serverTurnover';
import { FLEET_TENANT } from '../registry';
import { fleetBus } from '../service';
import { linkFleetServer } from '../link';
import * as hostRegistry from '../hosts/registry';
import { HostCommandError, hostServers, isHostOnline, sendHostCommand } from '../hosts/service';
import { commandTargets } from '../hosts/join';
import type { HostCommandType } from '../protocol/host/v1';
import {
  computeDemand,
  estimateSecondsLeft,
  isWarm,
  planScaling,
  type Demand,
  type DemandMatch,
  type PlanInput,
  type ScalePlan,
  type ScalerAction,
  type ScalerHost,
  type ScalerServer,
} from './plan';
import { configuredReserve, getAutoscaleSettings, type StoredAutoscaleSettings } from './settings';

/** `issued_by` on the scaler's host commands. */
export const AUTOSCALE_ACTOR = 'autoscale';

const DEFAULT_INTERVAL_MS = 15_000;
/** Pending host commands older than this no longer count as in flight. */
const PENDING_WINDOW_S = 30 * 60;
/** A create whose server has not joined the pool after this is not waited for any more. */
const CREATE_WAIT_S = 15 * 60;
/** csm's inventory may lag a start / stop answered a moment ago. */
const RECENT_ACTION_S = 60;
const KEEP_EVENTS = 500;

const UPDATE_TYPES: ReadonlySet<string> = new Set([
  'host.update_game',
  'host.update_plugins',
  'server.restart',
  'server.set_launch_args',
]);

const nowS = () => Math.floor(Date.now() / 1000);

/** Unix s each managed server was first seen idle (in this process). */
const idleSince = new Map<string, number>();
const recentStarts = new Map<string, number>();
const recentStops = new Map<string, number>();
let lastNote: string | null = null;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface AutoscaleEvent {
  id: number;
  at: number;
  action: 'start' | 'stop' | 'create' | 'link' | 'note';
  hostId: string | null;
  hostName: string | null;
  server: string | null;
  fleetServerId: string | null;
  serverName: string | null;
  reason: string;
  commandId: string | null;
  outcome: 'sent' | 'linked' | 'refused' | 'failed' | 'note';
  error: string | null;
}

interface EventRow {
  id: number;
  at: number;
  action: AutoscaleEvent['action'];
  host_id: string | null;
  host_name: string | null;
  server: string | null;
  fleet_server_id: string | null;
  server_name: string | null;
  reason: string;
  command_id: string | null;
  outcome: AutoscaleEvent['outcome'];
  error: string | null;
}

async function recordEvent(e: Omit<AutoscaleEvent, 'id' | 'at'>): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_autoscale_events (at, action, host_id, host_name, server, fleet_server_id, server_name, reason, command_id, outcome, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nowS(),
      e.action,
      e.hostId,
      e.hostName,
      e.server,
      e.fleetServerId,
      e.serverName,
      e.reason.slice(0, 500),
      e.commandId,
      e.outcome,
      e.error ? e.error.slice(0, 500) : null,
    ]
  );
}

export async function listAutoscaleEvents(limit = 20): Promise<AutoscaleEvent[]> {
  const rows = await db.queryAsync<EventRow>(
    'SELECT * FROM cs2_fleet_autoscale_events ORDER BY id DESC LIMIT ?',
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: Number(r.at),
    action: r.action,
    hostId: r.host_id,
    hostName: r.host_name,
    server: r.server,
    fleetServerId: r.fleet_server_id,
    serverName: r.server_name,
    reason: r.reason,
    commandId: r.command_id,
    outcome: r.outcome,
    error: r.error,
  }));
}

async function trimEvents(): Promise<void> {
  await db.runAsync(
    `DELETE FROM cs2_fleet_autoscale_events WHERE id <= (
       SELECT id FROM cs2_fleet_autoscale_events ORDER BY id DESC OFFSET ? LIMIT 1)`,
    [KEEP_EVENTS]
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface MatchRow {
  id: number;
  slug: string;
  round: number;
  match_number: number;
  bracket: string | null;
  status: string;
  server_id: string | null;
  team1_id: string | null;
  team2_id: string | null;
  team1_from_match_id: number | null;
  team2_from_match_id: number | null;
  transport: string | null;
  tournament_id: number | null;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface StateLike {
  phase?: string;
  series?: {
    num_maps?: number;
    current_map?: number;
    score?: { team1?: number; team2?: number };
    maps?: Record<string, { score?: { team1?: number; team2?: number } }>;
  };
  rules?: { max_rounds?: number };
}

/** What the bracket needs now and within the lead time. */
export async function readDemand(leadTimeSeconds: number): Promise<Demand> {
  // Every tournament in progress (one row today).
  const active = await db.queryAsync<{ id: number }>(
    `SELECT id FROM tournament WHERE status = 'in_progress'`
  );
  const activeIds = new Set(active.map((t) => Number(t.id)));
  const rows = await db.queryAsync<MatchRow>(
    `SELECT m.id, m.slug, m.round, m.match_number, m.bracket, m.status, m.server_id, m.team1_id, m.team2_id,
            m.team1_from_match_id, m.team2_from_match_id, m.tournament_id, s.transport
       FROM matches m LEFT JOIN cs2_servers s ON s.id = m.server_id
      WHERE COALESCE(m.game, 'cs2') = 'cs2'
        AND (m.status IN ('pending', 'ready', 'loaded', 'live') OR (m.status = 'completed' AND m.round > 0))`
  );
  const runningSlugs = rows
    .filter((r) => r.status === 'loaded' || r.status === 'live')
    .map((r) => r.slug);
  const eta = new Map<string, number>();
  if (runningSlugs.length > 0) {
    const states = await db.queryAsync<{ match_slug: string; state: string | null }>(
      `SELECT match_slug, state FROM cs2_match_live_state WHERE match_slug IN (${runningSlugs.map(() => '?').join(', ')})`,
      runningSlugs
    );
    for (const row of states) {
      const s = parseJson<StateLike>(row.state);
      if (!s?.phase || !s.series) continue;
      const current = s.series.current_map ?? 1;
      const mapScore = s.series.maps?.[String(current)]?.score;
      eta.set(
        row.match_slug,
        estimateSecondsLeft({
          phase: s.phase,
          numMaps: s.series.num_maps ?? 1,
          currentMap: current,
          series: { team1: s.series.score?.team1 ?? 0, team2: s.series.score?.team2 ?? 0 },
          mapScore: mapScore ? { team1: mapScore.team1 ?? 0, team2: mapScore.team2 ?? 0 } : null,
          maxRounds: s.rules?.max_rounds ?? null,
        })
      );
    }
  }
  const matches: DemandMatch[] = rows
    .filter(
      (r) =>
        Number(r.round) <= 0 || (r.tournament_id !== null && activeIds.has(Number(r.tournament_id)))
    )
    .map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      round: Number(r.round),
      matchNumber: Number(r.match_number),
      bracket: r.bracket,
      status: r.status,
      serverId: r.server_id || null,
      onRcon: !!r.server_id && r.transport === 'rcon',
      team1Id: r.team1_id,
      team2Id: r.team2_id,
      team1FromMatchId: r.team1_from_match_id === null ? null : Number(r.team1_from_match_id),
      team2FromMatchId: r.team2_from_match_id === null ? null : Number(r.team2_from_match_id),
      secondsLeft: eta.get(r.slug) ?? null,
    }));
  return computeDemand(matches, { tournamentActive: true, leadTimeSeconds });
}

interface PendingCommandRow {
  host_id: string;
  type: string;
  server: string | null;
  payload: string;
}

async function failoverTargets(): Promise<Set<string>> {
  // cs2_fleet_failovers comes with failover (migration 013); absent before it.
  const exists = await db.queryOneAsync<{ t: string | null }>(
    `SELECT to_regclass('cs2_fleet_failovers')::text AS t`
  );
  if (!exists?.t) return new Set();
  const rows = await db.queryAsync<{ target_cs2_server_id: string | null }>(
    `SELECT target_cs2_server_id FROM cs2_fleet_failovers WHERE status IN ('open', 'moving')`
  );
  return new Set(rows.map((r) => r.target_cs2_server_id).filter((v): v is string => !!v));
}

/**
 * A server.create is running on a connected machine, or one of ours made a
 * server that is not in the pool yet (Ready Up still installing or
 * enrolling, not linked, or not in the machine's inventory yet).
 */
async function createInFlight(now: number, managed: ReadonlySet<string>): Promise<boolean> {
  const rows = await db.queryAsync<{
    message_id: string;
    host_id: string;
    status: string;
    fleet_server_id: string | null;
  }>(
    `SELECT c.message_id, c.host_id, c.status, s.id AS fleet_server_id FROM cs2_fleet_host_commands c
       LEFT JOIN cs2_fleet_enrollment_keys k ON k.command_id = c.message_id
       LEFT JOIN cs2_fleet_servers s ON s.enrollment_key_id = k.id
      WHERE c.type = 'server.create'
        AND ((c.status = 'pending' AND c.created_at > ?)
          OR (c.issued_by = ? AND c.status = 'ok' AND c.created_at > ?))`,
    [now - PENDING_WINDOW_S, AUTOSCALE_ACTOR, now - CREATE_WAIT_S]
  );
  const joined = new Map<string, boolean>();
  for (const r of rows) {
    if (r.status === 'pending') {
      if (isHostOnline(r.host_id)) return true;
      continue;
    }
    joined.set(
      r.message_id,
      (joined.get(r.message_id) ?? false) || (!!r.fleet_server_id && managed.has(r.fleet_server_id))
    );
  }
  return [...joined.values()].some((done) => !done);
}

export interface GatheredInputs {
  input: PlanInput;
  hostNames: Map<string, string>;
}

export async function gatherInputs(settings: StoredAutoscaleSettings): Promise<GatheredInputs> {
  const now = nowS();
  const bus = fleetBus();
  const [demand, reserveConfigured, targets] = await Promise.all([
    readDemand(settings.leadTimeSeconds),
    configuredReserve(),
    failoverTargets(),
  ]);

  const linkRows = await db.queryAsync<{ id: string; fleet_server_id: string }>(
    `SELECT id, fleet_server_id FROM cs2_servers WHERE transport = 'fleet' AND enabled = 1 AND fleet_server_id IS NOT NULL`
  );
  const links = new Map(linkRows.map((r) => [r.fleet_server_id, r.id]));
  const busyRows = await db.queryAsync<{ server_id: string }>(
    `SELECT DISTINCT server_id FROM matches
      WHERE server_id IS NOT NULL AND server_id <> '' AND status IN ('pending', 'ready', 'loaded', 'live')`
  );
  const busyCs2 = new Set(busyRows.map((r) => r.server_id));
  const assignedRows = await db.queryAsync<{ server_id: string }>(
    'SELECT DISTINCT server_id FROM cs2_fleet_assignments WHERE ended_at IS NULL AND server_id IS NOT NULL'
  );
  const assigned = new Set(assignedRows.map((r) => r.server_id));
  const pendingRows = await db.queryAsync<PendingCommandRow>(
    `SELECT host_id, type, server, payload FROM cs2_fleet_host_commands WHERE status = 'pending' AND created_at > ?`,
    [now - PENDING_WINDOW_S]
  );

  const hosts: ScalerHost[] = [];
  const hostNames = new Map<string, string>();
  const servers: ScalerServer[] = [];
  const seen = new Set<string>();
  for (const host of await hostRegistry.listHosts()) {
    if (host.status !== 'enrolled' || host.tenantId !== FLEET_TENANT) continue;
    hostNames.set(host.id, host.name);
    const inv = host.inventory;
    const online = isHostOnline(host.id);
    hosts.push({
      id: host.id,
      name: host.name,
      online,
      canCreate: host.capabilities.length === 0 || host.capabilities.includes('servers.create'),
      serverCount: inv?.servers.length ?? 0,
      ramFreeMb: inv?.resources.ram_free_mb ?? 0,
      diskFreeGb: Math.max(0, ...(inv?.resources.disk ?? []).map((d) => d.free_gb)),
    });
    if (!inv) continue;
    const views = await hostServers(host.id);
    const hostPending = pendingRows.filter((p) => p.host_id === host.id);
    for (const v of views) {
      const fid = v.fleetServer?.id;
      const cs2Id = fid ? links.get(fid) : undefined;
      if (!fid || !cs2Id || seen.has(fid)) continue;
      seen.add(fid);
      let pending: ScalerServer['pending'] = null;
      let updating = false;
      for (const p of hostPending) {
        const payload = parseJson<Record<string, unknown>>(p.payload) ?? {};
        const targetsIt = commandTargets(p.type as HostCommandType, payload, inv.servers).includes(
          v.name
        );
        if (!targetsIt) continue;
        if (p.type === 'server.start') pending = 'start';
        else if (p.type === 'server.stop') pending = 'stop';
        else if (UPDATE_TYPES.has(p.type)) updating = true;
      }
      const running = v.process.running;
      const startedRecently = (recentStarts.get(fid) ?? 0) > now - RECENT_ACTION_S;
      const stoppedRecently = (recentStops.get(fid) ?? 0) > now - RECENT_ACTION_S;
      if (!pending && startedRecently && !running) pending = 'start';
      if (!pending && stoppedRecently && running) pending = 'stop';
      const linkUp = bus.isConnected(fid);
      const busy =
        busyCs2.has(cs2Id) ||
        assigned.has(fid) ||
        serverAllocationTracker.isBusy(cs2Id) ||
        v.matchInProgress ||
        serverTurnoverTracker.evaluate(cs2Id, null, now).demoUploadPending;
      const idle =
        running && linkUp && v.fleetServer?.availability === 'available' && !busy && !updating;
      if (idle) {
        if (!idleSince.has(fid)) idleSince.set(fid, now);
      } else {
        idleSince.delete(fid);
      }
      servers.push({
        fleetServerId: fid,
        cs2ServerId: cs2Id,
        name: v.fleetServer?.name ?? v.name,
        hostId: host.id,
        hostServer: v.name,
        running,
        online: linkUp,
        startedAt: v.process.started_at ?? recentStarts.get(fid) ?? null,
        idle,
        busy,
        updating,
        failoverTarget: targets.has(cs2Id),
        pending,
        idleSince: idleSince.get(fid) ?? null,
      });
    }
  }
  for (const fid of [...idleSince.keys()]) if (!seen.has(fid)) idleSince.delete(fid);
  const inFlight = await createInFlight(now, seen);

  return {
    input: { now, settings, demand, reserveConfigured, servers, hosts, createInFlight: inFlight },
    hostNames,
  };
}

// ---------------------------------------------------------------------------
// Linking what the scaler created
// ---------------------------------------------------------------------------

/**
 * Ready Up servers that enrolled with the key of one of the scaler's
 * `server.create`s and are not linked: link them (once; an admin's unlink
 * later sticks).
 */
export async function linkCreatedServers(): Promise<number> {
  const rows = await db.queryAsync<{
    id: string;
    name: string;
    host_id: string | null;
    host_name: string | null;
  }>(
    `SELECT s.id, s.name, c.host_id, h.name AS host_name FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
       JOIN cs2_fleet_host_commands c ON c.message_id = k.command_id
       LEFT JOIN cs2_fleet_hosts h ON h.id = c.host_id
      WHERE s.tenant_id = ? AND s.status = 'enrolled' AND c.issued_by = ?
        AND NOT EXISTS (SELECT 1 FROM cs2_servers l WHERE l.fleet_server_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM cs2_fleet_autoscale_events e WHERE e.action = 'link' AND e.fleet_server_id = s.id)`,
    [FLEET_TENANT, AUTOSCALE_ACTOR]
  );
  let linked = 0;
  for (const row of rows) {
    const outcome = await linkFleetServer(row.id);
    await recordEvent({
      action: 'link',
      hostId: row.host_id,
      hostName: row.host_name,
      server: null,
      fleetServerId: row.id,
      serverName: row.name,
      reason: 'Created by the scaler; its Ready Up enrolled, so it joins the match pool',
      commandId: null,
      outcome: outcome.ok ? 'linked' : 'failed',
      error: outcome.ok ? null : outcome.error,
    });
    if (outcome.ok) {
      linked += 1;
      log.info(`[AUTOSCALE] linked new server ${row.name} (${row.id}) to the match pool`);
    }
  }
  return linked;
}

// ---------------------------------------------------------------------------
// A pass
// ---------------------------------------------------------------------------

export interface ActionOutcome {
  action: ScalerAction;
  outcome: 'sent' | 'refused' | 'failed';
  commandId: string | null;
  error: string | null;
}

export interface PassResult {
  plan: ScalePlan;
  demand: Demand;
  linked: number;
  outcomes: ActionOutcome[];
}

async function licenseNote(): Promise<string> {
  try {
    const status = await licenseService.getStatus();
    const max = status.license?.maxServers;
    const count = status.serverCount;
    if (max && count !== null && count + 1 > max) {
      return ` (license: this makes ${count + 1} servers of ${max}; a warning only)`;
    }
  } catch {
    /* never in the way */
  }
  return '';
}

async function execute(
  action: ScalerAction,
  hostName: string | null,
  now: number
): Promise<ActionOutcome> {
  let reason = action.reason;
  try {
    let commandId: string;
    if (action.kind === 'create') {
      reason += await licenseNote();
      const sent = await sendHostCommand(
        action.hostId,
        'server.create',
        { count: 1, enroll: true },
        { issuedBy: AUTOSCALE_ACTOR }
      );
      commandId = sent.command.id;
    } else {
      const sent = await sendHostCommand(
        action.hostId,
        action.kind === 'start' ? 'server.start' : 'server.stop',
        { server: action.server },
        {
          issuedBy: AUTOSCALE_ACTOR,
        }
      );
      commandId = sent.command.id;
      (action.kind === 'start' ? recentStarts : recentStops).set(action.fleetServerId, now);
      if (action.kind === 'stop') idleSince.delete(action.fleetServerId);
    }
    await recordEvent({
      action: action.kind,
      hostId: action.hostId,
      hostName,
      server: action.kind === 'create' ? null : action.server,
      fleetServerId: action.kind === 'create' ? null : action.fleetServerId,
      serverName: action.kind === 'create' ? null : action.name,
      reason,
      commandId,
      outcome: 'sent',
      error: null,
    });
    log.info(
      `[AUTOSCALE] ${action.kind}${action.kind === 'create' ? '' : ` ${action.server}`} on ${hostName ?? action.hostId}: ${reason}`
    );
    return { action, outcome: 'sent', commandId, error: null };
  } catch (error) {
    const refused = error instanceof HostCommandError;
    const message = (error as Error).message;
    await recordEvent({
      action: action.kind,
      hostId: action.hostId,
      hostName,
      server: action.kind === 'create' ? null : action.server,
      fleetServerId: action.kind === 'create' ? null : action.fleetServerId,
      serverName: action.kind === 'create' ? null : action.name,
      reason,
      commandId: null,
      outcome: refused ? 'refused' : 'failed',
      error: message,
    }).catch(() => undefined);
    log.warn(
      `[AUTOSCALE] ${action.kind} on ${hostName ?? action.hostId} ${refused ? 'refused' : 'failed'}: ${message}`
    );
    return { action, outcome: refused ? 'refused' : 'failed', commandId: null, error: message };
  }
}

let running: Promise<PassResult | null> | null = null;

/** One pass: link what our creates made, plan, act. Concurrent calls share the pass in progress. */
export function runScalerPass(): Promise<PassResult | null> {
  if (running) return running;
  running = (async () => {
    try {
      const settings = await getAutoscaleSettings();
      const linked = settings.enabled ? await linkCreatedServers() : 0;
      const { input, hostNames } = await gatherInputs(settings);
      const plan = planScaling(input);
      const outcomes: ActionOutcome[] = [];
      for (const action of plan.actions) {
        outcomes.push(await execute(action, hostNames.get(action.hostId) ?? null, input.now));
      }
      const note = settings.enabled ? plan.note : null;
      if (note && note !== lastNote) {
        await recordEvent({
          action: 'note',
          hostId: null,
          hostName: null,
          server: null,
          fleetServerId: null,
          serverName: null,
          reason: note,
          commandId: null,
          outcome: 'note',
          error: null,
        });
      }
      lastNote = note;
      if (outcomes.length > 0 || linked > 0) await trimEvents();
      return { plan, demand: input.demand, linked, outcomes };
    } finally {
      running = null;
    }
  })();
  return running;
}

// ---------------------------------------------------------------------------
// Status (the Servers page)
// ---------------------------------------------------------------------------

export type ScalerServerState =
  'busy' | 'idle' | 'starting' | 'stopping' | 'stopped' | 'updating' | 'unreachable';

export interface AutoscaleStatus {
  settings: StoredAutoscaleSettings;
  desired: number;
  warm: number;
  reserve: number;
  demand: Demand;
  note: string | null;
  /** Enrolled csm machines. */
  machines: number;
  planned: ScalerAction[];
  servers: Array<{
    fleetServerId: string;
    cs2ServerId: string;
    name: string;
    hostId: string;
    hostName: string | null;
    hostServer: string;
    state: ScalerServerState;
    idleSince: number | null;
  }>;
  activity: AutoscaleEvent[];
}

function stateOf(s: ScalerServer, now: number): ScalerServerState {
  if (s.updating) return 'updating';
  if (s.pending === 'start') return 'starting';
  if (s.pending === 'stop') return 'stopping';
  if (!s.running) return 'stopped';
  if (s.busy) return 'busy';
  if (s.idle) return 'idle';
  return isWarm(s, now) ? 'starting' : 'unreachable';
}

/** What the scaler sees and would do now (nothing is sent), and its recent activity. */
export async function autoscaleStatus(activityLimit = 20): Promise<AutoscaleStatus> {
  const settings = await getAutoscaleSettings();
  const { input, hostNames } = await gatherInputs(settings);
  const plan = planScaling(input);
  return {
    settings,
    desired: plan.desired,
    warm: plan.warm,
    reserve: plan.reserve,
    demand: input.demand,
    note: settings.enabled ? plan.note : null,
    machines: input.hosts.length,
    planned: plan.actions,
    servers: input.servers
      .map((s) => ({
        fleetServerId: s.fleetServerId,
        cs2ServerId: s.cs2ServerId,
        name: s.name,
        hostId: s.hostId,
        hostName: hostNames.get(s.hostId) ?? null,
        hostServer: s.hostServer,
        state: stateOf(s, input.now),
        idleSince: s.idleSince,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    activity: await listAutoscaleEvents(activityLimit),
  };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

/** FLEET_AUTOSCALE_INTERVAL_MS: how often a pass runs (default 15 s; 0 = no timer, passes only on request). */
export function autoscaleIntervalMs(): number {
  const raw = process.env.FLEET_AUTOSCALE_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_INTERVAL_MS;
}

export function startAutoscaler(): void {
  if (timer) return;
  const interval = autoscaleIntervalMs();
  if (interval === 0) {
    log.info('[AUTOSCALE] timer off (FLEET_AUTOSCALE_INTERVAL_MS=0); passes run only on request');
    return;
  }
  timer = setInterval(
    () => {
      void runScalerPass().catch((error) =>
        log.warn(`[AUTOSCALE] pass failed: ${(error as Error).message}`)
      );
    },
    Math.max(1000, interval)
  );
  timer.unref?.();
}

export function stopAutoscaler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
