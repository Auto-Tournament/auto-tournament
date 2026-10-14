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

test(
  "a series' maps show in play order: picks, the winner and rounds, the live map and the rest",
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    const live = {
      ...match,
      slug: 'spec-series-maps',
      status: 'live',
      winnerSide: null,
      completedAt: null,
      maps: ['de_inferno', 'de_nuke', 'de_mirage'],
      mapNumber: 1,
      // Map 1 level after overtime: Bravo won it on damage.
      mapScores: [
        { mapNumber: 0, map: 'de_inferno', team1Score: 18, team2Score: 18, winner: 'team2' },
      ],
    };
    await page.route('**/api/matches/spec-series-maps', (route) =>
      route.fulfill({ json: { success: true, match: live } })
    );
    await page.route('**/api/game/cs2/matches/spec-series-maps/**', (route) =>
      route.fulfill({
        json: { success: true, teams: [], clips: [], team1: [], team2: [], maps: [] },
      })
    );
    await page.route('**/api/veto/spec-series-maps', (route) =>
      route.fulfill({
        json: {
          success: true,
          veto: {
            pickedMaps: [
              { mapNumber: 0, mapName: 'de_inferno', pickedBy: 'team1', knifeRound: false },
              { mapNumber: 1, mapName: 'de_nuke', pickedBy: 'team2', knifeRound: false },
              { mapNumber: 2, mapName: 'de_mirage', pickedBy: 'decider', knifeRound: true },
            ],
          },
          maps: [],
        },
      })
    );
    await page.goto('/match/spec-series-maps', { waitUntil: 'domcontentloaded' });

    const first = page.getByTestId('match-page-map-0');
    await expect(first).toHaveAttribute('data-map-state', 'played');
    await expect(first).toContainText('Inferno');
    await expect(first).toContainText("Alpha's pick");
    await expect(first).toContainText('Bravo won');
    await expect(first).toContainText('won on damage');
    await expect(page.getByTestId('match-page-map-0-score')).toHaveText('18 : 18');

    const second = page.getByTestId('match-page-map-1');
    await expect(second).toHaveAttribute('data-map-state', 'live');
    await expect(second).toContainText("Bravo's pick");
    await expect(second).toContainText('Live');

    const third = page.getByTestId('match-page-map-2');
    await expect(third).toHaveAttribute('data-map-state', 'upcoming');
    await expect(third).toContainText('Decider');
    await expect(third).toContainText('To play');
  }
);
