import { test, expect } from '@playwright/test';
import { rating } from 'openskill';
import {
  computeTeamRatingUpdate,
  openSkillToDisplayElo,
  ratingRollbacks,
  type PlayerSkill,
  type RatingHistoryRow,
} from '../../api/src/utils/ratingMath';
import { buildEloProgression, ratingHistoryBaseline } from '../../client/src/utils/eloProgression';

/**
 * QA 2.4.11 saw a team lose and "go 1500 -> 2163". The update itself is
 * right; tournament reset deleted matches (and, by cascade, rating history)
 * but left players' ratings, so each simulated run stacked on the last while
 * the page compared against the 1500 seed. Reset now rolls ratings back, and
 * the player page anchors its baseline on the starting rating.
 *
 * @tag api
 * @tag regression
 */

const team = (mu: number, sigma: number, n = 5): PlayerSkill[] =>
  Array.from({ length: n }, () => ({ mu, sigma }));

const display = (p: PlayerSkill) => openSkillToDisplayElo(rating(p));

test.describe('Rating result component', () => {
  for (const [label, skill] of [
    ['fresh players', { mu: 25, sigma: 8.333 }],
    ['experienced players', { mu: 27, sigma: 5 }],
    ['settled players', { mu: 12, sigma: 2 }],
  ] as const) {
    test(`equal teams (${label}): loser never gains, winner gains more`, () => {
      for (const team1Won of [true, false]) {
        const before = display(skill);
        const [t1, t2] = computeTeamRatingUpdate(team(skill.mu, skill.sigma), team(skill.mu, skill.sigma), team1Won);
        const winners = team1Won ? t1 : t2;
        const losers = team1Won ? t2 : t1;
        for (const r of losers) expect(openSkillToDisplayElo(r) - before).toBeLessThanOrEqual(0);
        for (const r of winners) expect(openSkillToDisplayElo(r) - before).toBeGreaterThan(0);
        expect(openSkillToDisplayElo(winners[0]) - before).toBeGreaterThanOrEqual(
          openSkillToDisplayElo(losers[0]) - before
        );
      }
    });
  }

  test('an underdog losing to a much stronger team still does not gain', () => {
    const strong = team(32, 7.5);
    const weak = team(20, 7.8);
    const [, losers] = computeTeamRatingUpdate(strong, weak, true);
    expect(openSkillToDisplayElo(losers[0])).toBeLessThanOrEqual(display(weak[0]));
  });
});

test.describe('Tournament reset rolls ratings back', () => {
  const row = (
    player_id: string,
    match_slug: string,
    created_at: number,
    elo_before: number,
    id: number
  ): RatingHistoryRow => ({
    player_id,
    match_slug,
    created_at,
    elo_before,
    mu_before: elo_before / 60,
    sigma_before: 8,
    id,
  });

  test('restores the rating before each player\'s first match of the tournament', () => {
    const rows = [
      row('echo1', 'r2m1', 200, 1799, 5),
      row('echo1', 'r1m3', 100, 1500, 2),
      row('alpha1', 'r1m1', 100, 1743, 1),
      // Duplicate history row for the same match counts once.
      row('echo1', 'r2m1', 201, 1799, 6),
    ];
    const result = new Map(ratingRollbacks(rows).map((r) => [r.playerId, r]));
    expect(result.get('echo1')).toEqual({ playerId: 'echo1', elo: 1500, mu: 25, sigma: 8, matches: 2 });
    expect(result.get('alpha1')).toMatchObject({ elo: 1743, matches: 1 });
  });

  test('same timestamp (simulated matches) falls back to insertion order', () => {
    const [rb] = ratingRollbacks([row('p', 'r1m2', 100, 1600, 9), row('p', 'r1m1', 100, 1500, 3)]);
    expect(rb.elo).toBe(1500);
  });

  test('nothing rated: nothing to roll back', () => {
    expect(ratingRollbacks([])).toEqual([]);
  });
});

test.describe('Player page rating baseline', () => {
  test('baseline and chart start at the starting rating, not the first history row', () => {
    // Alpha 1: seeded 1500, history window starts at 1743, now 1625.
    expect(ratingHistoryBaseline(1500)).toBe(1500);
    const chart = buildEloProgression(
      [{ eloBefore: 1743, baseEloAfter: 1625, createdAt: 100 }],
      1625,
      1500
    );
    expect(chart.points[0]).toEqual({ elo: 1500, role: 'start' });
    expect(chart.minElo).toBe(1500);
    expect(chart.maxElo).toBe(1743);
    expect(chart.totalChange).toBe(125);
  });

  test('a first match starting at the seed is not plotted twice', () => {
    const chart = buildEloProgression(
      [
        { eloBefore: 1799, baseEloAfter: 1600, createdAt: 200 },
        { eloBefore: 1500, baseEloAfter: 1799, createdAt: 100 },
      ],
      1600,
      1500
    );
    expect(chart.points.map((p) => p.elo)).toEqual([1500, 1799, 1799, 1600, 1600]);
    expect(chart.totalChange).toBe(100);
  });
});
