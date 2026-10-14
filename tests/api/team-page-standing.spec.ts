import { test, expect } from '@playwright/test';
import { computeTeamStanding, globalMatchNumbers } from '../../api/src/utils/teamPage';

/**
 * The team page ranks a team among the teams in its tournament and numbers its
 * history chronologically (QA, MAT 2.4.10).
 *
 * @tag api
 * @tag regression
 */
test.describe('Team page standing and numbering', () => {
  const tournamentTeams = ['a', 'b', 'c', 'd'];
  const wins = new Map([
    ['a', 1],
    ['b', 3],
    ['outsider', 9],
    ['c', 2],
  ]);

  test('ranks only teams in the tournament', () => {
    expect(computeTeamStanding('a', tournamentTeams, wins)).toEqual({
      position: 3,
      totalTeams: 4,
      wins: 1,
    });
    expect(computeTeamStanding('outsider', tournamentTeams, wins)).toBeNull();
  });

  test('uses the Swiss standings order when given', () => {
    const swiss = [
      { teamId: 'c', wins: 2 },
      { teamId: 'outsider', wins: 2 },
      { teamId: 'a', wins: 1 },
    ];
    expect(computeTeamStanding('a', tournamentTeams, wins, swiss)).toEqual({
      position: 2,
      totalTeams: 2,
      wins: 1,
    });
  });

  test('numbers history chronologically, not per round', () => {
    const numbers = globalMatchNumbers([
      { id: 3, slug: 'r2m1', round: 2, match_number: 1 },
      { id: 1, slug: 'r1m1', round: 1, match_number: 1 },
      { id: 2, slug: 'r1m2', round: 1, match_number: 2 },
    ]);
    expect(numbers.get('r1m1')).toBe(1);
    expect(numbers.get('r1m2')).toBe(2);
    expect(numbers.get('r2m1')).toBe(3);
  });
});
