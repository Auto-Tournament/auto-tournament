import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { getAuthHeader } from '../helpers/auth';

/**
 * A team's page (`/team/:teamId`).
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

      await page.goto(`/team/${team.id}`, { waitUntil: 'domcontentloaded' });
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
    'a match row opens the match; the opponent in it opens their team',
    { tag: ['@ui', '@public', '@teams'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        prefix: `team-rows-${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
      });
      expect(setup, 'tournament setup should succeed').toBeTruthy();
      const [team, opponent] = setup!.teams;
      const match = await findMatchByTeams(request, team.id, opponent.id);
      expect(match, 'the two teams have a match').toBeTruthy();
      // A live match is in the team's match list without a server to play it on.
      const live = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug: match!.slug, status: 'live' },
      });
      expect(live.ok()).toBe(true);

      await page.goto(`/team/${team.id}`, { waitUntil: 'domcontentloaded' });
      const row = page.getByTestId(`team-match-${match!.slug}`);
      await expect(row).toBeVisible({ timeout: 15000 });

      // The opponent's name is its own link, to their team page.
      await row.getByTestId('match-row-opponent').click();
      await expect(page).toHaveURL(new RegExp(`/team/${opponent.id}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(opponent.name);

      // Anywhere else on the row opens the match.
      await page.goBack();
      await expect(row).toBeVisible({ timeout: 15000 });
      // (The row re-renders as the page loads again: let click find it.)
      await row.click({ position: { x: 12, y: 12 } });
      await expect(page).toHaveURL(new RegExp(`/match/${match!.slug}$`));
    }
  );

  test(
    'the team page links its next match to the match room, and never draws the veto',
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
      const res = await request.get(`/api/team/${team.id}/match`);
      const slug = ((await res.json()) as { match?: { slug?: string } }).match?.slug;
      expect(slug, 'the team has a match').toBeTruthy();

      await page.goto(`/team/${team.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('team-profile-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('next-match-card')).toBeVisible();
      await expect(page.getByTestId('next-match-open')).toHaveAttribute(
        'href',
        `/match/${encodeURIComponent(slug!)}`
      );
      // The veto is the match room's alone.
      await expect(page.getByTestId('veto-interface')).toHaveCount(0);
    }
  );

  test(
    'the old /t/team address lands on the team page',
    { tag: ['@ui', '@public', '@teams'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        prefix: `team-old-${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
      });
      const team = setup!.teams[0];
      await page.goto(`/t/team/${team.id}?tab=matches`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`/team/${team.id}\\?tab=matches$`));
      await expect(page.getByTestId('team-profile-page')).toBeVisible({ timeout: 15000 });
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
