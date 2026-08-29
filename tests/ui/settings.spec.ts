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

      // Check for webhook URL input
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 15000 });

      // Save control is present
      await expect(page.getByTestId('settings-save-button')).toBeVisible({ timeout: 15000 });

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
      await page.goto('/settings');
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
});
