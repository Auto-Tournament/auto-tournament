import { test, expect } from '@playwright/test';

/**
 * Example test file - can be used as a template
 * @tag example
 */

test('has title', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Wait for page to load (with fallback if networkidle times out)
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch (error) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
  }

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Login|Dashboard|MatchZy/i);
});

test('get started link', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch (error) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
  }

  // This is an example test - login page should be accessible
  await expect(page.getByTestId('login-sign-in-button')).toBeVisible();
});
