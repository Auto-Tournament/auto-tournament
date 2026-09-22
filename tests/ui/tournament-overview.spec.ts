import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTournament } from '../helpers/tournaments';
import { createTestTeams } from '../helpers/teams';

/**
 * Public tournament "Overview" page.
 *
 * `/tournament/:id` is a public route (adminOnly={false}): the page renders
 * from the tournament's public leaderboard payload, and a section (About,
 * Rules, Prizes, Schedule) only shows up when the organizer actually filled
 * it in — no "—" placeholders on the real page.
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
    'shows description, rules, prizes and schedule when the organizer set them',
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
      await expect(page.getByTestId('overview-rules')).toBeVisible();
      await expect(page.getByTestId('overview-prizes')).toBeVisible();
      await expect(page.getByTestId('overview-prizes')).toContainText('$500');
      await expect(page.getByTestId('overview-schedule')).toBeVisible();
    }
  );

  test(
    'hides About, Rules and Prizes when the organizer set none of them',
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
      await expect(page.getByTestId('overview-rules')).toHaveCount(0);
      await expect(page.getByTestId('overview-prizes')).toHaveCount(0);
      await expect(page.getByTestId('overview-schedule')).toHaveCount(0);

      // The facts grid (teams, format, etc.) is derived from the tournament
      // itself, so it should still show up even with no organizer content.
      await expect(page.getByTestId('overview-facts')).toBeVisible();
    }
  );
});
