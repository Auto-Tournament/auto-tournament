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
    'with CS2 installed, its settings are its own pages in the rail: Skins and Match rules',
    { tag: ['@ui', '@modules', '@settings'] },
    async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByTestId('settings-card-site')).toBeVisible({ timeout: 30000 });

      // Settings is the platform's only: none of CS2's fields, no second nav.
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);
      await expect(page.getByTestId('cs2-server-defaults')).toHaveCount(0);
      await expect(page.locator('[id^="settings-nav-"]')).toHaveCount(0);
      await expect(page.getByTestId('settings-game-links')).toBeVisible({ timeout: 30000 });

      // The rail's CS2 group: Servers, Maps, Skins, Match rules.
      const group = page.getByTestId('manage-rail-group-game');
      await expect(group).toBeVisible({ timeout: 30000 });
      for (const name of ['Servers', 'Maps', 'Skins', 'Match rules']) {
        await expect(group.getByRole('link', { name })).toBeVisible();
      }

      await group.getByRole('link', { name: 'Match rules' }).click();
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('cs2-server-defaults')).toBeVisible();
      await expect(page.getByTestId('at-hostname-format-input')).toBeAttached();

      await group.getByRole('link', { name: 'Skins' }).click();
      await expect(page.getByTestId('skins-settings')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('skins-stats')).toBeVisible();
      await expect(page.getByTestId('skins-rarity-bar')).toBeVisible();
      await expect(page.getByTestId('skins-inventory-admin')).toBeVisible();

      // Old links to CS2's settings land on its pages.
      await page.goto('/settings?section=cs2');
      await expect(page).toHaveURL(/\/match-rules$/, { timeout: 30000 });
      await page.goto('/settings?section=cs2:skins');
      await expect(page).toHaveURL(/\/skins$/, { timeout: 30000 });
      // A platform section scrolls to its card.
      await page.goto('/settings?section=license');
      await expect(page.getByTestId('settings-card-license')).toBeInViewport({ timeout: 15000 });
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

      // Settings shows the platform's cards and no game links.
      await page.goto('/settings');
      await expect(page.getByTestId('settings-version')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('settings-card-site')).toBeVisible();
      await expect(page.getByTestId('settings-game-links')).toHaveCount(0);
      await expect(page.getByTestId('settings-webhook-url-input')).toHaveCount(0);
      await expect(page.getByTestId('cs2-settings-map-sync')).toHaveCount(0);
      await expect(page.getByTestId('cs2-server-defaults')).toHaveCount(0);
    }
  );
});
