import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  findMoments,
  isKnifeRound,
  killKind,
  MOMENT_KINDS,
  type MomentReplay,
} from '../../api/src/integrations/cs2/demos/moments';
import { momentId } from '../../api/src/integrations/cs2/demos/momentStore';

/**
 * The notable moments for integrators (api/src/integrations/cs2/demos/moments.ts)
 * on a fixture map shaped like the worker's output (tests/fixtures/moments/map.json):
 * a knife round, then rounds with a knife kill, a Zeus kill, a team kill and a
 * kill on a bot, an ace with an HE grenade in it, a no-scope and a 1v3 clutch,
 * molotov and incendiary kills, and two defuses (one with half a second left).
 * No server needed.
 *
 * @tag api
 */

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'moments', 'map.json'), 'utf8')
) as { analysis: { rounds: never[]; kills: never[] }; replay: MomentReplay };

const A = (n: number) => `7656119800000001${n}`;
const B = (n: number) => `7656119800000002${n}`;

const moments = findMoments(fixture.analysis, fixture.replay);
const of = (kind: string) => moments.filter((m) => m.kind === kind);

test.describe('Highlights for integrators: the parse rules', () => {
  test('knife_kill: an enemy knifed in a real round', { tag: ['@api'] }, () => {
    expect(of('knife_kill')).toEqual([
      expect.objectContaining({
        round: 2,
        playerId: A(1),
        victimId: B(1),
        weapon: 'Knife',
        tick: 13000,
      }),
      expect.objectContaining({ round: 6, playerId: A(1), victimId: B(1) }),
    ]);
  });

  test(
    'no knife round, no team kill, no bot, nothing after the last round',
    { tag: ['@api'] },
    () => {
      expect(moments.some((m) => m.round === 1)).toBe(false);
      expect(moments.some((m) => m.round === 7)).toBe(false);
      expect(moments.some((m) => m.playerId === B(3) && m.victimId === B(4))).toBe(false);
      expect(moments.some((m) => m.victimId?.startsWith('bot:'))).toBe(false);
      expect(
        isKnifeRound(fixture.analysis.kills.filter((k: { round: number }) => k.round === 1))
      ).toBe(true);
      // One knife kill in a pistol round is a knife kill, not a knife round.
      expect(isKnifeRound([{ weapon: 'Knife' }])).toBe(false);
      expect(isKnifeRound([{ weapon: 'Knife' }, { weapon: 'Knife' }, { weapon: 'Glock-18' }])).toBe(
        false
      );
    }
  );

  test('zeus_kill', { tag: ['@api'] }, () => {
    expect(of('zeus_kill')).toEqual([
      expect.objectContaining({ round: 2, playerId: A(2), victimId: B(2), weapon: 'Zeus x27' }),
    ]);
  });

  test('ace: one player kills all five', { tag: ['@api'] }, () => {
    expect(of('ace')).toEqual([
      expect.objectContaining({
        round: 3,
        playerId: B(1),
        victimId: null,
        tick: 20000 + 3000 + 4 * 300,
        detail: { kills: 5, weapons: ['AK-47', 'HE Grenade'] },
      }),
    ]);
  });

  test('clutch_1vN: last alive against three, round won', { tag: ['@api'] }, () => {
    const expected = expect.objectContaining({
      round: 4,
      playerId: A(5),
      tick: 30000 + 3600,
      detail: { against: 3, kills: 3 },
    });
    expect(of('clutch_1vN')).toEqual([expected]);
    // Without the replay the teams come from the kills: the same clutch.
    expect(findMoments(fixture.analysis).filter((m) => m.kind === 'clutch_1vN')).toEqual([
      expected,
    ]);
  });

  test('a 1v2, or a lost 1v3, is no clutch', { tag: ['@api'] }, () => {
    const side = (id: string) => (id.startsWith('7656119800000001') ? 'CT' : 'T');
    const k = (tick: number, attacker: string, victim: string) => ({
      tick,
      round: 1,
      attacker,
      victim,
      weapon: 'AK-47',
      attackerSide: side(attacker),
      victimSide: side(victim),
    });
    const round = (winner: string) => [{ number: 1, startTick: 0, endTick: 10000, winner }];
    const clutch = (winner: string, kills: ReturnType<typeof k>[]) =>
      findMoments({ rounds: round(winner), kills }).filter((m) => m.kind === 'clutch_1vN');
    const teamDown = [
      k(1001, B(1), A(1)),
      k(1002, B(2), A(2)),
      k(1003, B(3), A(3)),
      k(1004, B(3), A(4)),
    ];
    // A5 alone against B1, B2 and B3; B3 kills A5 and T win: lost.
    const lost = [k(900, A(5), B(5)), k(910, A(5), B(4)), ...teamDown, k(1100, B(3), A(5))];
    expect(clutch('T', lost)).toEqual([]);
    // The same 1v3 won: a clutch.
    expect(clutch('CT', lost.slice(0, -1))).toEqual([
      expect.objectContaining({ playerId: A(5), detail: { against: 3, kills: 0 } }),
    ]);
    // Won, but only B1 and B2 were left: a 1v2.
    const twoLeft = [
      ...[5, 4, 3].map((n) => k(900 + n, A(5), B(n))),
      ...[1, 2, 3, 4].map((n) => k(1000 + n, n < 3 ? B(1) : B(2), A(n))),
    ];
    expect(clutch('CT', twoLeft)).toEqual([]);
  });

  test('noscope_kill: a sniper kill without scoping in', { tag: ['@api'] }, () => {
    expect(of('noscope_kill')).toEqual([
      expect.objectContaining({ round: 4, playerId: A(5), victimId: B(1), weapon: 'AWP' }),
    ]);
    expect(killKind({ weapon: 'AWP', noScope: false })).toBeNull();
    expect(killKind({ weapon: 'Deagle', noScope: true })).toBeNull();
    expect(killKind({ weapon: 'SSG 08', noScope: true })).toBe('noscope_kill');
  });

  test('grenade_kill: HE, molotov, incendiary', { tag: ['@api'] }, () => {
    expect(of('grenade_kill').map((m) => [m.round, m.playerId, m.weapon])).toEqual([
      [3, B(1), 'HE Grenade'],
      [5, B(1), 'Molotov'],
      [5, A(2), 'Incendiary Grenade'],
    ]);
  });

  test(
    'bomb_defuse_last_second: under a second left, the defuser from the replay',
    { tag: ['@api'] },
    () => {
      // Round 5: no player on the event; A3 is the CT next to the bomb.
      expect(of('bomb_defuse_last_second')).toEqual([
        expect.objectContaining({
          round: 5,
          playerId: A(3),
          victimId: null,
          detail: { secondsLeft: 0.5, site: 'B' },
        }),
      ]);
      // Round 6 had five seconds left.
      expect(of('bomb_defuse_last_second').some((m) => m.round === 6)).toBe(false);
      // Without a replay there are no bomb events: nothing to find.
      expect(findMoments(fixture.analysis).some((m) => m.kind === 'bomb_defuse_last_second')).toBe(
        false
      );
    }
  );

  test('every kind has a rule, and the fixture finds each of them', { tag: ['@api'] }, () => {
    expect(new Set(moments.map((m) => m.kind))).toEqual(new Set(MOMENT_KINDS));
  });

  test('a re-parse finds the same moments under the same ids', { tag: ['@api'] }, () => {
    const again = findMoments(JSON.parse(JSON.stringify(fixture.analysis)), fixture.replay);
    expect(again.map((m) => m.key)).toEqual(moments.map((m) => m.key));
    // The id leaves the tick out: a demo read a few ticks apart is the same moment.
    const shifted = fixture.analysis.kills.map((k: { tick: number }) => ({
      ...k,
      tick: k.tick + 3,
    }));
    const keys = new Set(findMoments({ ...fixture.analysis, kills: shifted }).map((m) => m.key));
    for (const m of of('knife_kill')) expect(keys.has(m.key)).toBe(true);
    const ids = moments.map((m) => momentId(42, 0, m.key));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^hl_[0-9a-f]{24}$/);
    // Another match row under the same slug (slugs come back): other ids.
    expect(momentId(43, 0, moments[0]!.key)).not.toBe(ids[0]);
  });
});
