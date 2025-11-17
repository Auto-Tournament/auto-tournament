import { test, expect } from '@playwright/test';

/**
 * Example test file - can be used as a template
 * @tag example
 */

test('has title', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/');
  
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/MatchZy|Tournament/i);
});

test('get started link', { tag: ['@example'] }, async ({ page }) => {
  await page.goto('/');
  
  // Click the get started link.
  await page.getByRole('link', { name: /get started/i }).click();
  
  // Expects page to have a heading with the name of Installation.
  await expect(page.getByRole('heading', { name: /installation/i })).toBeVisible();
});

