import { test, expect } from '@playwright/test';

/**
 * The highlights library (`/highlights`, CS2's site page): every clip and
 * reel, sorted and filtered, reachable from the main navigation.
 *
 * @tag ui
 * @tag public
 */

const item = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind,
  video: '/api/game/cs2/highlights/1.mp4',
  play: kind === 'clip' ? '4k' : null,
  title: kind === 'clip' ? '4 kills · AK-47' : null,
  round: kind === 'clip' ? 7 : null,
  matchSlug: 'spec-lib',
  mapNumber: 0,
  map: 'de_inferno',
  playerId: '76561190000000001',
  playerName: 'Spec player',
  avatarUrl: null,
  teamId: null,
  teamName: null,
  team1: 'Alpha',
  team2: 'Bravo',
  tournamentId: null,
  tournament: null,
  createdAt: 1760000000,
  views: 12,
  likes: 3,
  liked: false,
  ...extra,
});

test(
  'the library lists clips and reels and sorts them',
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    const asked: string[] = [];
    await page.route('**/api/game/cs2/library?**', (route) => {
      asked.push(new URL(route.request().url()).search);
      return route.fulfill({
        json: {
          success: true,
          total: 2,
          page: 1,
          limit: 24,
          items: [item('clip/1', 'clip'), item('match/spec-lib/0', 'map')],
        },
      });
    });
    await page.goto('/browse', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-cs2-highlights').first().click();
    await expect(page).toHaveURL(/\/highlights$/);
    await expect(page.getByTestId('library-grid').getByRole('link')).toHaveCount(2);

    await page
      .getByTestId('library-sort')
      .getByRole('button', { name: /most viewed/i })
      .click();
    await expect(page).toHaveURL(/sort=views/);
    await expect.poll(() => asked.some((q) => q.includes('sort=views'))).toBe(true);
  }
);

test(
  'a filter narrows the library and can be removed',
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    await page.route('**/api/game/cs2/library?**', (route) =>
      route.fulfill({ json: { success: true, total: 0, page: 1, limit: 24, items: [] } })
    );
    await page.goto('/highlights?team=spec-team', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('library-filter-team')).toBeVisible();
    await expect(page.getByTestId('library-empty')).toBeVisible();
    await page.getByTestId('library-filter-team').locator('svg').last().click();
    await expect(page).toHaveURL(/\/highlights$/);
  }
);
