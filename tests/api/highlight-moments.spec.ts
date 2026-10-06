import { test, expect } from '@playwright/test';
import { pickMoments } from '../../api/src/integrations/cs2/demos/highlights';

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

  test('a long run is cut to its last 10 s', { tag: ['@api'] }, () => {
    const kills = [kill(1000, A, B1), kill(1600, A, B2), kill(2200, A, B3)];
    const m = pickMoments({ kills, rounds } as never)[0]!;
    expect(m.endTick - m.startTick).toBeLessThanOrEqual(640);
    expect(m.endTick).toBe(2200 + 96);
  });
});
