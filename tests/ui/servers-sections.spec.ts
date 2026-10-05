import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Servers page folds its sections: Machines open, the rest closed with a
 * one-line summary, and the open state is remembered per browser.
 *
 * @tag ui
 * @tag servers
 */
test.describe('Servers page sections', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('machines open, the fleet closed until opened, and remembered', { tag: ['@ui', '@servers'] }, async ({ page }) => {
    // Start from nothing remembered.
    await page.goto('/servers');
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('servers-section-')) localStorage.removeItem(key);
    });
    await page.reload();
    await expect(page.getByTestId('machines-toggle')).toHaveAttribute('aria-expanded', 'true');
    const fleet = page.getByTestId('fleet-toggle');
    await expect(fleet).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('fleet-panel')).toContainText(/Ready Up server/);

    await fleet.click();
    await expect(fleet).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('fleet-add-server')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('fleet-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});
