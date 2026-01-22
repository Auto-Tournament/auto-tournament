import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Settings UI tests
 * Tests settings page functionality
 *
 * @tag ui
 * @tag settings
 * @tag configuration
 */

test.describe.serial('Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test.skip(
    'should navigate to and display settings page',
    {
      tag: ['@ui', '@settings'],
    },
    async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings/);
      await expect(page).toHaveTitle(/Settings/i);
      await page.waitForLoadState('networkidle');

      // Check for webhook URL input
      await expect(page.getByTestId('settings-webhook-url-input')).toBeVisible({ timeout: 5000 });

      // Check for Steam API key input
      await expect(page.getByTestId('settings-steam-api-key-input')).toBeVisible({ timeout: 5000 });
    }
  );

  test.skip(
    'should update and clear webhook URL and Steam API key',
    {
      tag: ['@ui', '@settings', '@configuration'],
    },
    async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Locate inputs once to assert presence
      const webhookInput = page.getByTestId('settings-webhook-url-input');
      await expect(webhookInput).toBeVisible({ timeout: 5000 });
      const steamInput = page.getByTestId('settings-steam-api-key-input');
      await expect(steamInput).toBeVisible({ timeout: 5000 });

      // --- Update webhook URL (auto-saved on change/blur) ---
      const testWebhookUrl = `https://example.com/webhook/${Date.now()}`;
      await webhookInput.clear();
      await webhookInput.fill(testWebhookUrl);
      await webhookInput.blur();
      await page.waitForTimeout(1500); // allow debounce + save to complete

      // Reload to verify value was persisted server-side
      await page.reload();
      await page.waitForLoadState('networkidle');
      const webhookAfterSave = page.getByTestId('settings-webhook-url-input');
      await expect(webhookAfterSave).toBeVisible({ timeout: 5000 });
      const savedWebhook = await webhookAfterSave.inputValue();
      expect(savedWebhook).toBe(testWebhookUrl);

      // --- Update Steam API key (auto-saved) ---
      const steamInput2 = page.getByTestId('settings-steam-api-key-input');
      await expect(steamInput2).toBeVisible({ timeout: 5000 });

      const testSteamKey = `TEST_STEAM_KEY_${Date.now()}`;
      await steamInput2.clear();
      await steamInput2.fill(testSteamKey);
      await steamInput2.blur();
      await page.waitForTimeout(1500);

      await page.reload();
      await page.waitForLoadState('networkidle');
      const steamAfterSave = page.getByTestId('settings-steam-api-key-input');
      await expect(steamAfterSave).toBeVisible({ timeout: 5000 });
      const savedSteamKey = await steamAfterSave.inputValue();
      expect(savedSteamKey).toBe(testSteamKey);

      // --- Clear webhook URL and verify empty persisted value ---
      const webhookInput2 = page.getByTestId('settings-webhook-url-input');
      await expect(webhookInput2).toBeVisible({ timeout: 5000 });
      await webhookInput2.clear();
      await webhookInput2.blur();
      await page.waitForTimeout(1500);

      await page.reload();
      await page.waitForLoadState('networkidle');
      const webhookAfterClear = page.getByTestId('settings-webhook-url-input');
      const clearedValue = await webhookAfterClear.inputValue();
      expect(clearedValue).toBe('');
    }
  );
});
