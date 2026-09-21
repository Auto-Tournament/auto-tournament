import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Colour theme picker UI tests
 *
 * Picking a theme saves it to localStorage and reloads the page (the app's
 * tokens are read once at module load, see client/src/theme/tokens.ts), so
 * these tests assert on the resulting page state after the reload rather
 * than any in-page animation.
 *
 * @tag ui
 * @tag theme
 */

test.describe.serial('Theme switcher', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/');
    await page.evaluate(() => window.localStorage.removeItem('at-theme'));
  });

  test.afterEach(async ({ page }) => {
    // Leave the app on the default theme for tests that run after this file.
    await page.evaluate(() => window.localStorage.removeItem('at-theme'));
  });

  test('picking Ultraviolet, then Ember, updates the app background',
    {
      tag: ['@ui', '@theme'],
    },
    async ({ page }) => {
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Default (Ember) background.
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 9, 8)');

      await page.getByTestId('theme-switcher-button').click();
      await page.getByTestId('theme-option-ultraviolet').click();

      // Selecting a theme reloads the page.
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 9, 23)');
      await expect(page.evaluate(() => window.localStorage.getItem('at-theme'))).resolves.toBe('ultraviolet');

      await page.getByTestId('theme-switcher-button').click();
      await page.getByTestId('theme-option-ember').click();

      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 9, 8)');
      await expect(page.evaluate(() => window.localStorage.getItem('at-theme'))).resolves.toBe('ember');
    }
  );
});
