import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * An admin on another address than the site is set up for (FRONTEND_BASE_URL,
 * localhost here) is told which address the site uses; on that address, not.
 * By IP, sign-in itself works (a cookie for the address it came on).
 *
 * @tag ui
 */

test(
  'an admin on another address sees which one the site is set up for',
  { tag: ['@ui'] },
  async ({ page, baseURL }) => {
    const byIp = new URL(baseURL!);
    byIp.hostname = '127.0.0.1';
    const login = await page.request.post(`${byIp.origin}/api/test/login-admin`, { data: {} });
    expect(login.ok(), await login.text()).toBe(true);

    await page.goto(`${byIp.origin}/manage`);
    const banner = page.getByTestId('address-mismatch');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('127.0.0.1');
    await expect(banner).toContainText('localhost');

    await ensureSignedIn(page);
    await page.goto('/manage');
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('address-mismatch')).toHaveCount(0);
  }
);
