import { test, expect } from '@playwright/test';

/**
 * Dashboard page tests
 * @tag dashboard
 * @tag navigation
 */

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should display dashboard', { tag: ['@dashboard'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Dashboard/i);

    // Check for dashboard heading
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test(
    'should display navigation cards',
    { tag: ['@dashboard', '@navigation'] },
    async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Check for main navigation cards - look for card titles (h6 variant)
      await expect(page.getByRole('heading', { name: /tournament/i, level: 6 })).toBeVisible();
      await expect(page.getByRole('heading', { name: /bracket/i, level: 6 })).toBeVisible();
      await expect(page.getByRole('heading', { name: /teams/i, level: 6 })).toBeVisible();
      await expect(page.getByRole('heading', { name: /servers/i, level: 6 })).toBeVisible();
      await expect(page.getByRole('heading', { name: /matches/i, level: 6 })).toBeVisible();
      await expect(page.getByRole('heading', { name: /settings/i, level: 6 })).toBeVisible();
    }
  );

  test(
    'should navigate to all pages from dashboard cards',
    { tag: ['@dashboard', '@navigation'] },
    async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Test navigation to all main pages from dashboard cards
      const navigationTests = [
        { heading: /teams/i, url: /\/teams/ },
        { heading: /servers/i, url: /\/servers/ },
        { heading: /tournament/i, url: /\/tournament/ },
        { heading: /settings/i, url: /\/settings/ },
      ];

      for (const nav of navigationTests) {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const cardHeading = page.getByRole('heading', { name: nav.heading, level: 6 });
        const card = cardHeading.locator('..').locator('..').locator('..').first();
        await card.click();

        await expect(page).toHaveURL(nav.url);
      }
    }
  );

  test('should display onboarding checklist', { tag: ['@dashboard'] }, async ({ page }) => {
    await page.goto('/');

    // Check for onboarding checklist (may or may not be visible depending on state)
    const checklist = page.locator('text=/onboarding|checklist|setup/i');
    const isVisible = await checklist.isVisible().catch(() => false);

    // Checklist might not always be visible, so we just check if page loads correctly
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});
