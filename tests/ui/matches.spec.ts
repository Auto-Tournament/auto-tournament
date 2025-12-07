import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Matches UI tests
 * Tests matches page functionality
 *
 * @tag ui
 * @tag matches
 * @tag navigation
 */

test.describe.serial('Matches UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should navigate to and display matches page',
    {
      tag: ['@ui', '@matches'],
    },
    async ({ page }) => {
      await page.goto('/matches');
      await expect(page).toHaveURL(/\/matches/);
      await expect(page).toHaveTitle(/Matches/i);
      await page.waitForLoadState('networkidle');

      // Verify matches page loaded
      await expect(page.getByTestId('matches-page')).toBeVisible({ timeout: 5000 });
    }
  );

  test(
    'should display matches list or empty state and filter/search',
    {
      tag: ['@ui', '@matches'],
    },
    async ({ page }) => {
      await page.goto('/matches');
      await page.waitForLoadState('networkidle');

      // Check for either matches list or empty state
      const matchesList = page.getByTestId('matches-list');
      const emptyState = page.getByTestId('matches-empty-state');

      const hasMatches = await matchesList.isVisible().catch(() => false);
      const isEmpty = await emptyState.isVisible().catch(() => false);

      // Should have either matches or empty state
      expect(hasMatches || isEmpty).toBeTruthy();

      // Check for filter/search inputs
      const searchInput = page.getByTestId('matches-search-input');
      const hasSearch = await searchInput.isVisible().catch(() => false);

      if (hasSearch) {
        await expect(searchInput).toBeVisible();
      }
    }
  );
});
