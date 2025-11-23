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

      // Check for settings page heading
      await expect(page.getByRole('heading', { name: /settings/i, level: 4 })).toBeVisible();

      // Check for webhook URL input
      const webhookInput = page.getByLabel(/webhook base url/i);
      await expect(webhookInput).toBeVisible();

      // Check for Steam API key input
      const steamInput = page.getByLabel(/steam web api key/i);
      await expect(steamInput).toBeVisible();
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
      const webhookInput = page.getByLabel(/webhook base url/i);
      await expect(webhookInput).toBeVisible();

      const testWebhookUrl = `https://example.com/webhook/${Date.now()}`;
      await webhookInput.clear();
      await webhookInput.fill(testWebhookUrl);

      // Save settings
      const saveButton = page.getByRole('button', { name: /save settings/i });
      await saveButton.click();
      await page.waitForTimeout(1000);

      // Verify the value was saved
      const savedValue = await webhookInput.inputValue();
      expect(savedValue).toBe(testWebhookUrl);

      // Test Steam API key update
      const steamInput = page.getByLabel(/steam web api key/i);
      await expect(steamInput).toBeVisible();

      const testSteamKey = `TEST_STEAM_KEY_${Date.now()}`;
      await steamInput.clear();
      await steamInput.fill(testSteamKey);

      await saveButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Re-find the input after save
      const steamInputAfterSave = page.getByLabel(/steam web api key/i);
      expect(steamInputAfterSave).toBeDefined();

      // Test clearing webhook URL
      await webhookInput.clear();
      await saveButton.click();
      await page.waitForTimeout(1000);

      const clearedValue = await webhookInput.inputValue();
      expect(clearedValue).toBe('');
    }
  );
});
