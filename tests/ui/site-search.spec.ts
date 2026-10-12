import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

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

  test('a misspelt old name finds the overlay redraw tab', { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/');
    await page.getByTestId('site-search-open').click();
    await page.getByTestId('site-search-input').fill('redres');
    await expect(page.getByTestId('site-search-hit-page-highlightsOverlays')).toBeVisible();
    await page.getByTestId('site-search-input').press('Enter');
    await expect(page).toHaveURL(/highlights\?tab=cs2&section=overlays/);
    await expect(page.getByTestId('highlights-tab-cs2')).toHaveAttribute('aria-selected', 'true');
  });

  test('a visitor finds the leaderboards with a typo', { tag: ['@ui'] }, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await page.getByTestId('site-search-open').click();
    await page.getByTestId('site-search-input').fill('leaderbaord');
    await expect(page.getByTestId('site-search-hit-page-leaderboards')).toBeVisible();
    await expect(page.getByTestId('site-search-hit-page-settingsSignIn')).toHaveCount(0);
    await context.close();
  });

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
