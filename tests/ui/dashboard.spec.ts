import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Dashboard UI tests
 * Tests dashboard page functionality
 *
 * @tag ui
 * @tag dashboard
 * @tag navigation
 */

test.describe.serial('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure signed in (checks first, only signs in if needed)
    await ensureSignedIn(page);
  });

  test(
    'should display dashboard',
    {
      tag: ['@ui', '@dashboard'],
    },
    async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/Dashboard/i);

      // Wait for page to load and verify we're on the dashboard
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/');

      // Verify dashboard page loaded
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 5000 });
    }
  );
});
