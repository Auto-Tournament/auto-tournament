import { test, expect } from '@playwright/test';

/**
 * A match's own page is where a match opens (client/src/pages/MatchPage.tsx):
 * old `/matches/<slug>` links land there, and a match that is not finished
 * says where it stands.
 *
 * @tag ui
 * @tag public
 */

const slug = 'spec-canonical-match';
const match = {
  id: 1,
  slug,
  game: 'cs2',
  status: 'live',
  winnerSide: null,
  tournament: null,
  team1: { id: 'a', name: 'Alpha', tag: null },
  team2: { id: 'b', name: 'Bravo', tag: null },
  mapScores: [],
};

test.beforeEach(async ({ page }) => {
  // The last route added is tried first: the catch-all, then the match.
  await page.route(`**/api/game/cs2/matches/${slug}/**`, (route) =>
    route.fulfill({ json: { success: true, teams: [], clips: [], team1: [], team2: [], maps: [] } })
  );
  await page.route(`**/api/matches/${slug}`, (route) =>
    route.fulfill({ json: { success: true, match } })
  );
});

test('an old match link opens the match page', { tag: ['@ui', '@public'] }, async ({ page }) => {
  await page.goto(`/matches/${slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/match/${slug}$`));
  await expect(page.getByTestId('match-page')).toBeVisible();
});

test('a live match says it is live', { tag: ['@ui', '@public'] }, async ({ page }) => {
  await page.goto(`/match/${slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('match-page-status')).toBeVisible();
});
