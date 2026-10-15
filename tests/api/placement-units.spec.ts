import { test, expect } from '@playwright/test';
import { teamPlacement, type PlacementMatch } from '../../client/src/utils/placement';

/** "Your team placed #X" (client/src/utils/placement.ts). Pure, no page. */
test.describe('Team placement', () => {
  const m = (
    slug: string,
    round: number,
    t1: string,
    t2: string,
    winner: string | null,
    bracket: string | null = null
  ): PlacementMatch => ({
    slug,
    round,
    bracket,
    status: winner ? 'completed' : 'pending',
    team1Id: t1,
    team2Id: t2,
    winnerId: winner,
  });
  const se = { teamCount: 4, double: false };

  test('single elimination, four teams', () => {
    const semis = [m('r1m1', 1, 'a', 'b', 'a'), m('r1m2', 1, 'c', 'd', 'c')];
    // Semi-final losers share 3rd as soon as they are out, final or not.
    expect(teamPlacement([...semis, m('r2m1', 2, 'a', 'c', null)], 'b', se)).toEqual({
      place: 3,
      placeTo: 4,
      champion: false,
    });
    // Still in: the finalists.
    expect(teamPlacement([...semis, m('r2m1', 2, 'a', 'c', null)], 'a', se)).toBeNull();
    const all = [...semis, m('r2m1', 2, 'a', 'c', 'c')];
    expect(teamPlacement(all, 'a', se)).toEqual({ place: 2, placeTo: 2, champion: false });
    expect(teamPlacement(all, 'c', { ...se, championId: 'c' })?.champion).toBe(true);
  });

  test('single elimination with byes (six teams)', () => {
    const matches = [
      m('r1m1', 1, 'c', 'd', 'c'),
      m('r1m2', 1, 'e', 'f', 'e'),
      m('r2m1', 2, 'a', 'c', 'a'),
      m('r2m2', 2, 'b', 'e', 'b'),
      m('r3m1', 3, 'a', 'b', null),
    ];
    const six = { teamCount: 6, double: false };
    expect(teamPlacement(matches, 'd', six)).toEqual({ place: 5, placeTo: 6, champion: false });
    expect(teamPlacement(matches, 'c', six)).toEqual({ place: 3, placeTo: 4, champion: false });
  });

  test('single elimination with a third-place match', () => {
    const matches = [
      m('r1m1', 1, 'a', 'b', 'a'),
      m('r1m2', 1, 'c', 'd', 'c'),
      m('r2m1', 2, 'a', 'c', 'a'),
      m('r2m2', 2, 'b', 'd', 'd'),
    ];
    const opts = { ...se, thirdPlaceMatch: true };
    expect(teamPlacement(matches, 'd', opts)).toEqual({ place: 3, placeTo: 3, champion: false });
    expect(teamPlacement(matches, 'b', opts)).toEqual({ place: 4, placeTo: 4, champion: false });
    expect(teamPlacement(matches, 'c', opts)).toEqual({ place: 2, placeTo: 2, champion: false });
  });

  test('double elimination: a winners-bracket loss keeps the team in', () => {
    const de = { teamCount: 4, double: true };
    const matches = [
      m('r1m1', 1, 'a', 'b', 'a', 'WB'),
      m('r1m2', 1, 'c', 'd', 'c', 'WB'),
      m('r2m1', 2, 'a', 'c', 'a', 'WB'),
      m('lb-r1m1', 1, 'b', 'd', 'b', 'LB'),
      m('lb-r2m1', 2, 'c', 'b', null, 'LB'),
    ];
    expect(teamPlacement(matches, 'b', de)).toBeNull();
    expect(teamPlacement(matches, 'd', de)).toEqual({ place: 4, placeTo: 4, champion: false });
    const later = [
      ...matches.slice(0, 4),
      m('lb-r2m1', 2, 'c', 'b', 'c', 'LB'),
      m('gf', 1, 'a', 'c', 'a', 'GF'),
    ];
    expect(teamPlacement(later, 'b', de)).toEqual({ place: 3, placeTo: 3, champion: false });
    expect(teamPlacement(later, 'c', { ...de, championId: 'a' })).toEqual({
      place: 2,
      placeTo: 2,
      champion: false,
    });
  });
});
