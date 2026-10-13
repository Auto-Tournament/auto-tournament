import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInAsPlayer, signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * Notifications → Settings: per kind of notice (saved on the account), and
 * browser notifications while the tab is in the background. The browser's
 * Notification is stubbed to record what would show.
 *
 * @tag ui
 * @tag social
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const id = (n: number) => `7656119${String(Date.now()).slice(-8)}${n}${n}`.slice(0, 17);

test(
  'settings on the Notifications page; a new notice in the background shows in the browser',
  { tag: ['@ui'] },
  async ({ page }) => {
    await page.addInitScript(() => {
      const shown: Array<{ title: string; body?: string }> = [];
      (window as unknown as { __shown: typeof shown }).__shown = shown;
      class FakeNotification {
        static permission = 'default';
        static requestPermission() {
          FakeNotification.permission = 'granted';
          return Promise.resolve('granted');
        }
        onclick: (() => void) | null = null;
        constructor(title: string, options?: { body?: string }) {
          shown.push({ title, body: options?.body });
        }
        close() {}
      }
      Object.defineProperty(window, 'Notification', {
        value: FakeNotification,
        configurable: true,
      });
      // The tab is in the background.
      document.hasFocus = () => false;
    });

    const me = id(1);
    expect(await signInAsPlayer(page, me, 'Notify Me')).toBe(true);
    await page.goto('/notifications#settings');
    const settings = page.getByTestId('notification-settings');
    await expect(settings).toBeVisible({ timeout: 15000 });

    // A kind's delivery, saved on the account.
    await page.getByTestId('notification-setting-skin').locator('..').click();
    await page.getByRole('option', { name: 'Off' }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/social/notifications/settings')).json()).settings
            .skin
      )
      .toBe('off');
    // What needs an answer has no "Off".
    await page.getByTestId('notification-setting-friend_request').locator('..').click();
    await expect(page.getByRole('option', { name: 'Off' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Browser notifications on (the browser asks once), then a friend request arrives.
    const toggle = page.getByTestId('notification-settings-browser').locator('input');
    await toggle.check();
    await expect(toggle).toBeChecked();

    const other = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInAsPlayerViaRequest(other, id(2), 'Sender Two')).toBe(true);
    expect(
      (await other.post('/api/social/friends/requests', { data: { playerId: me } })).ok()
    ).toBe(true);
    await other.dispose();

    await expect
      .poll(async () =>
        page.evaluate(() =>
          (window as unknown as { __shown: Array<{ title: string }> }).__shown.map((n) => n.title)
        )
      )
      .toContainEqual(expect.stringContaining('Sender Two'));
  }
);
