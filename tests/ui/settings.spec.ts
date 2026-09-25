import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Settings UI tests
 * Tests settings page functionality
 *
 * NOTE: the Steam API key is no longer editable here — it is supplied via the
 * STEAM_API_KEY environment variable (see example.env). These tests previously
 * asserted a `settings-steam-api-key-input` field that no longer exists.
 *
 * @tag ui
 * @tag settings
 * @tag configuration
 */

test.describe.serial('Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test('should navigate to and display settings page',
    {
      tag: ['@ui', '@settings'],
    },
    async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings/);
      await expect(page).toHaveTitle(/Settings/i);
      await page.waitForLoadState('networkidle');

      // The webhook URL is CS2's (its own Settings tab since client API 0.2.2),
      // and the suite runs with CS2 installed.
      await page.getByTestId('settings-tab-module-cs2').click({ timeout: 15000 });
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 15000 });

      // CS2's server defaults and their reset are on the same tab (0.2.4).
      await expect(page.getByTestId('cs2-server-defaults')).toBeVisible();
      await expect(page.getByTestId('cs2-settings-reset-button')).toBeVisible();

      // The Steam API key is env-only; a field here would mean a secret is being
      // round-tripped through the browser.
      await expect(page.getByTestId('settings-steam-api-key-input')).toHaveCount(0);
    }
  );

  test('should update and clear the webhook URL',
    {
      tag: ['@ui', '@settings', '@configuration'],
    },
    async ({ page }) => {
      await page.goto('/settings?section=cs2');
      await page.waitForLoadState('networkidle');

      const webhookInput = page.getByTestId('settings-webhook-url-input');
      await expect(webhookInput).toBeVisible({ timeout: 15000 });

      // --- Update webhook URL (auto-saved on change/blur) ---
      const testWebhookUrl = `https://example.com/webhook/${Date.now()}`;
      await webhookInput.clear();
      await webhookInput.fill(testWebhookUrl);
      await webhookInput.blur();

      // Reload to verify the value was persisted server-side.
      await expect
        .poll(
          async () => {
            await page.reload();
            await page.waitForLoadState('networkidle');
            return page.getByTestId('settings-webhook-url-input').inputValue();
          },
          { message: 'webhook URL to persist', timeout: 15000 }
        )
        .toBe(testWebhookUrl);

      // --- Clear webhook URL and verify the empty value persists ---
      const webhookInput2 = page.getByTestId('settings-webhook-url-input');
      await expect(webhookInput2).toBeVisible({ timeout: 15000 });
      await webhookInput2.clear();
      await webhookInput2.blur();

      await expect
        .poll(
          async () => {
            await page.reload();
            await page.waitForLoadState('networkidle');
            return page.getByTestId('settings-webhook-url-input').inputValue();
          },
          { message: 'webhook URL to be cleared', timeout: 15000 }
        )
        .toBe('');
    }
  );

  test('a CS2 server default saves on its own, and the CS2 reset clears it',
    {
      tag: ['@ui', '@settings', '@configuration'],
    },
    async ({ page }) => {
      const readSettings = async () =>
        (await (await page.request.get('/api/settings')).json()).settings as Record<string, unknown>;

      // A field the tab does not touch, to prove its saves are partial.
      const before = await readSettings();

      await page.goto('/settings?section=cs2');
      await page.getByTestId('cs2-settings-demos-summary').click({ timeout: 30000 });
      const hostname = page.getByTestId('at-hostname-format-input');
      await expect(hostname).toBeVisible({ timeout: 15000 });

      const value = `{TEAM1} v {TEAM2} ${Date.now()}`;
      await hostname.fill(value);
      await hostname.blur();

      await expect
        .poll(async () => (await readSettings()).atHostnameFormat, {
          message: 'hostname format to be saved',
          timeout: 15000,
        })
        .toBe(value);
      expect((await readSettings()).ratingsEnabled).toBe(before.ratingsEnabled);

      await page.getByTestId('cs2-settings-reset-button').click();
      await page.getByTestId('cs2-settings-reset-confirm').click();
      await expect
        .poll(async () => (await readSettings()).atHostnameFormat, {
          message: 'hostname format to be reset',
          timeout: 15000,
        })
        .not.toBe(value);
      await expect(hostname).toHaveValue('{TEAM1} vs {TEAM2}');
    }
  );
});
