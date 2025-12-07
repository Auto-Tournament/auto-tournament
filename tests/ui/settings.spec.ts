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

  test(
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

  test(
    'should update and clear webhook URL and Steam API key',
    {
      tag: ['@ui', '@settings', '@configuration'],
    },
    async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Test webhook URL update
      const webhookInput = page.getByTestId('settings-webhook-url-input');
      await expect(webhookInput).toBeVisible({ timeout: 5000 });

      const testWebhookUrl = `https://example.com/webhook/${Date.now()}`;
      await webhookInput.clear();
      await webhookInput.fill(testWebhookUrl);

      // Save settings
      const saveButton = page.getByTestId('settings-save-button');
      await saveButton.click();
      await page.waitForTimeout(1000);

      // Verify the value was saved
      const savedValue = await webhookInput.inputValue();
      expect(savedValue).toBe(testWebhookUrl);

      // Test Steam API key update
      const steamInput = page.getByTestId('settings-steam-api-key-input');
      await expect(steamInput).toBeVisible({ timeout: 5000 });

      const testSteamKey = `TEST_STEAM_KEY_${Date.now()}`;
      await steamInput.clear();
      await steamInput.fill(testSteamKey);

      await saveButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Test clearing webhook URL
      await webhookInput.clear();
      await saveButton.click();
      await page.waitForTimeout(1000);

      const clearedValue = await webhookInput.inputValue();
      expect(clearedValue).toBe('');
    }
  );
});
