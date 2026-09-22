import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Public team profile page (`/t/team/:teamId`).
 *
 * Distinct from `/team/:teamId` (the team's live match/server page): this is
 * the read-only overview anyone can open — roster with ratings and the
 * current tournament's status. `setupTestContext` only needs an admin
 * session on `request` to seed the fixtures; the page itself is public.
 *
 * @tag ui
 * @tag public
 * @tag teams
 */

test.describe.serial('Team Profile UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'shows the roster and the current tournament for a seeded team',
    { tag: ['@ui', '@public', '@teams'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        prefix: `team-profile-${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
      });
      expect(setup, 'tournament setup should succeed').toBeTruthy();
      const team = setup!.teams[0];

      await page.goto(`/t/team/${team.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('team-profile-page')).toBeVisible({ timeout: 15000 });

      // Header: team name.
      await expect(page.getByTestId('team-profile-header')).toContainText(team.name);

      // Roster: the seeded players, with rating chips.
      const roster = page.getByTestId('team-profile-roster');
      await expect(roster).toBeVisible();
      await expect(roster).toContainText('Player 1');
      await expect(roster.getByTestId('team-profile-roster-row').first()).toBeVisible();

      // Tournaments: the current tournament this team is registered in.
      const tournaments = page.getByTestId('team-profile-tournaments');
      await expect(tournaments).toBeVisible();
      await expect(page.getByTestId('team-profile-current-tournament')).toContainText(
        setup!.tournament.name
      );
    }
  );

  test(
    'shows a not-found message for an unknown team id',
    { tag: ['@ui', '@public', '@teams'] },
    async ({ page }) => {
      await page.goto('/t/team/does-not-exist', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('team-profile-not-found')).toBeVisible({ timeout: 15000 });
    }
  );
});
