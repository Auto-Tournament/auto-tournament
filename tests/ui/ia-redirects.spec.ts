import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Public pages that moved (2026-10, one home per page): the old addresses
 * land on the new ones and keep their query.
 *
 * @tag ui
 */

const TAGS = { tag: ['@ui'] };

test.describe('Moved public addresses', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  const moved: Array<[string, RegExp]> = [
    ['/browse', /\/tournaments$/],
    ['/browse?status=live', /\/tournaments\?status=live$/],
    ['/browse/teams', /\/community\/teams$/],
    ['/browse/players', /\/community\/players$/],
    ['/play/leaderboard', /\/leaderboards\?mode=matchmaking$/],
  ];

  for (const [from, to] of moved) {
    test(`${from} lands on its new address`, TAGS, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    });
  }

  test(
    'the old /player directory address lands on the players directory',
    TAGS,
    async ({ page }) => {
      await page.goto('/player');
      await expect(page).toHaveURL(/\/community\/players$/);
    }
  );
});
