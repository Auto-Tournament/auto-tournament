import { test, expect, type Page } from '@playwright/test';
import { signInAsPlayer } from '../helpers/auth';

/**
 * After signing in, the viewer goes back to the page they came from
 * (`/login?next=` or the route guard's `state.from`; utils/returnAfterLogin.ts).
 * Signing in here sets the cookie directly, then lands on "/" the way a provider's callback does.
 *
 * @tag ui
 */

const saved = (page: Page) => page.evaluate(() => sessionStorage.getItem('at:return-after-login'));

test('a viewer goes back to the page they came from after signing in', async ({ page }) => {
  await page.goto('/login?next=%2Fmatch%2Freturn-test%3Ftab%3Dstats');
  await expect.poll(() => saved(page)).toContain('/match/return-test?tab=stats');
  expect(await signInAsPlayer(page)).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL(/\/match\/return-test\?tab=stats$/);
  expect(await saved(page)).toBeNull();
});

test('a link to another site is never remembered', async ({ page }) => {
  await page.goto('/login?next=%2F%2Fexample.com%2Fphish');
  await page.waitForLoadState('networkidle');
  expect(await saved(page)).toBeNull();
});
