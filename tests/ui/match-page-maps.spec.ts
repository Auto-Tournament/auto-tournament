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
            // The veto numbers its picks from 1; the cards go by map name.
            pickedMaps: [
              { mapNumber: 1, mapName: 'de_inferno', pickedBy: 'team1', knifeRound: false },
              { mapNumber: 2, mapName: 'de_nuke', pickedBy: 'team2', knifeRound: false },
              { mapNumber: 3, mapName: 'de_mirage', pickedBy: 'decider', knifeRound: true },
            ],
            actions: [
              { step: 1, team: 'team1', action: 'ban', mapName: 'de_train' },
              { step: 2, team: 'team1', action: 'pick', mapName: 'de_inferno' },
              { step: 3, team: 'team2', action: 'side_pick', mapName: 'de_inferno', side: 'CT' },
              { step: 4, team: 'team2', action: 'pick', mapName: 'de_nuke' },
              { step: 5, team: 'team1', action: 'side_pick', mapName: 'de_nuke', side: 'T' },
              { step: 6, team: 'team2', action: 'ban', mapName: 'de_overpass' },
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

test(
  'a series won 2-0: the third map is not played and says nothing',
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    const done = {
      ...match,
      slug: 'spec-series-done',
      status: 'live', // the series is decided before the match is marked finished
      winnerSide: null,
      maps: ['de_nuke', 'de_train', 'de_inferno'],
      mapNumber: 2,
      mapScores: [
        { mapNumber: 0, map: 'de_nuke', team1Score: 6, team2Score: 4, winner: 'team1' },
        { mapNumber: 1, map: 'de_train', team1Score: 6, team2Score: 2, winner: 'team1' },
      ],
    };
    await page.route('**/api/matches/spec-series-done', (route) =>
      route.fulfill({ json: { success: true, match: done } })
    );
    await page.route('**/api/game/cs2/matches/spec-series-done/**', (route) =>
      route.fulfill({
        json: { success: true, teams: [], clips: [], team1: [], team2: [], maps: [] },
      })
    );
    await page.goto('/match/spec-series-done', { waitUntil: 'domcontentloaded' });
    const third = page.getByTestId('match-page-map-2');
    await expect(third).toHaveAttribute('data-map-state', 'skipped');
    await expect(third).not.toContainText('To play');
    await expect(third).not.toContainText('Live');
    await expect(page.getByTestId('match-page-map-1')).toHaveAttribute('data-map-state', 'played');
  }
);

const emptyCs2 = { success: true, teams: [], clips: [], team1: [], team2: [], maps: [] };

test(
  'the live map shows its rounds, a Live chip and the round; the picks follow the veto',
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    // Map 1 done; map 2 (Dust II) on at 2-4; Inferno is left over. The veto's
    // picks are numbered from 1, and Mirage (map 1) was Alpha's pick.
    const live = {
      ...match,
      slug: 'spec-series-live',
      status: 'live',
      winnerSide: null,
      completedAt: null,
      maps: ['de_mirage', 'de_dust2', 'de_inferno'],
      mapNumber: 1,
      team1MapScore: 2,
      team2MapScore: 4,
      mapScores: [
        { mapNumber: 0, map: 'de_mirage', team1Score: 13, team2Score: 16, winner: 'team2' },
      ],
    };
    await page.route('**/api/matches/spec-series-live', (route) =>
      route.fulfill({ json: { success: true, match: live } })
    );
    await page.route('**/api/game/cs2/matches/spec-series-live/**', (route) =>
      route.fulfill({ json: emptyCs2 })
    );
    await page.route('**/api/veto/spec-series-live', (route) =>
      route.fulfill({
        json: {
          success: true,
          veto: {
            actions: [
              { step: 1, team: 'team1', action: 'ban', mapName: 'de_train' },
              { step: 2, team: 'team2', action: 'ban', mapName: 'de_nuke' },
              { step: 3, team: 'team1', action: 'pick', mapName: 'de_mirage' },
              { step: 4, team: 'team2', action: 'side_pick', mapName: 'de_mirage', side: 'CT' },
              { step: 5, team: 'team2', action: 'pick', mapName: 'de_dust2' },
              { step: 6, team: 'team1', action: 'side_pick', mapName: 'de_dust2', side: 'T' },
              { step: 7, team: 'team2', action: 'ban', mapName: 'de_vertigo' },
              { step: 8, team: 'team1', action: 'ban', mapName: 'de_overpass' },
            ],
          },
        },
      })
    );
    await page.goto('/match/spec-series-live', { waitUntil: 'domcontentloaded' });

    const first = page.getByTestId('match-page-map-0');
    await expect(first).toHaveAttribute('data-map-state', 'played');
    await expect(first).toContainText("Alpha's pick");

    const second = page.getByTestId('match-page-map-1');
    await expect(second).toHaveAttribute('data-map-state', 'live');
    await expect(second).toContainText("Bravo's pick");
    await expect(second).toContainText('Live');
    await expect(second).toContainText('Round 7');
    await expect(page.getByTestId('match-page-map-1-score')).toHaveText('2 : 4');
    await expect(second).not.toContainText('To play');

    const third = page.getByTestId('match-page-map-2');
    await expect(third).toHaveAttribute('data-map-state', 'upcoming');
    await expect(third).toContainText('Decider');
    await expect(third).toContainText('To play');
  }
);

test(
  'a Bo1 with the last map left over: that map is the decider',
  { tag: ['@ui', '@public'] },
  async ({ page }) => {
    const bo1 = {
      ...match,
      slug: 'spec-series-bo1',
      status: 'live',
      winnerSide: null,
      completedAt: null,
      maps: ['de_ancient'],
      mapNumber: 0,
      mapScores: [],
    };
    await page.route('**/api/matches/spec-series-bo1', (route) =>
      route.fulfill({ json: { success: true, match: bo1 } })
    );
    await page.route('**/api/game/cs2/matches/spec-series-bo1/**', (route) =>
      route.fulfill({ json: emptyCs2 })
    );
    await page.route('**/api/veto/spec-series-bo1', (route) =>
      route.fulfill({
        json: {
          success: true,
          veto: {
            actions: [
              { step: 1, team: 'team1', action: 'ban', mapName: 'de_train' },
              { step: 2, team: 'team2', action: 'ban', mapName: 'de_nuke' },
            ],
          },
        },
      })
    );
    await page.goto('/match/spec-series-bo1', { waitUntil: 'domcontentloaded' });
    const only = page.getByTestId('match-page-map-0');
    await expect(only).toHaveAttribute('data-map-state', 'live');
    await expect(only).toContainText('Decider');
  }
);
