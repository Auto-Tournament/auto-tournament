import { test, expect } from '@playwright/test';

/**
 * Example test file - can be used as a template
 * @tag example
 */

test('has title', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/login');
  
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Login|Dashboard|MatchZy/i);
});

test('get started link', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/login');
  
  // This is an example test - login page should be accessible
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

