import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

/**
 * Templates and Ratings share a tab strip; `/manage/templates?tab=ratings`
 * (old links, the IA plan's address) opens Ratings, its own page.
 *
 * @tag ui
 */
test('?tab=ratings on Templates opens Ratings', { tag: ['@ui'] }, async ({ page }) => {
  expect(await signIn(page)).toBe(true);
  await page.goto('/manage/templates?tab=ratings');
  await expect(page).toHaveURL(/\/manage\/ratings$/);
});
