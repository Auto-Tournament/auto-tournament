import { test, expect } from '@playwright/test';

/**
 * Steam health snackbar UX tests
 *
 * @tag ui
 * @tag steam
 * @tag error-handling
 */

test.describe.serial('Steam health snackbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/steam/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          configured: true,
          valid: false,
          errorType: 'invalid_key',
          error:
            'Steam integration is currently unavailable. Check server configuration and connectivity.',
        }),
      });
    });

    // Sign in via test helper (session cookie) using a *browser* request so that
    // Set-Cookie is applied to the page context in all environments (Caddy proxy, Docker, etc).
    const steamId = process.env.TEST_STEAM_ID || '76561198000000001';
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const loginResult = await page.evaluate(async (id) => {
      const resp = await fetch('/api/test/login-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId: id }),
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    }, steamId);

    expect(loginResult.ok, `login-admin failed: ${loginResult.status} ${loginResult.text}`).toBeTruthy();

    const adminMe = await page.evaluate(async () => {
      const resp = await fetch('/api/auth/admin/me', { credentials: 'include' });
      const json = await resp.json().catch(() => null);
      return { ok: resp.ok, status: resp.status, json };
    });
    expect(
      adminMe.ok && adminMe.json && adminMe.json.authenticated === true,
      `/api/auth/admin/me did not authenticate after login-admin. Response: ${JSON.stringify(adminMe)}`
    ).toBeTruthy();

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
  });

  test(
    'should show persistent admin snackbar when Steam is unhealthy',
    {
      tag: ['@ui', '@steam', '@error-handling'],
    },
    async ({ page }) => {
      // Layout is loaded on the dashboard route.
      await expect(page.getByText('Steam integration unavailable')).toBeVisible({
        timeout: 10_000,
      });
    }
  );
});

