/**
 * The platform drives CS2 and Ready Up updates on enrolled machines.
 *
 * csm 1.20+ leaves starting updates to us on a host whose agent is enrolled;
 * its monitor then only restarts idle servers onto what is installed. Every
 * few minutes, for each online machine:
 *
 * - CS2: Steam's UpToDateCheck with the patch the machine runs
 *   (`inventory.cs2.master_patch`), or csm's own "update available" marker
 *   from a server log (older csm). Behind → `host.update_game`.
 * - Ready Up: the newest release on the servers' channel against what each
 *   server last reported. Behind → `host.update_plugins` with that version.
 *
 * Which servers a command names follows the update rules decided on
 * 2026-09-22: a server with a match in progress is never named; while a
 * tournament is running (hold `auto`) only stopped servers are; `on` pauses
 * all of it, `off` ignores the tournament. On an instance host csm downloads
 * and builds either way and restarts only idle instances, so a stopped server
 * is all it takes for the update to land.
 *
 * The same command is not sent again while one is in flight, nor for the same
 * target within a cooldown (a stopped server reports its old version until it
 * starts, so without one the platform would resend every cycle).
 */

import { log } from '../../../../utils/logger';
import { resolveTournamentId } from '../../../../utils/tournamentRow';
import { cs2UpdateService } from '../../services/cs2UpdateService';
import { getLatestReadyUpRelease } from '../../services/pluginVersionService';
import { compareVersions, parseVersion } from '../../services/readyUpVersion';
import { getUpdateHoldStatus } from '../../services/updateHoldService';
import { bundleFor, pluginSetFromStored, type StoredPlugins } from '../push/pluginSets';
import { db } from '../../../../config/database';
import * as registry from './registry';
import { hostServers, PLATFORM_ACTOR, sendHostCommand, type HostCommandError } from './service';

const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;
/** After a command of a type was answered, how long before the same target is sent again. */
const COOLDOWN_S = { game: 6 * 3600, plugins: 6 * 3600 } as const;
/** After a failure, sooner. */
const RETRY_S = 30 * 60;

export type HoldMode = 'on' | 'off' | 'auto';

export interface PlannerServer {
  name: string;
  running: boolean;
  matchInProgress: boolean;
  /** Ready Up core version the server last reported, or null. */
  readyUp: string | null;
}

export interface PlannerInput {
  holdMode: HoldMode;
  /** The tournament hold (updateHoldService): a tournament is running. */
  tournamentHold: { hold: boolean; reason: string };
  servers: PlannerServer[];
  /** CS2 is behind: Steam says the machine's patch is old, or a server printed csm's marker. */
  cs2Behind: { behind: boolean; detail: string };
  /** The Ready Up release to be on, or null when unknown. */
  readyUpTarget: string | null;
  /** Commands of each type in flight, and the last answered one (with its target and outcome). */
  recent: {
    game: { inFlight: boolean; lastAt: number | null; lastOk: boolean; lastTarget: string | null };
    plugins: { inFlight: boolean; lastAt: number | null; lastOk: boolean; lastTarget: string | null };
  };
  /** The CS2 target to compare cooldowns on (Steam's required version, or the marker). */
  cs2Target: string;
  now: number;
}

export interface PlannedCommand {
  servers: string[];
  reason: string;
}

export interface UpdatePlan {
  game: PlannedCommand | null;
  plugins: (PlannedCommand & { version: string }) | null;
  /** One line per kind for the admin page: what is happening or why it waits. */
  status: { game: string; readyUp: string };
}

/** The servers an update may name right now. */
function eligible(input: PlannerInput): PlannerServer[] {
  const tournament = input.holdMode === 'auto' && input.tournamentHold.hold;
  return input.servers.filter((s) => !s.matchInProgress && (!tournament || !s.running));
}

function coolingDown(r: PlannerInput['recent']['game'], target: string, cooldown: number, now: number): boolean {
  if (r.lastAt === null || r.lastTarget !== target) return false;
  return now - r.lastAt < (r.lastOk ? cooldown : RETRY_S);
}

/** What to send to one machine. Pure. */
export function planHostUpdates(input: PlannerInput): UpdatePlan {
  const plan: UpdatePlan = { game: null, plugins: null, status: { game: '', readyUp: '' } };
  if (input.holdMode === 'on') {
    plan.status.game = plan.status.readyUp = 'Paused on this machine (Automatic updates: held).';
    return plan;
  }
  const targets = eligible(input);
  const waitReason = () =>
    input.holdMode === 'auto' && input.tournamentHold.hold
      ? `waiting: ${input.tournamentHold.reason} Running servers update after it; none are stopped.`
      : 'waiting: every server has a match in progress.';

  // CS2
  if (!input.cs2Behind.behind) {
    plan.status.game = input.cs2Behind.detail || 'Up to date.';
  } else if (input.recent.game.inFlight) {
    plan.status.game = `${input.cs2Behind.detail} Updating now.`;
  } else if (coolingDown(input.recent.game, input.cs2Target, COOLDOWN_S.game, input.now)) {
    plan.status.game = `${input.cs2Behind.detail} Sent ${input.recent.game.lastOk ? 'already' : 'and failed'}; ` +
      'servers pick it up as they restart.';
  } else if (targets.length === 0) {
    plan.status.game = `${input.cs2Behind.detail} ${waitReason()}`;
  } else {
    plan.game = { servers: targets.map((s) => s.name), reason: input.cs2Behind.detail };
    plan.status.game = `${input.cs2Behind.detail} Updating now.`;
  }

  // Ready Up
  const target = input.readyUpTarget;
  const behind = target
    ? input.servers.filter((s) => s.readyUp && parseVersion(s.readyUp) && (compareVersions(s.readyUp, target) ?? 0) < 0)
    : [];
  if (!target) {
    plan.status.readyUp = 'Latest release unknown (GitHub not reachable).';
  } else if (behind.length === 0) {
    plan.status.readyUp = `Up to date (${target}).`;
  } else if (input.recent.plugins.inFlight) {
    plan.status.readyUp = `Updating to ${target}.`;
  } else if (coolingDown(input.recent.plugins, target, COOLDOWN_S.plugins, input.now)) {
    plan.status.readyUp = input.recent.plugins.lastOk
      ? `${target} installed; ${behind.map((s) => s.name).join(', ')} pick it up when they next start.`
      : `Updating to ${target} failed; trying again soon.`;
  } else {
    const names = new Set(targets.map((s) => s.name));
    const ready = behind.filter((s) => names.has(s.name));
    if (ready.length === 0) {
      plan.status.readyUp = `${target} available; ${waitReason()}`;
    } else {
      plan.plugins = { servers: ready.map((s) => s.name), version: target, reason: `Ready Up ${target}` };
      plan.status.readyUp = `Updating to ${target}.`;
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** The last plan per machine, for the admin page. */
const lastStatus = new Map<string, { at: number; game: string; readyUp: string }>();

export function autoUpdateStatus(hostId: string): { at: number; game: string; readyUp: string } | null {
  return lastStatus.get(hostId) ?? null;
}

function recentOf(commands: registry.HostCommandRecord[], type: string, targetOf: (c: registry.HostCommandRecord) => string | null) {
  const own = commands.filter((c) => c.type === type);
  const inFlight = own.some((c) => c.status === 'pending');
  const last = own.find((c) => c.status !== 'pending') ?? null;
  return {
    inFlight,
    lastAt: last ? (last.answeredAt ?? last.createdAt) : null,
    lastOk: last?.status === 'ok',
    lastTarget: last ? targetOf(last) : null,
  };
}

async function hostBundle(fleetServerIds: string[]): Promise<'default' | 'skins'> {
  if (fleetServerIds.length === 0) return 'default';
  const rows = await db.queryAsync<{ plugins: string | null }>(
    `SELECT plugins FROM cs2_fleet_server_prefs WHERE server_id IN (${fleetServerIds.map(() => '?').join(', ')})`,
    fleetServerIds
  );
  for (const row of rows) {
    try {
      if (row.plugins && bundleFor(pluginSetFromStored(JSON.parse(row.plugins) as StoredPlugins)) === 'skins') {
        return 'skins';
      }
    } catch {
      // A stored set that does not parse counts as the default.
    }
  }
  return 'default';
}

async function cs2BehindFor(inventory: NonNullable<registry.FleetHostView['inventory']>): Promise<{
  behind: { behind: boolean; detail: string };
  target: string;
}> {
  const patch = inventory.cs2.master_patch;
  if (patch) {
    try {
      const check = await cs2UpdateService.upToDateCheck(patch);
      if (!check.upToDate) {
        const required = check.requiredVersion ? String(check.requiredVersion) : 'newer';
        return { behind: { behind: true, detail: `CS2 ${patch} is behind (Steam requires ${required}).` }, target: required };
      }
      return { behind: { behind: false, detail: `CS2 ${patch} is up to date.` }, target: patch };
    } catch (error) {
      log.warn(`[FLEET-UPDATES] Steam UpToDateCheck failed: ${(error as Error).message}`);
    }
  }
  if (inventory.cs2.update_available) {
    return { behind: { behind: true, detail: 'A server reported a CS2 update.' }, target: `marker:${inventory.cs2.master_build}` };
  }
  return {
    behind: { behind: false, detail: patch ? `CS2 ${patch}.` : 'No CS2 update reported (csm before 1.20 reports none until a server runs).' },
    target: '',
  };
}

async function tickHost(host: registry.FleetHostView, tournamentHold: { hold: boolean; reason: string }): Promise<void> {
  const inventory = host.inventory;
  if (!inventory) return;
  const view = await hostServers(host.id);
  const servers: PlannerServer[] = view.map((s) => {
    const installed = s.readyup.installed && parseVersion(s.readyup.installed) ? s.readyup.installed : null;
    return {
      name: s.name,
      running: s.process.running,
      matchInProgress: s.matchInProgress,
      readyUp: installed ?? s.fleetServer?.readyUpVersion ?? null,
    };
  });
  const newest = servers.map((s) => s.readyUp).filter((v): v is string => !!v).sort((a, b) => compareVersions(b, a) ?? 0)[0];
  const release = await getLatestReadyUpRelease({ runningVersion: newest ?? null }).catch(() => null);
  const { behind, target } = await cs2BehindFor(inventory);
  const commands = await registry.listHostCommands(host.id, 50);
  const plan = planHostUpdates({
    holdMode: inventory.cs2.updates_hold,
    tournamentHold,
    servers,
    cs2Behind: behind,
    cs2Target: target,
    readyUpTarget: release?.version ?? null,
    recent: {
      game: recentOf(commands, 'host.update_game', (c) => (c.meta?.target as string | undefined) ?? null),
      plugins: recentOf(commands, 'host.update_plugins', (c) => {
        const ru = c.payload.readyup as { version?: string } | undefined;
        return ru?.version ?? null;
      }),
    },
    now: Math.floor(Date.now() / 1000),
  });
  lastStatus.set(host.id, { at: Date.now(), ...plan.status });

  const send = async (type: 'host.update_game' | 'host.update_plugins', payload: Record<string, unknown>, meta: Record<string, unknown>) => {
    try {
      await sendHostCommand(host.id, type, payload as never, { issuedBy: PLATFORM_ACTOR, meta: { auto: true, ...meta } });
      log.info(`[FLEET-UPDATES] ${host.name}: ${type} (${String(meta.reason)}) on ${String((payload.servers as string[]).join(', '))}`);
    } catch (error) {
      log.warn(`[FLEET-UPDATES] ${host.name}: ${type} not sent: ${(error as HostCommandError).message}`);
    }
  };
  if (plan.game) {
    await send('host.update_game', { servers: plan.game.servers }, { reason: plan.game.reason, target });
  }
  if (plan.plugins) {
    const ids = view.map((s) => s.fleetServer?.id).filter((id): id is string => !!id);
    const bundle = await hostBundle(ids);
    await send(
      'host.update_plugins',
      { servers: plan.plugins.servers, readyup: { version: plan.plugins.version, bundle } },
      { reason: plan.plugins.reason }
    );
  }
}

let running = false;

/** One pass over every online, enrolled machine. Never throws. */
export async function runAutoUpdates(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const hosts = (await registry.listHosts()).filter((h) => h.status === 'enrolled' && h.online && h.inventory);
    if (hosts.length === 0) return;
    const hold = await getUpdateHoldStatus(resolveTournamentId()).catch(() => ({ hold: true, reason: 'the tournament state could not be read.' }));
    for (const host of hosts) {
      await tickHost(host, { hold: hold.hold, reason: hold.reason }).catch((error) =>
        log.warn(`[FLEET-UPDATES] ${host.name}: ${(error as Error).message}`)
      );
    }
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
let first: NodeJS.Timeout | null = null;

export function startAutoUpdates(): void {
  if (timer) return;
  first = setTimeout(() => void runAutoUpdates(), FIRST_TICK_MS);
  timer = setInterval(() => void runAutoUpdates(), TICK_MS);
  first.unref?.();
  timer.unref?.();
}

export function stopAutoUpdates(): void {
  if (first) clearTimeout(first);
  if (timer) clearInterval(timer);
  first = timer = null;
}
