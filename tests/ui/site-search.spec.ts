import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInAsPlayer } from '../helpers/auth';

/** The search box in the top bar (components/search/SiteSearch.tsx). */
test.describe('Site search', () => {
  test(
    'an admin finds a settings page and opens it with Enter',
    { tag: ['@ui'] },
    async ({ page }) => {
      await ensureSignedIn(page);
      await page.goto('/');
      await page.getByTestId('site-search-open').click();
      await page.getByTestId('site-search-input').fill('keycloak');
      await expect(page.getByTestId('site-search-hit-page-settingsSignIn')).toBeVisible();
      await page.getByTestId('site-search-input').press('Enter');
      await expect(page).toHaveURL(/settings\?section=signin/);
    }
  );

  test(
    '"redress" finds Redraw overlays and opens the Overlays tab',
    { tag: ['@ui'] },
    async ({ page }) => {
      await ensureSignedIn(page);
      await page.goto('/');
      await page.getByTestId('site-search-open').click();
      await page.getByTestId('site-search-input').fill('redress');
      const hit = page.getByTestId('site-search-hit-page-redrawOverlays');
      await expect(hit).toBeVisible();
      await expect(hit).toContainText('Redraw overlays');
      // Where it is: Highlights › Overlays.
      await expect(hit).toContainText('Highlights › Overlays');
      await page.getByTestId('site-search-input').press('Enter');
      await expect(page).toHaveURL(/\/manage\/highlights\?tab=cs2&sub=overlays/);
      await expect(page.getByTestId('highlights-tab-overlays')).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
  );

  test(
    'a player finds their inventory with a typo; admin pages stay hidden',
    { tag: ['@ui'] },
    async ({ page }) => {
      const steamId = `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
      expect(await signInAsPlayer(page, steamId, 'Search Player', { games: ['cs2'] })).toBe(true);
      await page.goto('/');
      await page.getByTestId('site-search-open').click();
      await page.getByTestId('site-search-input').fill('inventroy');
      await expect(page.getByTestId('site-search-hit-page-inventory')).toBeVisible();
      await page.getByTestId('site-search-input').fill('redraw overlays');
      await expect(page.getByTestId('site-search-empty')).toBeVisible();
    }
  );

  test('Ctrl K opens it', { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/');
    // The shortcut listens once the top bar is there.
    await expect(page.getByTestId('site-search-open')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('site-search-input')).toBeVisible();
    await expect(page.getByTestId('site-search-input')).toBeFocused();
  });
});
