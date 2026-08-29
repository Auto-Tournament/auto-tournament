import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Bracket UI tests
 *
 * Both states are arranged explicitly. The previous version asserted
 * `expect(hasBracket || isEmpty).toBeTruthy()` — true as long as the page
 * rendered either one — and only checked the tournament info panel if a bracket
 * happened to be present, which it never arranged.
 *
 * @tag ui
 * @tag bracket
 * @tag navigation
 */

test.describe.serial('Bracket UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'should show the empty state when no tournament exists',
    { tag: ['@ui', '@bracket'] },
    async ({ page, request }) => {
      await request.delete('/api/tournament', { headers: getAuthHeader() });

      await page.goto('/bracket');
      await expect(page).toHaveURL(/\/bracket/);
      await expect(page).toHaveTitle(/Bracket/i);

      await expect(page.getByTestId('bracket-empty-state')).toBeVisible();
      await expect(page.getByTestId('bracket-visualization')).toHaveCount(0);
    }
  );

  test(
    'should render the bracket and tournament info once a tournament is running',
    { tag: ['@ui', '@bracket'] },
    async ({ page, request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'bracket-ui',
      });
      expect(setup, 'tournament setup should succeed').toBeTruthy();

      await page.goto('/bracket');

      await expect(page.getByTestId('bracket-visualization')).toBeVisible();
      await expect(page.getByTestId('bracket-tournament-info')).toBeVisible();
      await expect(page.getByTestId('bracket-empty-state')).toHaveCount(0);
    }
  );
});
