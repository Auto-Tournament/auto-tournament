import { test, expect } from '@playwright/test';

/**
 * A page a code module brings (CS2's /watch/…) opened straight from a shared
 * link, by someone not signed in: the app waits for the module instead of
 * sending them to login (client/src/App.tsx RootRoute).
 *
 * @tag ui
 * @tag public
 */

test('a shared watch link opens for a visitor', { tag: ['@ui', '@public'] }, async ({ page }) => {
  await page.goto('/watch/clip/999999999', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cs2-watch-missing')).toBeVisible();
  await expect(page).toHaveURL(/\/watch\/clip\/999999999$/);
});
