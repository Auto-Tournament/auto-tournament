import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  applyMergePatch,
  diffPaths,
  jsonEqual,
} from '../../api/src/integrations/cs2/fleet/mergePatch';
import {
  LiveStateStore,
  createMemoryLiveStatePersistence,
  type LiveStateChange,
} from '../../api/src/integrations/cs2/fleet/state';
import type {
  Envelope,
  MatchState,
  RoundSummary,
  StateSnapshotPayload,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The fleet match state store (Ready Up's docs/fleet-step3-platform-notes.md
 * §3) without a database: RFC 7386 merge patch, rev ordering (apply /
 * duplicate / gap + hold + release), the epoch fence, snapshot reconcile and
 * the drift check, round summaries, epoch allocation. Driven with Ready Up's
 * real frames from tests/fixtures/fleet/v1.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const load = <T = Envelope>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as T;

const SERVER = 'fs_test_server';

function assignSnapshot(): StateSnapshotPayload {
  return load<Envelope>('live.state.snapshot.json').payload as unknown as StateSnapshotPayload;
}

function newStore() {
  const persistence = createMemoryLiveStatePersistence();
  const store = new LiveStateStore(persistence);
  const changes: LiveStateChange[] = [];
  store.onLiveStateChange((c) => changes.push(c));
  return { store, persistence, changes };
}

test.describe('RFC 7386 merge patch', () => {
  test('the RFC appendix examples', () => {
    const cases: Array<[unknown, unknown, unknown]> = [
      [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
      [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
      [{ a: 'b' }, { a: null }, {}],
      [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
      [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
      [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
      [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
      [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
      [
        ['a', 'b'],
        ['c', 'd'],
        ['c', 'd'],
      ],
      [{ a: 'b' }, ['c'], ['c']],
      [{ a: 'foo' }, null, null],
      [{ a: 'foo' }, 'bar', 'bar'],
      [{ e: null }, { a: 1 }, { e: null, a: 1 }],
      [[1, 2], { a: 'b', c: null }, { a: 'b' }],
      [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ];
    for (const [target, patch, result] of cases) {
      expect(applyMergePatch(target, patch), JSON.stringify({ target, patch })).toEqual(result);
    }
  });

  test('inputs are not mutated; diff and equality', () => {
    const target = { a: { b: 1 }, list: [1, 2] };
    const patch = { a: { c: 2 }, list: [3] };
    const out = applyMergePatch<Record<string, unknown>>(target, patch);
    expect(target).toEqual({ a: { b: 1 }, list: [1, 2] });
    expect(out).toEqual({ a: { b: 1, c: 2 }, list: [3] });
    (out.list as number[]).push(4);
    expect(patch.list).toEqual([3]);

    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(diffPaths({ a: { b: 1, c: 2 }, d: 1 }, { a: { b: 2, c: 2 }, e: 1 })).toEqual([
      'a.b',
      'd',
      'e',
    ]);
    expect(diffPaths({ x: 1 }, { x: 1 })).toEqual([]);
  });
});

test.describe('Live state store', () => {
  test('assign snapshot, then patches in rev order; duplicates ignored', async () => {
    const { store, changes } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;

    const replaced = await store.applySnapshot(SERVER, snap);
    expect(replaced.kind).toBe('replaced');
    const rec = await store.getLiveState(slug);
    expect(rec).toMatchObject({
      matchSlug: slug,
      epoch: 2,
      serverId: SERVER,
      liveRev: 0,
      configRev: 1,
    });
    expect(rec!.state!.phase).toBe('loading');

    // rev 1: a round-start style patch; rev 2: Ready Up's live state.patch frame.
    const r1 = await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 1,
      patch: { live_rev: 1, phase: 'warmup', teams: { team1: { side: 'ct' } } },
      type: 'state.patch',
    });
    expect(r1.kind).toBe('applied');
    const frame = load('live.state.patch.json');
    const p = frame.payload as { match_id: string; rev: number; patch: Record<string, unknown> };
    const r2 = await store.applyPatch(SERVER, {
      matchSlug: p.match_id,
      epoch: frame.epoch,
      rev: p.rev,
      patch: p.patch,
      type: frame.type,
    });
    expect(r2.kind).toBe('applied');

    const after = (await store.getLiveState(slug))!;
    expect(after.liveRev).toBe(2);
    expect(after.state!.live_rev).toBe(2);
    expect(after.state!.phase).toBe('warmup');
    expect(after.state!.teams.team1.score).toBe(1);
    expect(after.state!.teams.team1.side).toBe('ct');
    expect(after.state!.series.maps['1'].score).toEqual({ team1: 1, team2: 0 });
    expect(after.state!.round).toEqual({ number: 1 });
    // Members the patches did not touch are kept.
    expect(after.state!.teams.team2.name).toBe('LiveTestB');

    // Same rev again: duplicate, nothing changes.
    const dup = await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 2,
      patch: { phase: 'error' },
      type: 'state.patch',
    });
    expect(dup.kind).toBe('duplicate');
    expect((await store.getLiveState(slug))!.state!.phase).toBe('warmup');

    // null removes a member (side unknown again).
    await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 3,
      patch: { live_rev: 3, teams: { team1: { side: null } } },
      type: 'state.patch',
    });
    expect((await store.getLiveState(slug))!.state!.teams.team1.side).toBeUndefined();

    expect(changes.map((c) => c.cause)).toEqual(['snapshot', 'patch', 'patch', 'patch']);
  });

  test('a rev gap holds the patch and asks for a snapshot once; the snapshot releases what follows', async () => {
    const { store } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;
    await store.applySnapshot(SERVER, snap);

    const gap = await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 3,
      patch: { live_rev: 3, phase: 'knife' },
      type: 'event.phase',
    });
    expect(gap).toEqual({ kind: 'gap', expected: 1, got: 3, requestSnapshot: true });
    // A second gap within the re-request window does not ask again.
    const gap2 = await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 4,
      patch: { live_rev: 4, round: { number: 1 } },
      type: 'state.patch',
    });
    expect(gap2.kind).toBe('gap');
    expect((gap2 as { requestSnapshot: boolean }).requestSnapshot).toBe(false);
    expect(store.heldCount(slug)).toBe(2);
    expect((await store.getLiveState(slug))!.needsSnapshot).toBe(true);

    // The answer: a request snapshot at rev 2. Held rev 3 and 4 follow on.
    const answer: StateSnapshotPayload = {
      ...snap,
      reason: 'request',
      state: { ...(snap.state as MatchState), live_rev: 2, phase: 'warmup' },
    };
    const out = await store.applySnapshot(SERVER, answer);
    expect(out.kind).toBe('replaced');
    expect((out as { released: number }).released).toBe(2);
    const rec = (await store.getLiveState(slug))!;
    expect(rec.liveRev).toBe(4);
    expect(rec.state!.phase).toBe('knife');
    expect(rec.state!.round).toEqual({ number: 1 });
    expect(rec.needsSnapshot).toBe(false);
    expect(store.heldCount(slug)).toBe(0);
  });

  test('patches before any snapshot are held (no baseline)', async () => {
    const { store } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;
    const early = await store.applyPatch(SERVER, {
      matchSlug: slug,
      epoch: 2,
      rev: 1,
      patch: { live_rev: 1, phase: 'warmup' },
      type: 'state.patch',
    });
    expect(early).toEqual({ kind: 'no_baseline', requestSnapshot: true });
    const out = await store.applySnapshot(SERVER, snap);
    expect((out as { released: number }).released).toBe(1);
    expect((await store.getLiveState(slug))!.state!.phase).toBe('warmup');
  });

  test('epoch fence: a lower epoch is stale for patches, events and snapshots', async () => {
    const { store } = newStore();
    const snap = assignSnapshot(); // epoch 2
    const slug = snap.state!.match_id;
    await store.applySnapshot(SERVER, snap);

    const stale = await store.applyPatch('fs_zombie', {
      matchSlug: slug,
      epoch: 1,
      rev: 1,
      patch: { phase: 'live' },
      type: 'event.phase',
    });
    expect(stale).toEqual({ kind: 'stale_epoch', currentEpoch: 2 });
    const staleSnap = await store.applySnapshot('fs_zombie', {
      ...snap,
      state: { ...(snap.state as MatchState), epoch: 1 },
    });
    expect(staleSnap).toEqual({ kind: 'stale_epoch', currentEpoch: 2 });
    const rec = (await store.getLiveState(slug))!;
    expect(rec.serverId).toBe(SERVER);
    expect(rec.state!.phase).toBe('loading');

    const round = load('live.event.round_end.json').payload as { data: { round: RoundSummary } };
    expect(await store.recordRound(slug, 1, 1, round.data.round)).toBeNull();
    expect(await store.voidRounds(slug, 1, 1, 1)).toBe(0);
  });

  test('beginAssignment allocates increasing epochs and clears the state', async () => {
    const { store, changes } = newStore();
    const a = await store.beginAssignment('m-epochs', SERVER, 1);
    expect(a).toMatchObject({ epoch: 1, serverId: SERVER, liveRev: 0, configRev: 1, state: null });
    const b = await store.beginAssignment('m-epochs', 'fs_other', 3);
    expect(b).toMatchObject({ epoch: 2, serverId: 'fs_other', configRev: 3 });
    // The epoch-1 server is fenced from now on.
    expect(
      (
        await store.applyPatch(SERVER, {
          matchSlug: 'm-epochs',
          epoch: 1,
          rev: 1,
          patch: {},
          type: 'state.patch',
        })
      ).kind
    ).toBe('stale_epoch');
    await store.setConfigRev('m-epochs', 4);
    expect((await store.getLiveState('m-epochs'))!.configRev).toBe(4);
    expect(changes.map((c) => c.cause)).toEqual(['assign', 'assign', 'config']);
  });

  test('periodic snapshot at the same rev is a drift check; the snapshot wins', async () => {
    const { store } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;
    await store.applySnapshot(SERVER, snap);
    const drifted: StateSnapshotPayload = {
      ...snap,
      reason: 'periodic',
      state: {
        ...(snap.state as MatchState),
        phase: 'warmup',
        teams: { ...snap.state!.teams, team2: { ...snap.state!.teams.team2, score: 3 } },
      },
    };
    const out = await store.applySnapshot(SERVER, drifted);
    expect(out.kind).toBe('replaced');
    expect((out as { drift: string[] }).drift).toEqual(['phase', 'teams.team2.score']);
    expect((await store.getLiveState(slug))!.state!.teams.team2.score).toBe(3);

    // Same content again: no drift.
    const again = await store.applySnapshot(SERVER, drifted);
    expect((again as { drift: string[] }).drift).toEqual([]);
  });

  test("Ready Up's periodic and restored snapshots are taken; state null is idle", async () => {
    const { store } = newStore();
    for (const file of ['live.state.snapshot.periodic.json', 'live.state.snapshot.restored.json']) {
      const payload = load(file).payload as unknown as StateSnapshotPayload;
      const out = await store.applySnapshot(SERVER, payload);
      expect(out.kind, file).toBe('replaced');
      const rec = (await store.getLiveState(payload.state!.match_id))!;
      expect(rec.liveRev).toBe(payload.state!.live_rev);
      expect(rec.state).toEqual(payload.state);
      expect(rec.mapStats).toEqual(payload.map_stats ?? null);
    }
    expect(await store.applySnapshot(SERVER, { ...assignSnapshot(), state: null })).toEqual({
      kind: 'idle',
    });
  });

  test('round summaries per map: recorded, replaced on replay, voided, seeded by map_stats', async () => {
    const { store } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;
    await store.applySnapshot(SERVER, snap);
    const base = (load('live.event.round_end.json').payload as { data: { round: RoundSummary } })
      .data.round;
    for (const n of [1, 2, 3]) {
      await store.recordRound(slug, 2, 1, {
        ...base,
        round_number: n,
        team1_score: n,
        team2_score: 0,
      });
    }
    // Round 3 replayed after a restore with another result: replaced.
    const rounds = await store.recordRound(slug, 2, 1, {
      ...base,
      round_number: 3,
      team1_score: 2,
      team2_score: 1,
    });
    expect(rounds!.map((r) => [r.round_number, r.team1_score, r.team2_score])).toEqual([
      [1, 1, 0],
      [2, 2, 0],
      [3, 2, 1],
    ]);
    expect(await store.voidRounds(slug, 2, 1, 2)).toBe(2);
    expect((await store.getLiveState(slug))!.mapRounds['1'].map((r) => r.round_number)).toEqual([
      1,
    ]);

    // A snapshot with map_stats replaces the current map's rounds.
    const withStats: StateSnapshotPayload = {
      ...snap,
      reason: 'hello',
      map_stats: {
        live: true,
        team1_is_ct: true,
        team1: { score: 1, score_ct: 1, score_t: 0 },
        team2: { score: 1, score_ct: 0, score_t: 1 },
        players: [],
        rounds: [
          { ...base, round_number: 2 },
          { ...base, round_number: 1 },
        ],
      },
    };
    await store.applySnapshot(SERVER, withStats);
    expect((await store.getLiveState(slug))!.mapRounds['1'].map((r) => r.round_number)).toEqual([
      1, 2,
    ]);
  });

  test('calls for one match are serialized', async () => {
    const { store } = newStore();
    const snap = assignSnapshot();
    const slug = snap.state!.match_id;
    await store.applySnapshot(SERVER, snap);
    // Fired together, in order: each sees the previous one's rev.
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((rev) =>
        store.applyPatch(SERVER, {
          matchSlug: slug,
          epoch: 2,
          rev,
          patch: { live_rev: rev },
          type: 'state.patch',
        })
      )
    );
    expect(results.map((r) => r.kind)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'applied',
    ]);
    expect((await store.getLiveState(slug))!.liveRev).toBe(5);
  });
});
