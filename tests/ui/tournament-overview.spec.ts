import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTournament } from '../helpers/tournaments';
import { createTestTeams } from '../helpers/teams';

/**
 * Public tournament "Overview" page.
 *
 * `/tournament/:id` is a public route (adminOnly={false}): the page renders
 * from the tournament's public leaderboard payload. The header carries the
 * description; the overview has the key dates, the map pool and the schedule
 * as a calendar; rules are on their own tab. A section only shows up when the
 * organizer filled it in.
 *
 * @tag ui
 * @tag public
 * @tag tournament
 */

test.describe.serial('Tournament Overview UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'shows the description, map pool, schedule calendar and a Rules tab when the organizer set them',
    { tag: ['@ui', '@public', '@tournament'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'overview-filled');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Overview Filled ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
        settings: {
          description: 'The spring LAN main event.',
          location: 'On site, Trondheim',
          rules: ['Be ready 10 minutes after your match is called.'],
          prizes: [{ place: '1st', prize: '$500' }],
          schedule: [{ at: '2026-04-05T14:00:00.000Z', label: 'Quarterfinals' }],
        },
      });
      expect(tournament).toBeTruthy();

      await page.goto(`/tournament/${tournament!.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('public-tournament-overview')).toBeVisible({ timeout: 15000 });

      await expect(page.getByTestId('overview-about')).toBeVisible();
      await expect(page.getByTestId('overview-about')).toContainText('spring LAN main event');
      await expect(page.getByTestId('overview-key-starts')).toBeVisible();
      await expect(page.getByTestId('overview-schedule')).toBeVisible();
      await expect(page.getByTestId('schedule-event')).toContainText('Quarterfinals');

      // The map pool is a row of icons; it opens the maps with their pictures.
      await page.getByTestId('overview-map-pool').click();
      await expect(page.getByTestId('map-pool-dialog-maps')).toContainText('Mirage');
      await page.keyboard.press('Escape');

      await page.getByTestId('tournament-tab-rules').click();
      await expect(page.getByTestId('overview-rules')).toContainText('Be ready 10 minutes');
    }
  );

  test(
    'hides the description, schedule and Rules tab when the organizer set none of them',
    { tag: ['@ui', '@public', '@tournament'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'overview-empty');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Overview Empty ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();

      await page.goto(`/tournament/${tournament!.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('public-tournament-overview')).toBeVisible({ timeout: 15000 });

      await expect(page.getByTestId('overview-about')).toHaveCount(0);
      // No schedule: a placeholder keeps its place on the page.
      await expect(page.getByTestId('overview-schedule')).toHaveCount(0);
      await expect(page.getByTestId('overview-schedule-empty')).toBeVisible();
      await expect(page.getByTestId('tournament-tab-rules')).toHaveCount(0);

      // The team count and the map pool come from the tournament itself, so
      // they show up even with no organizer content.
      await expect(page.getByTestId('overview-key-teams')).toContainText('2');
      await expect(page.getByTestId('overview-map-pool')).toBeVisible();
    }
  );

  test(
    'has one H1 on the banner header, and Overview and Teams before the start',
    { tag: ['@ui', '@public', '@tournament'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'overview-tabs');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const name = `Overview Tabs ${Date.now()}`;
      const tournament = await createTournament(request, {
        name,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
        settings: { organizer: 'Edition 35 LAN', location: 'On site, Trondheim' },
      });
      expect(tournament).toBeTruthy();
      const id = tournament!.id;

      await page.goto(`/tournament/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, { timeout: 15000 });
      await expect(page.getByTestId('tournament-hero')).toBeVisible();
      await expect(page.getByTestId('tournament-game')).toBeVisible();
      await expect(page.getByTestId('tournament-tab-overview')).toHaveAttribute('aria-current', 'page');
      // "Your match" is only for a player whose team is in a running tournament.
      await expect(page.getByTestId('tournament-tab-match')).toHaveCount(0);
      // Before it starts: the page and who is in, nothing to follow yet.
      await expect(page.getByTestId('tournament-tab-teams')).toBeVisible();
      await expect(page.getByTestId('tournament-tab-matches')).toHaveCount(0);
      await expect(page.getByTestId('tournament-tab-bracket')).toHaveCount(0);

      await page.getByTestId('tournament-tab-teams').click();
      await expect(page.getByTestId(`public-team-${team2.id}`)).toBeVisible();

      // Leaderboard was renamed Standings; the old address still lands there.
      await page.goto(`/tournament/${id}/leaderboard`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`/tournament/${id}/standings$`));
    }
  );
});
