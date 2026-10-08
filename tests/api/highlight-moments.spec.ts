import { test, expect } from '@playwright/test';
import {
  idleRecorderCount,
  parseClipIds,
  parseClipStarts,
  parseMarkers,
  pickMoments,
  playersPerRecorder,
  recorderBusy,
} from '../../api/src/integrations/cs2/demos/highlights';
import { pickTournamentReel } from '../../api/src/integrations/cs2/demos/highlightViews';

/**
 * The highlight picker (api/src/integrations/cs2/demos/highlights.ts) on
 * hand-made kills: no server needed.
 */
const A = '76561198000000001'; // CT
const A2 = '76561198000000002'; // CT
const B1 = '76561198000000003'; // T
const B2 = '76561198000000004'; // T
const B3 = '76561198000000005'; // T
const B4 = '76561198000000006'; // T

const kill = (
  tick: number,
  attacker: string,
  victim: string,
  extra: Record<string, unknown> = {}
) => ({
  tick,
  round: 1,
  attacker,
  victim,
  attackerSide: attacker === A || attacker === A2 ? 'CT' : 'T',
  victimSide: victim === A || victim === A2 ? 'CT' : 'T',
  weapon: 'AK-47',
  ...extra,
});

const rounds = [{ number: 1, startTick: 0, endTick: 20000, winner: 'CT', reason: 't_killed' }];

test.describe('Highlight moments', () => {
  test('a triple kill is a moment; a lone kill is not', { tag: ['@api'] }, () => {
    const kills = [
      kill(500, A2, B4),
      kill(1000, A, B1, { headshot: true }),
      kill(1100, A, B2),
      kill(1200, A, B3),
    ];
    const moments = pickMoments({ kills, rounds } as never);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      playerId: A,
      kind: '3k',
      slowmoTick: 1200,
      killTicks: [1000, 1100, 1200],
    });
    // 3 s before the first kill, 1.5 s after the last.
    expect(moments[0]!.startTick).toBe(1000 - 192);
    expect(moments[0]!.endTick).toBe(1200 + 96);
  });

  test('the last of a side alive winning against two scores as a clutch', { tag: ['@api'] }, () => {
    const kills = [kill(500, B1, A2), kill(2000, A, B1), kill(2400, A, B2)];
    const moments = pickMoments({ kills, rounds } as never);
    expect(moments[0]).toMatchObject({ playerId: A, kind: '2k' });
    expect(moments[0]!.title).toContain('clutch');
    expect(moments[0]!.score).toBeGreaterThan(20 + 25 + 80 - 1);
  });

  test('the last one alive does not clutch a round their side lost', { tag: ['@api'] }, () => {
    const kills = [kill(500, B1, A2), kill(2000, A, B1), kill(2400, A, B2)];
    const lost = [{ ...rounds[0], winner: 'T' }];
    expect(pickMoments({ kills, rounds: lost } as never)[0]!.title).not.toContain('clutch');
  });

  test('kills far apart in one round are still one moment', { tag: ['@api'] }, () => {
    // A 4K over 20 s (as d1Ledez's on Dust2): 11 s between two of the kills.
    const kills = [kill(5316, A, B1), kill(6022, A, B2), kill(6612, A, B3), kill(6627, A, B4)];
    const moments = pickMoments({ kills, rounds } as never);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      kind: '4k',
      killTicks: [5316, 6022, 6612, 6627],
      slowmoTick: 6627,
    });
    expect(moments[0]!.startTick).toBe(5316 - 192);
  });

  test('a team kill with a grenade and dying to your own are funny', { tag: ['@api'] }, () => {
    const moments = pickMoments({
      kills: [
        kill(1000, A, A2, { weapon: 'HE Grenade' }),
        {
          tick: 3000,
          round: 1,
          attacker: null,
          victim: B1,
          attackerSide: null,
          victimSide: 'T',
          weapon: 'Molotov',
        },
        kill(5000, A, B2, { weapon: 'Decoy Grenade' }),
        // A plain team kill with a gun is not.
        kill(7000, B3, B4),
      ] as never,
      rounds: rounds as never,
    });
    const funny = moments.filter((m) => m.kind === 'funny');
    expect(funny.map((m) => [m.playerId, m.title])).toEqual([
      [A, 'Team kill · HE Grenade · round 1'],
      [B1, 'Own grenade · Molotov · round 1'],
      [A, 'Decoy Grenade to the face · round 1'],
    ]);
    expect(funny.every((m) => m.score >= 30 && m.killTicks.length === 1)).toBe(true);
    // Two per player at most.
    const more = pickMoments({
      kills: [1000, 2000, 3000].map((t) => kill(t, A, A2, { weapon: 'Molotov' })) as never,
      rounds: rounds as never,
    });
    expect(more.filter((m) => m.kind === 'funny')).toHaveLength(2);
  });

  test('the recorder headers are checked', { tag: ['@api'] }, () => {
    expect(parseMarkers('{"duration":12.345,"kills":[1,3.333],"slowmo":[3.3,9]}')).toEqual({
      duration: 12.35,
      kills: [1, 3.33],
      slowmo: [3.3, 9],
    });
    expect(parseMarkers('{"duration":-1,"kills":[]}')).toBeNull();
    expect(parseMarkers('not json')).toBeNull();
    expect(parseClipIds('4,7,12')).toEqual([4, 7, 12]);
    expect(parseClipIds('4,x')).toBeNull();
    expect(parseClipIds(undefined)).toBeNull();
  });

  test('the tournament reel builds up to its best play', { tag: ['@api'] }, () => {
    const c = (id: number, playerId: string, kind: string, score: number, clutch = false) => ({
      id,
      playerId,
      kind,
      score,
      clutch,
    });
    const ids = pickTournamentReel([
      c(1, 'p1', 'ace', 400),
      c(2, 'p2', '4k', 200),
      c(3, 'p2', '3k', 120, true),
      c(4, 'p3', 'flair', 45),
      c(5, 'p4', 'funny', 35),
      c(6, 'p5', '2k', 40),
      c(7, 'p5', 'flair', 31),
    ]);
    expect(ids).toHaveLength(7);
    expect(ids[ids.length - 1]).toBe(1);
    // Funny lands inside, not at an end.
    const at = ids.indexOf(5);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(ids.length - 1);
    // No player more than twice.
    const many = pickTournamentReel(
      Array.from({ length: 10 }, (_, i) => c(100 + i, 'same', '3k', 100 + i))
    );
    expect(many).toHaveLength(2);
    // At least one of each kind there is, even when the rest score higher.
    const kinds = pickTournamentReel([
      ...Array.from({ length: 20 }, (_, i) => c(200 + i, `p${i}`, '3k', 150 + i)),
      c(300, 'q1', 'flair', 31),
      c(301, 'q2', 'funny', 35),
      c(302, 'q3', '2k', 60, true),
    ]);
    expect(kinds).toEqual(expect.arrayContaining([300, 301, 302]));
  });
});

test(
  'idle recorders split a map: an even share of its players each, rounded up',
  { tag: ['@api'] },
  () => {
    expect(playersPerRecorder(10, 1)).toBe(10);
    expect(playersPerRecorder(10, 3)).toBe(4);
    expect(playersPerRecorder(10, 6)).toBe(2);
    expect(playersPerRecorder(3, 6)).toBe(1);
    expect(playersPerRecorder(0, 2)).toBe(1);
    // A recorder counts as idle while it polls; one that took a job is busy until it asks again.
    const t0 = 1_000_000;
    expect(idleRecorderCount('rec-a', t0)).toBeGreaterThanOrEqual(1);
    const both = idleRecorderCount('rec-b', t0 + 1000);
    recorderBusy('rec-a');
    expect(idleRecorderCount('rec-b', t0 + 2000)).toBe(both - 1);
    // Silent for longer than the window: gone.
    expect(idleRecorderCount('rec-c', t0 + 200_000)).toBe(1);
  }
);

test('a reel says where each of its clips starts, one per clip, in order', { tag: ['@api'] }, () => {
  expect(parseClipStarts('4.45,14.05,22.1', 3)).toEqual([4.45, 14.05, 22.1]);
  expect(parseClipStarts('4.45,14.05', 3)).toBeNull();
  expect(parseClipStarts('14.05,4.45', 2)).toBeNull();
  expect(parseClipStarts('4.45;14', 2)).toBeNull();
  expect(parseClipStarts(undefined, 1)).toBeNull();
});
