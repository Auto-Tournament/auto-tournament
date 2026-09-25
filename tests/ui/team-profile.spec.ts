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

      // Header: the team's name is the page's H1, and its game is named.
      await expect(page.getByRole('heading', { level: 1 })).toContainText(team.name);
      await expect(page.getByTestId('team-profile-game')).toBeVisible();

      // Roster: the seeded players as one row list, with rating chips, and
      // CS2's line about each member's Steam account (the module's
      // `rosterMemberStatus` slot; the seeded players all have a Steam ID64).
      const roster = page.getByTestId('team-profile-roster');
      await expect(roster).toBeVisible();
      await expect(roster).toHaveJSProperty('tagName', 'UL');
      await expect(roster).toContainText('Player 1');
      await expect(roster.getByTestId('team-profile-roster-row').first()).toBeVisible();
      await expect(roster.getByTestId('cs2-roster-steam-status').first()).toHaveText(
        'Steam linked'
      );

      // Tournaments: the current tournament this team is registered in.
      const tournaments = page.getByTestId('team-profile-tournaments');
      await expect(tournaments).toBeVisible();
      await expect(page.getByTestId('team-profile-current-tournament')).toContainText(
        setup!.tournament.name
      );
    }
  );

  test(
    'the team match page is the match and nothing else',
    { tag: ['@ui', '@public', '@teams'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        prefix: `team-match-${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
      });
      expect(setup, 'tournament setup should succeed').toBeTruthy();
      const team = setup!.teams[0];

      await page.goto(`/team/${team.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('team-match-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(team.name);

      // The way to the club page, where the roster lives.
      const profileLink = page.getByTestId('team-match-view-profile-link');
      await expect(profileLink).toHaveAttribute('href', `/t/team/${team.id}`);

      // Either the next match or a line saying there is none: never the 2.x
      // stack of roster, team stats, history and "about this tournament".
      await expect(
        page.getByTestId('team-match-next').or(page.getByTestId('team-match-none'))
      ).toBeVisible();
      await expect(page.getByText('Player 1')).toHaveCount(0);
      await expect(page.getByText('Want to see your own stats', { exact: false })).toHaveCount(0);
      await expect(page.getByText('About this tournament')).toHaveCount(0);
      await expect(page.getByText('Team Performance')).toHaveCount(0);
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
