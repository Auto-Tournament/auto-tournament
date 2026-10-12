import { test, expect } from '@playwright/test';
import { categoryValue, rank } from '../../api/src/integrations/cs2/routes/leaderboards';

/**
 * CS2's category leaderboards (api/src/integrations/cs2/routes/leaderboards.ts):
 * each category's qualification, competition ranking for ties, and the
 * endpoint's shape.
 */

const TAGS = { tag: ['@api'] };
const totals = (over: Record<string, number> = {}) => ({
  player_id: '76561190000000001',
  name: 'P',
  avatar_url: null,
  maps: 3,
  rounds_played: 60,
  kills: 60,
  deaths: 40,
  assists: 10,
  damage: 5100,
  kast_rounds: 45,
  headshot_kills: 30,
  entry_kills: 8,
  entry_deaths: 4,
  clutches_won: 2,
  clutches_played: 6,
  ...over,
});

test('each category has its own qualification', TAGS, () => {
  expect(categoryValue('adr', totals())).toEqual({ value: 85, sample: 60 });
  expect(categoryValue('kd', totals())).toEqual({ value: 1.5, sample: 100 });
  expect(categoryValue('hs', totals())).toEqual({ value: 50, sample: 60 });
  expect(categoryValue('opening', totals())).toEqual({ value: 67, sample: 12 });
  expect(categoryValue('clutch', totals())).toEqual({ value: 33, sample: 6 });
  expect(categoryValue('kast', totals())).toEqual({ value: 75, sample: 60 });
  expect(categoryValue('rating', totals())?.value).toBeGreaterThan(0);
  // Too few maps or rounds: no category.
  expect(categoryValue('adr', totals({ maps: 2 }))).toBeNull();
  expect(categoryValue('adr', totals({ rounds_played: 30 }))).toBeNull();
  // Too few kills, duels or clutches for those.
  expect(categoryValue('hs', totals({ kills: 49 }))).toBeNull();
  expect(categoryValue('opening', totals({ entry_kills: 5, entry_deaths: 4 }))).toBeNull();
  expect(categoryValue('clutch', totals({ clutches_played: 4 }))).toBeNull();
});

test('ties share a rank', TAGS, () => {
  expect(rank([{ value: 9 }, { value: 7 }, { value: 7 }, { value: 5 }]).map((r) => r.rank)).toEqual(
    [1, 2, 2, 4]
  );
});

test('the endpoint answers every category', TAGS, async ({ request }) => {
  for (const category of ['rating', 'adr', 'kd', 'hs', 'opening', 'clutch', 'kast']) {
    const res = await request.get(`/api/game/cs2/leaderboards?category=${category}&limit=5`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, category, minMaps: 3, minRounds: 40 });
    expect(body.players.length).toBeLessThanOrEqual(5);
  }
});
