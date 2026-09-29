import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  buildResume,
  DEFAULT_FAILOVER_GRACE,
  detectFailure,
  effectiveReserve,
  failoverGraceFromEnv,
  graceSecondsFor,
  pickBackup,
  pickReserved,
  pickTarget,
  type FailoverCandidate,
} from '../../api/src/integrations/cs2/fleet/failoverPlan';
import {
  validatePayload,
  type Envelope,
  type InlineBackup,
  type MatchState,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The pure failover decisions (FLEET.md §11, fleet/failoverPlan.ts): when a
 * server counts as down, which round backup and which server the match
 * resumes with, the `match.assign.resume` block (checked against the
 * protocol schema), and the reserve. No server, no database.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

const NOW = 1_800_000_000;

test.describe('failover: detection', () => {
  test('grace: 90 s live, 30 s before live, none between maps or after the series', () => {
    expect(graceSecondsFor('live')).toBe(90);
    expect(graceSecondsFor('paused')).toBe(90);
    expect(graceSecondsFor('halftime')).toBe(90);
    expect(graceSecondsFor('overtime')).toBe(90);
    expect(graceSecondsFor('warmup')).toBe(30);
    expect(graceSecondsFor('knife')).toBe(30);
    expect(graceSecondsFor('restoring')).toBe(30);
    expect(graceSecondsFor(null)).toBe(30);
    expect(graceSecondsFor('map_end')).toBeNull();
    expect(graceSecondsFor('series_end')).toBeNull();
    expect(failoverGraceFromEnv({ FLEET_FAILOVER_LIVE_SECONDS: '120', FLEET_FAILOVER_PRELIVE_SECONDS: 'x' })).toEqual({
      liveSeconds: 120,
      preLiveSeconds: DEFAULT_FAILOVER_GRACE.preLiveSeconds,
    });
  });

  test('link down: nothing inside the grace, `offline` after it', () => {
    const base = { online: false, now: NOW, phase: 'live' as const, health: null };
    expect(detectFailure({ ...base, offlineSince: NOW - 89 })).toBeNull();
    expect(detectFailure({ ...base, offlineSince: NOW - 90 })).toMatchObject({ reason: 'offline', since: NOW - 90 });
    expect(detectFailure({ ...base, phase: 'warmup', offlineSince: NOW - 31 })).toMatchObject({ reason: 'offline' });
    expect(detectFailure({ ...base, phase: 'series_end', offlineSince: NOW - 999 })).toBeNull();
    expect(detectFailure({ ...base, online: true, offlineSince: null })).toBeNull();
    // A custom grace (the test route uses 0).
    expect(
      detectFailure({ ...base, offlineSince: NOW, grace: { liveSeconds: 0, preLiveSeconds: 0 } })
    ).toMatchObject({ reason: 'offline' });
  });

  test('csm: a stopped or hung process counts at once, even with the link up', () => {
    const base = { online: true, offlineSince: null, now: NOW, phase: 'live' as const };
    expect(detectFailure({ ...base, health: { event: 'exited', at: NOW - 2 } })).toMatchObject({
      reason: 'exited',
      since: NOW - 2,
    });
    expect(detectFailure({ ...base, health: { event: 'hung', at: NOW - 1, detail: '/health 503' } })).toMatchObject({
      reason: 'hung',
      detail: expect.stringContaining('/health 503'),
    });
    expect(detectFailure({ ...base, health: { event: 'recovered', at: NOW } })).toBeNull();
  });
});

test.describe('failover: what to resume with', () => {
  const b = (mapNumber: number, round: number, supersededAt: number | null = null) => ({ mapNumber, round, supersededAt });

  test('backup: the latest of the map a restore has not voided', () => {
    const list = [b(1, 3), b(1, 12), b(1, 14, NOW), b(2, 20), b(1, 9)];
    expect(pickBackup(list, 1)).toEqual(b(1, 12));
    expect(pickBackup(list, 2)).toEqual(b(2, 20));
    expect(pickBackup(list, 3)).toBeNull();
    expect(pickBackup([b(1, 5, NOW)], 1)).toBeNull();
  });

  const c = (id: string, name: string, cs2Build: number | null, capabilities: string[] = ['match.v1']): FailoverCandidate => ({
    cs2ServerId: id,
    fleetServerId: `f-${id}`,
    name,
    cs2Build,
    capabilities,
  });
  const failed = { cs2ServerId: 'a', fleetServerId: 'f-a', cs2Build: 100, capabilities: ['match.v1', 'demo.stream.v1'] };

  test('server: never the one that went down; same build and capabilities first; the admin pick wins', () => {
    const list = [
      c('a', 'A', 100, ['match.v1', 'demo.stream.v1']),
      c('b', 'B', 99, ['match.v1', 'demo.stream.v1']),
      c('c', 'C', 100, ['match.v1']),
      c('d', 'D', 100, ['match.v1', 'demo.stream.v1']),
    ];
    expect(pickTarget(list, failed)?.cs2ServerId).toBe('d');
    expect(pickTarget(list, failed, 'b')?.cs2ServerId).toBe('b');
    // A pick that is not free (or is the failed server) falls back to the ranking.
    expect(pickTarget(list, failed, 'a')?.cs2ServerId).toBe('d');
    expect(pickTarget(list, failed, 'zz')?.cs2ServerId).toBe('d');
    // Excluded (it refused before): the next one.
    expect(pickTarget(list, failed, null, ['d'])?.cs2ServerId).toBe('c');
    expect(pickTarget([c('a', 'A', 100)], failed)).toBeNull();
    expect(pickTarget([], failed)).toBeNull();
  });

  test('reserve: 1 once two servers are online unless set; never the whole pool; the same servers each pass', () => {
    expect(effectiveReserve(null, 0)).toBe(0);
    expect(effectiveReserve(null, 1)).toBe(0);
    expect(effectiveReserve(null, 2)).toBe(1);
    expect(effectiveReserve(null, 6)).toBe(1);
    expect(effectiveReserve(0, 6)).toBe(0);
    expect(effectiveReserve(3, 6)).toBe(3);
    expect(effectiveReserve(5, 3)).toBe(2);
    const idle = [
      { id: 's2', name: 'srv-2' },
      { id: 's1', name: 'srv-1' },
      { id: 's3', name: 'srv-3' },
    ];
    expect([...pickReserved(idle, 1)]).toEqual(['s3']);
    expect([...pickReserved(idle, 2)].sort()).toEqual(['s2', 's3']);
    expect(pickReserved(idle, 0).size).toBe(0);
  });
});

test.describe('failover: the resume block', () => {
  const assign = example('match.assign.json');
  const backup = (example('match.assign.resume.json').payload as { resume: { backup: InlineBackup } }).resume.backup;
  const state = (): MatchState => {
    const s = JSON.parse(JSON.stringify(example('live.state.snapshot.json').payload)).state as MatchState;
    s.phase = 'live';
    s.series = {
      num_maps: 3,
      current_map: 2,
      score: { team1: 1, team2: 0 },
      maps: {
        '1': { name: 'de_mirage', sides: 'team1_ct', status: 'done', score: { team1: 13, team2: 9 }, winner: 'team1' },
        '2': { name: 'de_inferno', sides: 'team2_ct', status: 'live', score: { team1: 5, team2: 3 } },
        '3': { name: 'de_nuke', sides: 'knife', status: 'pending' },
      },
    };
    return s;
  };
  const valid = (resume: unknown) => {
    const payload = { ...(assign.payload as Record<string, unknown>), epoch: 2, resume };
    return validatePayload('match.assign', payload);
  };

  test('inline backup: map, round, backup, series score, earlier maps, the knife sides', () => {
    const resume = buildResume({
      fromEpoch: 1,
      mapNumber: 2,
      round: backup.round,
      backup,
      backupRef: null,
      state: state(),
      mapStats: null,
    });
    expect(resume).toEqual({
      from_epoch: 1,
      map_number: 2,
      round: backup.round,
      backup,
      series_score: { team1: 1, team2: 0 },
      maps: { '1': { score: { team1: 13, team2: 9 }, winner: 'team1' } },
      sides: 'team2_ct',
      score: backup.score,
    });
    expect(valid(resume)).toEqual({ ok: true, errors: [] });
  });

  test('too large to go inline: backup_ref by file and sha256', () => {
    const resume = buildResume({
      fromEpoch: 3,
      mapNumber: 2,
      round: 9,
      backup: null,
      backupRef: { file: backup.file, sha256: backup.sha256 },
      state: state(),
      mapStats: null,
    });
    expect(resume.backup).toBeUndefined();
    expect(resume.backup_ref).toEqual({ file: backup.file, sha256: backup.sha256 });
    expect(valid(resume)).toEqual({ ok: true, errors: [] });
  });

  test('no backup yet: the map restarts from warmup (round 0), sides kept only when decided', () => {
    const s = state();
    s.series.maps['2'].sides = 'knife';
    const resume = buildResume({ fromEpoch: 1, mapNumber: 2, round: 0, backup: null, backupRef: null, state: s, mapStats: null });
    expect(resume).toMatchObject({ from_epoch: 1, map_number: 2, round: 0 });
    expect(resume.backup).toBeUndefined();
    expect(resume.backup_ref).toBeUndefined();
    expect(resume.sides).toBeUndefined();
    expect(valid(resume)).toEqual({ ok: true, errors: [] });
    // No state at all (it never reached the platform): map and round only.
    expect(buildResume({ fromEpoch: 1, mapNumber: 1, round: 0, backup: null, backupRef: null, state: null, mapStats: null })).toEqual({
      from_epoch: 1,
      map_number: 1,
      round: 0,
    });
  });
});
