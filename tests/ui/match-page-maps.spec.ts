import { test, expect } from '@playwright/test';

/**
 * The public match page's maps (client/src/pages/MatchPage.tsx): each map
 * carries the game's controls (CS2: the map's analysis with its 2D replay,
 * and its match reel), so a map's own stats are one click away.
 *
 * @tag ui
 * @tag public
 */

const slug = 'spec-map-links';
const match = {
  id: 1,
  slug,
  game: 'cs2',
  status: 'completed',
  winnerSide: 'team1',
  completedAt: 1760000000,
  tournament: null,
  team1: { id: 'a', name: 'Alpha' },
  team2: { id: 'b', name: 'Bravo' },
  mapScores: [
    { mapNumber: 0, map: 'de_inferno', team1Score: 13, team2Score: 7 },
    { mapNumber: 1, map: 'de_nuke', team1Score: 13, team2Score: 10 },
  ],
};

test('each map links to its analysis', { tag: ['@ui', '@public'] }, async ({ page }) => {
  await page.route(`**/api/matches/${slug}`, (route) =>
    route.fulfill({ json: { success: true, match } })
  );
  // The last route added is tried first: the catch-all, then the analysis.
  await page.route(`**/api/game/cs2/matches/${slug}/**`, (route) =>
    route.fulfill({ json: { success: true, teams: [], clips: [], team1: [], team2: [], maps: [] } })
  );
  await page.route(`**/api/game/cs2/matches/${slug}/maps/*/analysis`, (route) =>
    route.fulfill({ json: { success: true, status: 'done' } })
  );
  await page.goto(`/match/${slug}`, { waitUntil: 'domcontentloaded' });

  for (const n of [0, 1]) {
    const link = page.getByTestId(`match-page-map-${n}`).getByTestId(`demo-analysis-link-${n}`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/analysis/${slug}/${n}`);
  }
});
