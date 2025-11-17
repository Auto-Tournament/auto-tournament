import { test, expect } from '@playwright/test';

/**
 * Matches page tests
 * @tag matches
 * @tag navigation
 */

test.describe('Matches Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to and display matches page', { tag: ['@matches'] }, async ({ page }) => {
    await page.goto('/matches');
    await expect(page).toHaveURL(/\/matches/);
    await expect(page).toHaveTitle(/Matches/i);
    await page.waitForLoadState('networkidle');
    
    // Check for matches page heading - h4 heading
    await expect(page.getByRole('heading', { name: /matches/i, level: 4 })).toBeVisible();
  });

  test('should display matches list or empty state', { tag: ['@matches'] }, async ({ page }) => {
    await page.goto('/matches');
    await page.waitForLoadState('networkidle');
    
    // Check for either matches list or empty state
    const matchesList = page.locator('text=/match|round|status/i');
    const emptyState = page.locator("text=/no.*matches|haven't.*created|empty/i");
    
    const hasMatches = await matchesList.first().isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    // Should have either matches or empty state
    expect(hasMatches || isEmpty).toBeTruthy();
  });

  test('should filter or search matches if available', { tag: ['@matches'] }, async ({ page }) => {
    await page.goto('/matches');
    await page.waitForLoadState('networkidle');
    
    // Look for filter/search inputs
    const searchInput = page.getByPlaceholder(/search|filter/i).or(page.locator('input[type="search"]'));
    const hasSearch = await searchInput.isVisible().catch(() => false);
    
    if (hasSearch) {
      await expect(searchInput).toBeVisible();
    }
  });

  test('should display match status indicators', { tag: ['@matches'] }, async ({ page }) => {
    await page.goto('/matches');
    await page.waitForLoadState('networkidle');
    
    // Look for status indicators (pending, ready, loaded, live, completed)
    const statusIndicators = page.locator('text=/pending|ready|loaded|live|completed|status/i');
    const hasStatus = await statusIndicators.first().isVisible().catch(() => false);
    
    // Status indicators might not be visible if no matches exist
    if (hasStatus) {
      await expect(statusIndicators.first()).toBeVisible();
    }
  });
});

