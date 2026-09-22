import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Admin home ("/") smoke test.
 *
 * Replaced by the admin home page (see `admin-home.spec.ts` for the richer
 * Tournaments/Site-grid coverage); this file keeps the basic "loads and has
 * a title" check under its original name/testid.
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

  test('should display admin home',
    {
      tag: ['@ui', '@dashboard'],
    },
    async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/Admin/i);

      // Wait for page to load and verify we're on the admin home page
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/');

      // Verify the page loaded
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });
    }
  );
});
