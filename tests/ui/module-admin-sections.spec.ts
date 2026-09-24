import { test, expect, type Page } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Admin tools and Settings show a module's own section only when the module
 * is installed (audit chunk 9, "module ownership"; client API 0.2.2).
 *
 * The RCON console and the server events monitor used to be core's Admin
 * tools page, and the webhook URL and map sync the top of core's Settings.
 * They are CS2's now, through the `adminToolsSection` and `instanceSettings`
 * slots: with CS2 installed they are there, and without it core's pages
 * carry only core's tools.
 *
 * The suite runs with CS2 installed from the catalog, a code module the
 * browser loads at runtime. "Without CS2" answers the public module manifest
 * as an instance with no code module enabled, as code-modules-client.spec
 * does, so the browser never loads CS2.
 *
 * @tag ui
 * @tag modules
 */

async function withoutCodeModules(page: Page): Promise<void> {
  await page.route('**/api/modules/public', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, modules: [] }),
    })
  );
}

test.describe('Module sections on Admin tools and Settings', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'with CS2 installed, Admin tools has its RCON section after core tools',
    { tag: ['@ui', '@modules'] },
    async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByTestId('admin-tools-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('admin-tools-recovery')).toBeVisible();
      await expect(page.getByTestId('admin-tools-logs')).toBeVisible();

      // CS2 arrives at runtime; its section follows core's.
      const section = page.getByTestId('admin-tools-module-cs2');
      await expect(section).toBeVisible({ timeout: 30000 });
      await expect(section.getByTestId('cs2-admin-tools')).toBeVisible();
    }
  );

  test(
    'with CS2 installed, Settings has a CS2 tab with the webhook URL, map sync and server defaults',
    { tag: ['@ui', '@modules', '@settings'] },
    async ({ page }) => {
      await page.goto('/settings');
      const tab = page.getByTestId('settings-tab-module-cs2');
      await expect(tab).toBeVisible({ timeout: 30000 });

      // Core's tabs no longer carry CS2's fields, and "Advanced" (all CS2) is gone.
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);
      await expect(page.locator('#settings-tab-advanced')).toHaveCount(0);
      await page.locator('#settings-tab-matches').click();
      await expect(page.locator('#settings-tabpanel-matches')).toBeVisible();
      await expect(page.getByTestId('cs2-server-defaults')).toHaveCount(0);

      await tab.click();
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('cs2-settings-map-sync')).toBeVisible();
      // The defaults sent to every CS2 server moved here from core's tabs.
      await expect(page.getByTestId('cs2-server-defaults')).toBeVisible();
      await expect(page.getByTestId('at-hostname-format-input')).toBeAttached();
      await expect(page.getByTestId('cs2-settings-reset-button')).toBeVisible();

      // `links.settings('cs2')` opens the tab directly.
      await page.goto('/settings?section=cs2');
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 30000 });
    }
  );

  test(
    'without CS2, Admin tools and Settings show only core tools',
    { tag: ['@ui', '@modules'] },
    async ({ page }) => {
      await withoutCodeModules(page);

      await page.goto('/admin');
      await expect(page.getByTestId('admin-tools-page')).toBeVisible({ timeout: 15000 });
      // Positive first, so the negatives below are about a rendered page.
      await expect(page.getByTestId('admin-tools-logs')).toBeVisible();
      await expect(page.getByTestId('admin-tools-recovery')).toBeVisible();
      await expect(page.getByTestId('admin-tools-module-cs2')).toHaveCount(0);
      await expect(page.getByTestId('cs2-admin-tools')).toHaveCount(0);

      // A link to CS2's tab lands on core's first tab instead.
      await page.goto('/settings?section=cs2');
      await expect(page.getByTestId('settings-version')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
        'id',
        'settings-tab-integrations'
      );
      await expect(page.getByTestId('settings-tab-module-cs2')).toHaveCount(0);
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);
      await expect(page.getByTestId('cs2-settings-map-sync')).toHaveCount(0);
      await expect(page.getByTestId('cs2-server-defaults')).toHaveCount(0);
      await expect(page.locator('#settings-tab-advanced')).toHaveCount(0);
    }
  );
});
