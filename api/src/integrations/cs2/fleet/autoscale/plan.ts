/**
 * Automatic server scaling, the pure part (no database, no sockets): how
 * many Ready Up servers a tournament needs warm right now, and what to do
 * about the difference (start a stopped server, stop an idle one, ask csm for
 * a new one). ./scaler.ts gathers the inputs and carries the actions out;
 * tests import this file directly.
 *
 * Servers are never deleted between matches: a server is warm (running,
 * idle or busy) or cold (stopped). The scaler only starts, stops and, when
 * the pool is short and a machine has room, creates.
 */

import { compareQueueOrder, withoutBusyTeams } from '../../../../core/allocationQueue';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AutoscaleSettings {
  /** On unless an admin turns it off (automatic by default). */
  enabled: boolean;
  /** Start servers this long before a match is expected to need one. */
  leadTimeSeconds: number;
  /** Stop a surplus server only after it has been idle this long. */
  cooldownSeconds: number;
  /** Never ask csm for a new server on a machine that already has this many. */
  maxServersPerHost: number;
}

export const DEFAULT_AUTOSCALE_SETTINGS: Readonly<AutoscaleSettings> = Object.freeze({
  enabled: true,
  leadTimeSeconds: 120,
  cooldownSeconds: 600,
  maxServersPerHost: 4,
});

export const AUTOSCALE_LIMITS = {
  leadTimeSeconds: { min: 0, max: 3600 },
  cooldownSeconds: { min: 0, max: 86_400 },
  maxServersPerHost: { min: 1, max: 64 },
} as const;

type NumericSetting = keyof typeof AUTOSCALE_LIMITS;

function inRange(key: NumericSetting, value: unknown): value is number {
  const { min, max } = AUTOSCALE_LIMITS[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Stored JSON → settings; anything missing or out of range is the default. */
export function normalizeAutoscaleSettings(raw: unknown): AutoscaleSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = (key: NumericSetting) =>
    inRange(key, o[key]) ? (o[key] as number) : DEFAULT_AUTOSCALE_SETTINGS[key];
  return {
    enabled: o.enabled !== false,
    leadTimeSeconds: pick('leadTimeSeconds'),
    cooldownSeconds: pick('cooldownSeconds'),
    maxServersPerHost: pick('maxServersPerHost'),
  };
}

/** An admin's patch: only known keys, each in range. */
export function validateAutoscalePatch(
  patch: unknown
): { ok: true; patch: Partial<AutoscaleSettings> } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    return { ok: false, error: 'Body must be an object' };
  const out: Partial<AutoscaleSettings> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
      out.enabled = value;
    } else if (key in AUTOSCALE_LIMITS) {
      const k = key as NumericSetting;
      if (!inRange(k, value)) {
        const { min, max } = AUTOSCALE_LIMITS[k];
        return { ok: false, error: `${k} must be a whole number from ${min} to ${max}` };
      }
      out[k] = value;
    } else {
      return { ok: false, error: `Unknown setting: ${key}` };
    }
  }
  return { ok: true, patch: out };
}

/**
 * The failover reserve the scaler keeps warm on top of the matches: the
 * admin's number (failover settings), else 1 once the pool has two servers.
 * Never the whole pool. Same rule as failover's `effectiveReserve`, over the
 * whole managed pool (warm and cold) so the scaler can reach it.
 */
export function scalerReserve(configured: number | null, poolSize: number): number {
  const wanted = configured ?? (poolSize >= 2 ? 1 : 0);
  return Math.max(0, Math.min(Math.floor(wanted), poolSize - 1));
}

/** Which idle servers failover holds (the last `count` by name, as failover picks them). */
export function reservedIdle<T extends { id: string; name: string }>(
  idle: readonly T[],
  count: number
): Set<string> {
  if (count <= 0) return new Set();
  const sorted = [...idle].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return new Set(sorted.slice(Math.max(0, sorted.length - count)).map((s) => s.id));
}

// ---------------------------------------------------------------------------
// When does a running match end?
// ---------------------------------------------------------------------------

/** A round with freeze time and the round-end delay, roughly. */
export const ROUND_SECONDS = 105;
/** Warmup, knife and side pick before a map goes live, roughly. */
export const MAP_SETUP_SECONDS = 240;

export interface EtaInput {
  phase: string;
  numMaps: number;
  /** 1-based. */
  currentMap: number;
  series: { team1: number; team2: number };
  /** The current map's score; null before it has one. */
  mapScore: { team1: number; team2: number } | null;
  maxRounds: number | null;
}

/**
 * The soonest a running series can end, in seconds: the leader wins every
 * round and map from here. A lower bound on purpose, so servers start early
 * rather than late.
 */
export function estimateSecondsLeft(s: EtaInput): number {
  if (s.phase === 'series_end') return 0;
  const numMaps = Math.max(1, Math.floor(s.numMaps || 1));
  const mapsToWin = Math.floor(numMaps / 2) + 1;
  const leader = Math.max(s.series.team1 || 0, s.series.team2 || 0);
  const maxRounds = s.maxRounds && s.maxRounds > 0 ? s.maxRounds : 24;
  const roundsToWin = Math.floor(maxRounds / 2) + 1;
  const fullMap = MAP_SETUP_SECONDS + roundsToWin * ROUND_SECONDS;
  if (s.phase === 'map_end') {
    // The series score already has the map that just ended.
    return Math.max(0, mapsToWin - leader) * fullMap;
  }
  const mapsAfterCurrent = Math.max(0, mapsToWin - leader - 1);
  let current: number;
  if (
    s.phase === 'loading' ||
    s.phase === 'warmup' ||
    s.phase === 'knife' ||
    s.phase === 'side_pick'
  ) {
    current = fullMap;
  } else {
    const best = Math.max(s.mapScore?.team1 ?? 0, s.mapScore?.team2 ?? 0);
    current = Math.max(1, roundsToWin - best) * ROUND_SECONDS;
  }
  return current + mapsAfterCurrent * fullMap;
}

// ---------------------------------------------------------------------------
// Demand: how many matches can run at once, now and within the lead time
// ---------------------------------------------------------------------------

export interface DemandMatch {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  bracket?: string | null;
  status: string;
  /** matches.server_id */
  serverId: string | null;
  /** Its server is an RCON server: not the fleet's to supply. */
  onRcon: boolean;
  team1Id: string | null;
  team2Id: string | null;
  team1FromMatchId: number | null;
  team2FromMatchId: number | null;
  /** Running matches: estimateSecondsLeft, or null when unknown (no fleet state). */
  secondsLeft: number | null;
}

export interface Demand {
  /** Matches on a Ready Up server (loaded, live, or being loaded). */
  running: number;
  /** Both teams known, no server yet, neither team busy elsewhere. */
  waiting: number;
  /** Will be waiting within the lead time: their feeders (or their teams' current matches) are finishing. */
  soon: number;
  total: number;
  soonSlugs: string[];
}

const OPEN = new Set(['pending', 'ready']);
const RUNNING = new Set(['loaded', 'live']);

/**
 * Matches that need a Ready Up server now or within `leadTimeSeconds`.
 * Tournament matches count only while the tournament is in progress;
 * standalone matches (round 0) always. Matches on RCON servers are not the
 * fleet's. A finishing match's own server is not counted as free: it goes
 * through turnover (series-end delay, demo upload) first.
 */
export function computeDemand(
  matches: readonly DemandMatch[],
  opts: { tournamentActive: boolean; leadTimeSeconds: number }
): Demand {
  const relevant = matches.filter((m) => m.round <= 0 || opts.tournamentActive);
  const byId = new Map(matches.map((m) => [m.id, m]));
  const finishing = (m: DemandMatch | undefined): boolean =>
    !!m &&
    (m.status === 'completed' ||
      (RUNNING.has(m.status) && m.secondsLeft !== null && m.secondsLeft <= opts.leadTimeSeconds));

  let running = 0;
  const busyTeams = new Set<string>();
  /** team id → the match occupying it */
  const teamMatch = new Map<string, DemandMatch>();
  for (const m of relevant) {
    const occupied = RUNNING.has(m.status) || (OPEN.has(m.status) && !!m.serverId);
    if (!occupied) continue;
    for (const t of [m.team1Id, m.team2Id]) {
      if (!t) continue;
      busyTeams.add(t);
      teamMatch.set(t, m);
    }
    if (!m.onRcon) running += 1;
  }

  const open = relevant
    .filter((m) => OPEN.has(m.status) && !m.serverId)
    .sort((a, b) => compareQueueOrder(a, b));
  // Standalone matches carry their teams in the config (no team ids): they take a server as they are.
  const queueable = open.filter(
    (m) => m.round <= 0 || (m.team1Id && m.team2Id && m.team1Id !== m.team2Id)
  );
  const startable = new Set(withoutBusyTeams(queueable, busyTeams).map((m) => m.slug));

  let waiting = 0;
  const soonSlugs: string[] = [];
  for (const m of open) {
    if (startable.has(m.slug)) {
      waiting += 1;
      continue;
    }
    if (queueable.includes(m)) {
      // Both teams known, but one is still playing: soon when those matches are finishing.
      const blockers = [m.team1Id, m.team2Id]
        .map((t) => (t ? teamMatch.get(t) : undefined))
        .filter(Boolean);
      if (blockers.length > 0 && blockers.every((b) => finishing(b))) soonSlugs.push(m.slug);
      continue;
    }
    // An empty slot: soon when every empty slot's feeder is finishing.
    const slots: Array<[string | null, number | null]> = [
      [m.team1Id, m.team1FromMatchId],
      [m.team2Id, m.team2FromMatchId],
    ];
    const empty = slots.filter(([team]) => !team);
    if (empty.length > 0 && empty.every(([, from]) => from !== null && finishing(byId.get(from)))) {
      soonSlugs.push(m.slug);
    }
  }
  return {
    running,
    waiting,
    soon: soonSlugs.length,
    total: running + waiting + soonSlugs.length,
    soonSlugs,
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** A server running for less than this counts as warm while Ready Up connects. */
export const BOOT_GRACE_SECONDS = 180;
/** csm needs this much free RAM on a machine for one more server. */
export const MIN_FREE_RAM_MB = 3072;
/** …and this much free disk (servers are thin copies of the master install). */
export const MIN_FREE_DISK_GB = 5;

export interface ScalerServer {
  fleetServerId: string;
  /** cs2_servers.id it plays matches as. */
  cs2ServerId: string;
  name: string;
  hostId: string;
  /** csm's name for it (server-N). */
  hostServer: string;
  /** csm: the process runs. */
  running: boolean;
  /** Ready Up's link is up. */
  online: boolean;
  /** Unix s it started (csm, or our own start). */
  startedAt: number | null;
  /** Ready Up says available and nothing of ours is on it. */
  idle: boolean;
  /** A match is loaded, live, being loaded or turning over on it. */
  busy: boolean;
  /** An update (CS2, Ready Up) or restart is in progress. */
  updating: boolean;
  /** An open failover points at it. */
  failoverTarget: boolean;
  /** A start / stop sent and not answered yet. */
  pending: 'start' | 'stop' | null;
  /** Unix s it has been idle since (warm servers). */
  idleSince: number | null;
}

export interface ScalerHost {
  id: string;
  name: string;
  online: boolean;
  /** csm said it can create servers (or said nothing about it). */
  canCreate: boolean;
  /** Servers csm has on it (any, Ready Up or not). */
  serverCount: number;
  ramFreeMb: number;
  diskFreeGb: number;
}

export interface PlanInput {
  /** Unix s. */
  now: number;
  settings: AutoscaleSettings;
  demand: Demand;
  /** Failover reserve, from the failover settings (null = automatic). */
  reserveConfigured: number | null;
  servers: readonly ScalerServer[];
  hosts: readonly ScalerHost[];
  /** A create is running (or its server has not joined the pool yet). */
  createInFlight: boolean;
}

export type ScalerAction =
  | {
      kind: 'start';
      hostId: string;
      server: string;
      fleetServerId: string;
      name: string;
      reason: string;
    }
  | {
      kind: 'stop';
      hostId: string;
      server: string;
      fleetServerId: string;
      name: string;
      reason: string;
    }
  | { kind: 'create'; hostId: string; reason: string };

export interface ScalePlan {
  desired: number;
  warm: number;
  reserve: number;
  actions: ScalerAction[];
  /** Why nothing (more) is done, when that is worth telling an admin. */
  note: string | null;
}

export function isWarm(s: ScalerServer, now: number): boolean {
  if (s.pending === 'start') return true;
  if (s.pending === 'stop' || !s.running) return false;
  return s.online || (s.startedAt !== null && now - s.startedAt < BOOT_GRACE_SECONDS);
}

function plural(n: number, one: string, many = `${one}es`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 matches running, 1 waiting, 1 about to be ready + 1 spare" */
export function describeNeed(demand: Demand, reserve: number): string {
  const parts: string[] = [];
  if (demand.running) parts.push(`${plural(demand.running, 'match')} running`);
  if (demand.waiting) parts.push(`${demand.waiting} waiting for a server`);
  if (demand.soon) parts.push(`${demand.soon} about to be ready`);
  const base = parts.length ? parts.join(', ') : 'no matches';
  return reserve > 0 ? `${base} + ${reserve} spare for failover` : base;
}

/**
 * What to do now. Warm servers short of the need: start stopped ones
 * (machines with the most free RAM first), then ask one machine with room
 * for one new server. More than the need: stop the servers idle longest,
 * once idle past the cool-down, never a busy, updating, failover or spare one.
 */
export function planScaling(input: PlanInput): ScalePlan {
  const { now, settings, demand } = input;
  const reserve = scalerReserve(input.reserveConfigured, input.servers.length);
  const desired = demand.total > 0 ? demand.total + reserve : 0;
  const warmServers = input.servers.filter((s) => isWarm(s, now));
  const warm = warmServers.length;
  const plan: ScalePlan = { desired, warm, reserve, actions: [], note: null };
  if (!settings.enabled) return { ...plan, note: 'Automatic scaling is off' };

  const hosts = new Map(input.hosts.map((h) => [h.id, h]));
  const need = describeNeed(demand, reserve);

  if (warm < desired) {
    let missing = desired - warm;
    const cold = input.servers
      .filter(
        (s) =>
          !isWarm(s, now) && !s.running && !s.pending && !s.updating && hosts.get(s.hostId)?.online
      )
      .sort(
        (a, b) =>
          (hosts.get(b.hostId)?.ramFreeMb ?? 0) - (hosts.get(a.hostId)?.ramFreeMb ?? 0) ||
          a.name.localeCompare(b.name)
      );
    for (const s of cold.slice(0, missing)) {
      plan.actions.push({
        kind: 'start',
        hostId: s.hostId,
        server: s.hostServer,
        fleetServerId: s.fleetServerId,
        name: s.name,
        reason: `${need}: ${warm + plan.actions.length} of ${desired} servers warm`,
      });
    }
    missing -= plan.actions.length;
    if (missing > 0) {
      if (input.createInFlight) {
        plan.note = `Short by ${missing}: waiting for the server being created`;
      } else {
        const room = input.hosts
          .filter(
            (h) =>
              h.online &&
              h.canCreate &&
              h.serverCount < settings.maxServersPerHost &&
              h.ramFreeMb >= MIN_FREE_RAM_MB &&
              h.diskFreeGb >= MIN_FREE_DISK_GB
          )
          .sort(
            (a, b) =>
              b.ramFreeMb - a.ramFreeMb ||
              a.serverCount - b.serverCount ||
              a.name.localeCompare(b.name)
          );
        if (room.length > 0) {
          plan.actions.push({
            kind: 'create',
            hostId: room[0].id,
            reason: `${need}: short by ${missing} with every server started`,
          });
        } else {
          plan.note = `Short by ${missing}: no machine has room for another server (max ${settings.maxServersPerHost} per machine, ${MIN_FREE_RAM_MB} MB RAM and ${MIN_FREE_DISK_GB} GB disk free)`;
        }
      }
    }
    return plan;
  }

  if (warm > desired) {
    const idleWarm = warmServers.filter(
      (s) =>
        s.running && s.online && s.idle && !s.busy && !s.updating && !s.failoverTarget && !s.pending
    );
    // The spare servers failover would pick stay warm.
    const spare = reservedIdle(
      idleWarm.map((s) => ({ id: s.fleetServerId, name: s.name })),
      desired > 0 ? reserve : 0
    );
    const stoppable = idleWarm
      .filter(
        (s) =>
          !spare.has(s.fleetServerId) &&
          s.idleSince !== null &&
          now - s.idleSince >= settings.cooldownSeconds
      )
      .sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0) || a.name.localeCompare(b.name));
    const surplus = warm - desired;
    for (const s of stoppable.slice(0, surplus)) {
      const idleMin = Math.floor((now - (s.idleSince ?? now)) / 60);
      plan.actions.push({
        kind: 'stop',
        hostId: s.hostId,
        server: s.hostServer,
        fleetServerId: s.fleetServerId,
        name: s.name,
        reason: `Idle ${idleMin} min and not needed (${need}; ${warm - plan.actions.length} warm, ${desired} needed)`,
      });
    }
  }
  return plan;
}
