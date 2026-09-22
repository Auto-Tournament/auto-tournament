import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Admin home ("/") UI tests.
 *
 * @tag ui
 * @tag admin-home
 */

test.describe.serial('Admin home', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);
  });

  test(
    'admin at "/" sees the current tournament with a Manage action, and the Site grid links to Servers and Settings',
    { tag: ['@ui', '@admin-home'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'admin-home',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;

      await page.goto('/');
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });

      // Tournaments list: the just-started tournament, with a Manage action
      // (it's `in_progress`, not a draft or a finished event).
      const list = page.getByTestId('admin-home-tournaments');
      await expect(list).toBeVisible();
      await expect(page.getByTestId(`admin-home-tournament-${setup.tournament.id}`)).toContainText(
        setup.tournament.name
      );
      await expect(
        page.getByTestId(`admin-home-tournament-${setup.tournament.id}-action`)
      ).toHaveText(/manage/i);

      // Site grid: every other admin page is reachable from here, including
      // Servers and Settings.
      await expect(page.getByTestId('admin-home-site-grid')).toBeVisible();
      await expect(page.getByTestId('admin-home-site-link-servers')).toHaveAttribute('href', '/servers');
      await expect(page.getByTestId('admin-home-site-link-settings')).toHaveAttribute('href', '/settings');
    }
  );
});
