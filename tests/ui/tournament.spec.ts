import { test, expect } from '@playwright/test';
import { setupTestContext, configureWebhook } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { createTournament, startTournament } from '../helpers/tournaments';

/**
 * Tournament UI tests
 *
 * /tournament renders one of three distinct views depending on tournament state,
 * and each test below drives the app into a specific one rather than accepting
 * whichever happens to show up:
 *
 *   no tournament   -> welcome screen (tournament-welcome-create-new)
 *   created (setup) -> configuration review (tournament-name-display)
 *   in_progress     -> live view (tournament-status, view-bracket-button)
 *
 * The previous version of this file guarded every assertion behind
 * `if (await x.isVisible().catch(() => false))`, so it passed whether or not any
 * of it worked. Its "view bracket" branch could never run at all: that button
 * only exists once a tournament is in progress, which the test never arranged.
 *
 * @tag ui
 * @tag tournament
 * @tag crud
 */

const MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

test.describe.serial('Tournament UI', () => {
  let teamIds: string[] = [];

  test.beforeEach(async ({ page, request }) => {
    const context = await setupTestContext(page, request);
    await configureWebhook(request, context.baseUrl);
  });

  test(
    'should show the welcome screen when no tournament exists',
    { tag: ['@ui', '@tournament'] },
    async ({ page, request }) => {
      await request.delete('/api/tournament', { headers: getAuthHeader() });

      await page.goto('/tournament');
      await expect(page).toHaveURL(/\/tournament/);
      await expect(page).toHaveTitle(/Tournament Setup/i);

      await expect(page.getByTestId('tournament-page')).toBeVisible();
      await expect(page.getByTestId('tournament-welcome-create-new')).toBeVisible();

      // The live view belongs to an in-progress tournament, not an empty one.
      await expect(page.getByTestId('tournament-status')).toHaveCount(0);
      await expect(page.getByTestId('view-bracket-button')).toHaveCount(0);
    }
  );

  test(
    'should show the tournament instead of the welcome screen once created',
    { tag: ['@ui', '@tournament', '@crud'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'tournament-ui');
      expect(teams, 'test teams should be created').toBeTruthy();
      teamIds = teams!.map((team) => team.id);

      const server = await createTestServer(request, 'tournament-ui');
      expect(server, 'a test server should be created').toBeTruthy();

      const tournament = await createTournament(request, {
        name: `Tournament UI ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds,
      });
      expect(tournament, 'tournament should be created').toBeTruthy();

      await page.goto('/tournament');
      await expect(page.getByTestId('tournament-name-display')).toBeVisible();
      await expect(page.getByTestId('tournament-welcome-create-new')).toHaveCount(0);
    }
  );

  test(
    'should show live status and a working bracket link once started',
    { tag: ['@ui', '@tournament', '@navigation'] },
    async ({ page, request }) => {
      expect(await startTournament(request), 'tournament should start').toBe(true);

      await page.goto('/tournament');

      // Starting flips the page from the configuration view to the live one.
      await expect(page.getByTestId('tournament-status')).toBeVisible();
      await expect(page.getByTestId('tournament-name-display')).toHaveCount(0);

      const bracketButton = page.getByTestId('view-bracket-button');
      await expect(bracketButton).toBeVisible();
      await bracketButton.click();
      await expect(page).toHaveURL(/\/bracket/);
    }
  );
});
