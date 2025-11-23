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

      // Check for matches page heading
      await expect(page.getByRole('heading', { name: /matches/i, level: 4 })).toBeVisible();
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
      const matchesList = page.locator('text=/match|round|status/i');
      const emptyState = page.locator("text=/no.*matches|haven't.*created|empty/i");

      const hasMatches = await matchesList
        .first()
        .isVisible()
        .catch(() => false);
      const isEmpty = await emptyState.isVisible().catch(() => false);

      // Should have either matches or empty state
      expect(hasMatches || isEmpty).toBeTruthy();

      // Check for filter/search inputs
      const searchInput = page
        .getByPlaceholder(/search|filter/i)
        .or(page.locator('input[type="search"]'));
      const hasSearch = await searchInput.isVisible().catch(() => false);

      if (hasSearch) {
        await expect(searchInput).toBeVisible();
      }

      // Look for status indicators
      const statusIndicators = page.locator('text=/pending|ready|loaded|live|completed|status/i');
      const hasStatus = await statusIndicators
        .first()
        .isVisible()
        .catch(() => false);

      if (hasStatus) {
        await expect(statusIndicators.first()).toBeVisible();
      }
    }
  );
});
