import { test, expect } from '@playwright/test';
import { KEEP_AFTER_S, spacePlan } from '../../api/src/addons/discord/tournamentSpacePlan';

/**
 * A tournament's own category on the Discord server: made when it starts,
 * kept a few days after it ends, then removed.
 *
 * @tag api
 */
test('spaces are made for running tournaments and removed days after they end', () => {
  const now = 1_800_000_000;
  const plan = spacePlan(
    [
      { id: 1, status: 'in_progress', completedAt: null },
      { id: 2, status: 'completed', completedAt: now - 60 },
      { id: 3, status: 'completed', completedAt: now - KEEP_AFTER_S - 60 },
      { id: 4, status: 'setup', completedAt: null },
    ],
    [2, 3, 5],
    now
  );
  // 1 runs and has none yet; 2 ended a minute ago (kept); 3 ended days ago and 5 is gone (removed).
  expect(plan.make).toEqual([1]);
  expect(plan.remove).toEqual([3, 5]);
});
