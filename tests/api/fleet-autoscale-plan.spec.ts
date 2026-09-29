import { test, expect } from '@playwright/test';
import {
  BOOT_GRACE_SECONDS,
  DEFAULT_AUTOSCALE_SETTINGS,
  ROUND_SECONDS,
  MAP_SETUP_SECONDS,
  computeDemand,
  estimateSecondsLeft,
  normalizeAutoscaleSettings,
  planScaling,
  scalerReserve,
  limitActions,
  MAX_COMMANDS_PER_HOST,
  MAX_STARTS_PER_PASS,
  MAX_STOPS_PER_PASS,
  RATE_WINDOW_SECONDS,
  validateAutoscalePatch,
  type AutoscaleSettings,
  type Demand,
  type DemandMatch,
  type PlanInput,
  type ScalerHost,
  type ScalerServer,
} from '../../api/src/integrations/cs2/fleet/autoscale/plan';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';
import {
  CS2_MIGRATIONS,
  CS2_FLEET_AUTOSCALE_MIGRATION_ID,
} from '../../api/src/integrations/cs2/migrations';

/**
 * Automatic server scaling, the pure part (fleet/autoscale/plan.ts): the
 * settings, when a running series can end, how many matches need a Ready Up
 * server now and within the lead time, and the start / stop / create plan.
 *
 * @tag api
 * @tag fleet
 */

const NOW = 1_800_000_000;
const settings = (over: Partial<AutoscaleSettings> = {}): AutoscaleSettings => ({
  ...DEFAULT_AUTOSCALE_SETTINGS,
  ...over,
});

function match(id: number, over: Partial<DemandMatch> = {}): DemandMatch {
  return {
    id,
    slug: `m${id}`,
    round: 1,
    matchNumber: id,
    bracket: null,
    status: 'pending',
    serverId: null,
    onRcon: false,
    team1Id: null,
    team2Id: null,
    team1FromMatchId: null,
    team2FromMatchId: null,
    secondsLeft: null,
    ...over,
  };
}

function server(n: number, over: Partial<ScalerServer> = {}): ScalerServer {
  return {
    fleetServerId: `fs${n}`,
    cs2ServerId: `fs${n}`,
    name: `ru-${n}`,
    hostId: 'h1',
    hostServer: `server-${n}`,
    running: false,
    online: false,
    startedAt: null,
    idle: false,
    busy: false,
    updating: false,
    failoverTarget: false,
    pending: null,
    idleSince: null,
    ...over,
  };
}

const warmIdle = (n: number, idleFor: number, over: Partial<ScalerServer> = {}) =>
  server(n, {
    running: true,
    online: true,
    idle: true,
    startedAt: NOW - 3600,
    idleSince: NOW - idleFor,
    ...over,
  });
const warmBusy = (n: number, over: Partial<ScalerServer> = {}) =>
  server(n, { running: true, online: true, busy: true, startedAt: NOW - 3600, ...over });

function host(over: Partial<ScalerHost> = {}): ScalerHost {
  return {
    id: 'h1',
    name: 'rack-1',
    online: true,
    canCreate: true,
    serverCount: 2,
    ramFreeMb: 32_000,
    diskFreeGb: 200,
    ...over,
  };
}

const demand = (running: number, waiting = 0, soon = 0): Demand => ({
  running,
  waiting,
  soon,
  total: running + waiting + soon,
  soonSlugs: [],
});

function plan(over: Partial<PlanInput>) {
  return planScaling({
    now: NOW,
    settings: settings(),
    demand: demand(0),
    reserveConfigured: null,
    servers: [],
    hosts: [host()],
    createInFlight: false,
    ...over,
  });
}

test.describe('Autoscale: settings', () => {
  test('defaults: on, 2 min lead, 10 min cool-down, 4 per machine', () => {
    expect(normalizeAutoscaleSettings(null)).toEqual({
      enabled: true,
      leadTimeSeconds: 120,
      cooldownSeconds: 600,
      maxServersPerHost: 4,
    });
    expect(
      normalizeAutoscaleSettings({
        enabled: false,
        cooldownSeconds: 30,
        leadTimeSeconds: -1,
        maxServersPerHost: 1.5,
      })
    ).toEqual({
      enabled: false,
      leadTimeSeconds: 120,
      cooldownSeconds: 30,
      maxServersPerHost: 4,
    });
  });

  test('a patch takes known keys in range only', () => {
    expect(validateAutoscalePatch({ enabled: false, cooldownSeconds: 0 })).toEqual({
      ok: true,
      patch: { enabled: false, cooldownSeconds: 0 },
    });
    expect(validateAutoscalePatch({ enabled: 'yes' }).ok).toBe(false);
    expect(validateAutoscalePatch({ maxServersPerHost: 0 }).ok).toBe(false);
    expect(validateAutoscalePatch({ leadTimeSeconds: 99999 }).ok).toBe(false);
    expect(validateAutoscalePatch({ reserve: 2 }).ok).toBe(false);
    expect(validateAutoscalePatch([]).ok).toBe(false);
  });

  test('reserve: the admin number, else 1 from two servers; never the whole pool', () => {
    expect(scalerReserve(null, 0)).toBe(0);
    expect(scalerReserve(null, 1)).toBe(0);
    expect(scalerReserve(null, 2)).toBe(1);
    expect(scalerReserve(3, 2)).toBe(1);
    expect(scalerReserve(0, 5)).toBe(0);
    expect(scalerReserve(2, 5)).toBe(2);
  });

  test('the migration is allowed and numbered after 013 (failover)', () => {
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS)).toBeNull();
    expect(CS2_FLEET_AUTOSCALE_MIGRATION_ID).toBe('014-fleet-autoscale');
    expect(CS2_MIGRATIONS.some((m) => m.id === CS2_FLEET_AUTOSCALE_MIGRATION_ID)).toBe(true);
  });
});

test.describe('Autoscale: when a series can end', () => {
  const base = { numMaps: 1, currentMap: 1, series: { team1: 0, team2: 0 }, maxRounds: 24 };

  test('Bo1 at match point: one round', () => {
    expect(estimateSecondsLeft({ ...base, phase: 'live', mapScore: { team1: 12, team2: 3 } })).toBe(
      ROUND_SECONDS
    );
    expect(estimateSecondsLeft({ ...base, phase: 'live', mapScore: { team1: 2, team2: 5 } })).toBe(
      8 * ROUND_SECONDS
    );
  });

  test('warmup is a whole map; series_end is now', () => {
    expect(estimateSecondsLeft({ ...base, phase: 'warmup', mapScore: null })).toBe(
      MAP_SETUP_SECONDS + 13 * ROUND_SECONDS
    );
    expect(estimateSecondsLeft({ ...base, phase: 'series_end', mapScore: null })).toBe(0);
  });

  test('Bo3: the leader needs this map and maybe another', () => {
    const fullMap = MAP_SETUP_SECONDS + 13 * ROUND_SECONDS;
    // 1-0, map 2 at 12-0: the series can end next round.
    expect(
      estimateSecondsLeft({
        ...base,
        numMaps: 3,
        currentMap: 2,
        series: { team1: 1, team2: 0 },
        phase: 'live',
        mapScore: { team1: 12, team2: 0 },
      })
    ).toBe(ROUND_SECONDS);
    // 0-0, map 1 at 12-0: one round and one more map at least.
    expect(
      estimateSecondsLeft({
        ...base,
        numMaps: 3,
        series: { team1: 0, team2: 0 },
        phase: 'live',
        mapScore: { team1: 12, team2: 0 },
      })
    ).toBe(ROUND_SECONDS + fullMap);
    // map_end with the series decided.
    expect(
      estimateSecondsLeft({
        ...base,
        numMaps: 3,
        series: { team1: 2, team2: 0 },
        phase: 'map_end',
        mapScore: null,
      })
    ).toBe(0);
  });

  test('MR12 (max_rounds 12) needs 7', () => {
    expect(
      estimateSecondsLeft({
        ...base,
        maxRounds: 12,
        phase: 'live',
        mapScore: { team1: 0, team2: 0 },
      })
    ).toBe(7 * ROUND_SECONDS);
  });
});

test.describe('Autoscale: demand', () => {
  const opts = { tournamentActive: true, leadTimeSeconds: 120 };

  test("running + waiting; RCON matches are not the fleet's", () => {
    const d = computeDemand(
      [
        match(1, {
          status: 'live',
          serverId: 'a',
          team1Id: 't1',
          team2Id: 't2',
          secondsLeft: 2000,
        }),
        match(2, { status: 'loaded', serverId: 'r', onRcon: true, team1Id: 't3', team2Id: 't4' }),
        match(3, { status: 'ready', team1Id: 't5', team2Id: 't6' }),
        match(4, { status: 'ready', serverId: 'b', team1Id: 't7', team2Id: 't8' }),
      ],
      opts
    );
    expect(d).toMatchObject({ running: 2, waiting: 1, soon: 0, total: 3 });
  });

  test('the next round is soon only while its feeders are finishing within the lead time', () => {
    const r1a = match(1, {
      status: 'live',
      serverId: 'a',
      team1Id: 't1',
      team2Id: 't2',
      secondsLeft: 100,
    });
    const r1b = match(2, {
      status: 'live',
      serverId: 'b',
      team1Id: 't3',
      team2Id: 't4',
      secondsLeft: 90,
    });
    const r2 = match(3, { round: 2, team1FromMatchId: 1, team2FromMatchId: 2 });
    expect(computeDemand([r1a, r1b, r2], opts)).toMatchObject({
      running: 2,
      waiting: 0,
      soon: 1,
      soonSlugs: ['m3'],
    });
    // One feeder has a long way to go: not yet.
    expect(computeDemand([r1a, { ...r1b, secondsLeft: 1500 }, r2], opts).soon).toBe(0);
    // No live state for a feeder (unknown): not yet.
    expect(computeDemand([r1a, { ...r1b, secondsLeft: null }, r2], opts).soon).toBe(0);
    // One slot already filled by a finished feeder, the other finishing.
    expect(
      computeDemand(
        [{ ...r1a, status: 'completed', serverId: null }, r1b, { ...r2, team1Id: 't1' }],
        opts
      ).soon
    ).toBe(1);
    // A longer lead time sees further.
    expect(
      computeDemand([r1a, { ...r1b, secondsLeft: 1500 }, r2], { ...opts, leadTimeSeconds: 1800 })
        .soon
    ).toBe(1);
  });

  test('round robin: a match whose team is still playing waits, and is soon when that match is finishing', () => {
    const playing = match(1, {
      status: 'live',
      serverId: 'a',
      team1Id: 't1',
      team2Id: 't2',
      secondsLeft: 3000,
    });
    const next = match(2, { round: 2, status: 'ready', team1Id: 't1', team2Id: 't3' });
    expect(computeDemand([playing, next], opts)).toMatchObject({ running: 1, waiting: 0, soon: 0 });
    expect(computeDemand([{ ...playing, secondsLeft: 60 }, next], opts)).toMatchObject({
      running: 1,
      waiting: 0,
      soon: 1,
    });
  });

  test('two waiting matches sharing a team: only the first can start', () => {
    const d = computeDemand(
      [
        match(1, { status: 'ready', team1Id: 't1', team2Id: 't2' }),
        match(2, { round: 2, status: 'ready', team1Id: 't1', team2Id: 't3' }),
      ],
      opts
    );
    expect(d.waiting).toBe(1);
  });

  test('tournament matches count only while it is in progress; standalone matches always', () => {
    const ms = [
      match(1, { status: 'ready', team1Id: 't1', team2Id: 't2' }),
      match(2, { round: 0, status: 'ready', team1Id: 'x', team2Id: 'y' }),
    ];
    expect(computeDemand(ms, { ...opts, tournamentActive: false })).toMatchObject({
      waiting: 1,
      total: 1,
    });
    expect(computeDemand(ms, opts)).toMatchObject({ waiting: 2, total: 2 });
    // Standalone matches carry their teams in the config: no team ids, still waiting.
    expect(
      computeDemand([match(3, { round: 0, status: 'pending' })], {
        ...opts,
        tournamentActive: false,
      }).waiting
    ).toBe(1);
  });
});

test.describe('Autoscale: plan', () => {
  test('start before the round: stopped servers are started for the matches about to be ready', () => {
    const p = plan({
      demand: demand(2, 0, 2),
      servers: [warmBusy(1), warmBusy(2), server(3), server(4), server(5)],
    });
    // 4 matches + 1 spare (pool of 5) = 5 warm wanted, 2 warm.
    expect(p).toMatchObject({ desired: 5, warm: 2, reserve: 1 });
    expect(p.actions.map((a) => a.kind === 'start' && a.server)).toEqual([
      'server-3',
      'server-4',
      'server-5',
    ]);
    expect(p.actions[0].reason).toContain('2 about to be ready');
    expect(p.actions[0].reason).toContain('1 spare');
  });

  test('starts prefer the machine with the most free RAM, never an offline machine', () => {
    const p = plan({
      demand: demand(0, 2),
      reserveConfigured: 0,
      servers: [
        server(1, { hostId: 'h1' }),
        server(2, { hostId: 'h2' }),
        server(3, { hostId: 'h3' }),
      ],
      hosts: [
        host({ id: 'h1', ramFreeMb: 8000 }),
        host({ id: 'h2', ramFreeMb: 30000 }),
        host({ id: 'h3', online: false, ramFreeMb: 60000 }),
      ],
    });
    expect(p.actions.map((a) => a.hostId)).toEqual(['h2', 'h1']);
  });

  test('a server being started, or booting, counts as warm', () => {
    const p = plan({
      demand: demand(0, 2),
      reserveConfigured: 0,
      servers: [
        server(1, { pending: 'start' }),
        server(2, { running: true, startedAt: NOW - 30 }),
        server(3),
      ],
    });
    expect(p).toMatchObject({ desired: 2, warm: 2, actions: [] });
    // Running but Ready Up never connected: not warm after the boot grace (and not started again).
    const stuck = plan({
      demand: demand(0, 1),
      reserveConfigured: 0,
      servers: [server(1, { running: true, startedAt: NOW - BOOT_GRACE_SECONDS - 1 }), server(2)],
    });
    expect(stuck.actions).toEqual([expect.objectContaining({ kind: 'start', server: 'server-2' })]);
  });

  test('a server busy with a match of its own (local match, scrim) is not counted as warm', () => {
    const p = plan({
      demand: demand(0, 1),
      reserveConfigured: 1,
      servers: [warmIdle(1, 60), warmBusy(2, { occupied: true }), server(3)],
    });
    expect(p).toMatchObject({ desired: 2, warm: 1 });
    expect(p.actions).toEqual([expect.objectContaining({ kind: 'start', server: 'server-3' })]);
  });

  test('stop after the cool-down: surplus idle servers, longest idle first', () => {
    const p = plan({
      demand: demand(0),
      servers: [warmIdle(1, 700), warmIdle(2, 1200), warmIdle(3, 300)],
    });
    expect(p.desired).toBe(0);
    expect(p.actions.map((a) => a.kind === 'stop' && a.server)).toEqual(['server-2', 'server-1']);
    expect(p.actions[0].reason).toMatch(/^Idle 20 min and not needed/);
    // Nothing idle long enough.
    expect(plan({ demand: demand(0), servers: [warmIdle(1, 599)] }).actions).toEqual([]);
    // A shorter cool-down.
    expect(
      plan({
        settings: settings({ cooldownSeconds: 60 }),
        demand: demand(0),
        servers: [warmIdle(1, 61)],
      }).actions
    ).toHaveLength(1);
  });

  test('never stops a busy, updating, failover, pending or not-idle server', () => {
    const p = plan({
      settings: settings({ cooldownSeconds: 0 }),
      demand: demand(0),
      servers: [
        warmBusy(1, { idleSince: NOW - 5000 }),
        warmIdle(2, 5000, { updating: true }),
        warmIdle(3, 5000, { failoverTarget: true }),
        warmIdle(4, 5000, { pending: 'start' }),
        warmIdle(5, 5000, { busy: true }),
        server(6, {
          running: true,
          online: true,
          startedAt: NOW - 5000,
          idle: false,
          idleSince: null,
        }),
      ],
    });
    expect(p.warm).toBe(6);
    expect(p.actions).toEqual([]);
  });

  test('the spare failover would pick stays warm', () => {
    // 1 match running, pool of 3: 1 + 1 spare = 2 warm wanted; ru-3 (last by name) is the spare.
    const p = plan({
      settings: settings({ cooldownSeconds: 0 }),
      demand: demand(1),
      servers: [warmBusy(1), warmIdle(2, 5000), warmIdle(3, 9000)],
    });
    expect(p).toMatchObject({ desired: 2, warm: 3 });
    expect(p.actions.map((a) => a.kind === 'stop' && a.server)).toEqual(['server-2']);
  });

  test('create when short: one server on the machine with room', () => {
    const p = plan({
      demand: demand(1, 2),
      reserveConfigured: 0,
      servers: [warmBusy(1), server(2)],
      hosts: [
        host({ id: 'h1', serverCount: 4 }),
        host({ id: 'h2', serverCount: 1, ramFreeMb: 20_000 }),
      ],
    });
    expect(p.actions).toEqual([
      expect.objectContaining({ kind: 'start', server: 'server-2' }),
      expect.objectContaining({ kind: 'create', hostId: 'h2' }),
    ]);
    expect(p.actions[1].reason).toContain('short by 1');
  });

  test('no create while one is in flight, or when no machine has room', () => {
    const short = { demand: demand(0, 2), reserveConfigured: 0, servers: [] as ScalerServer[] };
    expect(plan({ ...short, createInFlight: true })).toMatchObject({
      actions: [],
      note: expect.stringContaining('waiting for the server being created'),
    });
    for (const h of [
      host({ serverCount: 4 }),
      host({ ramFreeMb: 1000 }),
      host({ diskFreeGb: 1 }),
      host({ online: false }),
      host({ canCreate: false }),
    ]) {
      expect(plan({ ...short, hosts: [h] })).toMatchObject({
        actions: [],
        note: expect.stringContaining('no machine has room'),
      });
    }
    expect(
      plan({
        ...short,
        settings: settings({ maxServersPerHost: 8 }),
        hosts: [host({ serverCount: 4 })],
      }).actions
    ).toEqual([expect.objectContaining({ kind: 'create' })]);
  });

  test('off: nothing is done', () => {
    const p = plan({
      settings: settings({ enabled: false }),
      demand: demand(0, 3),
      servers: [server(1)],
    });
    expect(p).toMatchObject({ desired: 3, actions: [], note: 'Automatic scaling is off' });
  });
});

test.describe('Autoscale: rate limit', () => {
  const act = (kind: string, hostId = 'h1') => ({ kind, hostId });

  test('per pass: at most 8 starts and 2 stops', () => {
    const starts = Array.from({ length: 10 }, (_, i) => act('start', `h${i}`));
    const stops = Array.from({ length: 3 }, (_, i) => act('stop', `s${i}`));
    const { allowed, deferred } = limitActions(
      [...starts, ...stops, act('create', 'c')],
      new Map(),
      NOW
    );
    expect(allowed.filter((a) => a.kind === 'start')).toHaveLength(MAX_STARTS_PER_PASS);
    expect(allowed.filter((a) => a.kind === 'stop')).toHaveLength(MAX_STOPS_PER_PASS);
    expect(allowed.filter((a) => a.kind === 'create')).toHaveLength(1);
    expect(deferred).toHaveLength(10 - MAX_STARTS_PER_PASS + 3 - MAX_STOPS_PER_PASS);
  });

  test('per machine: at most 6 commands a minute, counting earlier passes', () => {
    const many = Array.from({ length: 8 }, () => act('start'));
    expect(limitActions(many, new Map(), NOW).allowed).toHaveLength(MAX_COMMANDS_PER_HOST);
    const recent = new Map([
      ['h1', [NOW - 10, NOW - 20, NOW - 30, NOW - 40, NOW - RATE_WINDOW_SECONDS]],
    ]);
    // Four in the window (the one a minute old has left it): two more.
    expect(limitActions(many, recent, NOW).allowed).toHaveLength(2);
    // Another machine is not held back.
    expect(limitActions([act('start', 'h2')], recent, NOW).allowed).toHaveLength(1);
  });
});
