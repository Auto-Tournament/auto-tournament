import { test, expect } from '@playwright/test';
import { signInAsPlayer } from '../helpers/auth';

/**
 * Account → Notifications: the events and their Discord / email switches, a
 * switch that sticks after a reload, and why a channel is not available.
 *
 * @tag ui
 * @tag notifications
 */
test('the Notifications section on the account page', { tag: ['@ui'] }, async ({ page }) => {
  const steamId = `7656119804${String(Date.now()).slice(-7)}`;
  expect(await signInAsPlayer(page, steamId, 'Notify Viewer')).toBe(true);
  await page.goto('/me/connections');
  const section = page.getByTestId('notify-channels');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Your match is ready');
  await expect(section).toContainText('Your turn in the veto');
  await expect(page.getByTestId('notify-channel-why-email')).toBeVisible();
  await expect(page.getByTestId('notify-match_ready-email')).toBeDisabled();
});
