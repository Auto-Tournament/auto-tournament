import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Matches UI tests
 *
 * Each state is arranged deliberately rather than accepted. The previous version
 * asserted `expect(hasMatches || isEmpty).toBeTruthy()`, which holds as long as
 * the page renders *something*, and then guarded a search-input assertion behind
 * a visibility check — `matches-search-input` does not exist in the client, so
 * that branch could never run.
 *
 * @tag ui
 * @tag matches
 * @tag navigation
 */

test.describe.serial('Matches UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'should navigate to and display the matches page',
    { tag: ['@ui', '@matches'] },
    async ({ page }) => {
      await page.goto('/matches');
      await expect(page).toHaveURL(/\/matches/);
      await expect(page).toHaveTitle(/Matches/i);
      await expect(page.getByTestId('matches-page')).toBeVisible();
    }
  );

  test(
    'should show the empty state with no tournament, and the list once matches exist',
    { tag: ['@ui', '@matches'] },
    async ({ page, request }) => {
      await request.delete('/api/tournament', { headers: getAuthHeader() });

      await page.goto('/matches');
      await expect(page.getByTestId('matches-empty-state')).toBeVisible();
      await expect(page.getByTestId('matches-list')).toHaveCount(0);

      // Starting a tournament generates its first-round matches.
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'matches-ui',
      });
      expect(setup, 'tournament setup should succeed').toBeTruthy();

      await page.goto('/matches');
      await expect(page.getByTestId('matches-list')).toBeVisible();
      await expect(page.getByTestId('matches-empty-state')).toHaveCount(0);
    }
  );
});
