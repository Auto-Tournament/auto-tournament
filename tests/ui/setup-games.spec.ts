import { test, expect } from '@playwright/test';

/**
 * /setup on a fresh install ends with the games to install: Counter-Strike 2
 * (own servers) on top, the games players report below. A reset-admin code
 * skips it (the fresh-install path needs no admin, so it is checked by hand).
 *
 * @tag ui
 * @tag setup
 */
test.describe('Setup: pick the games', () => {
  test('a reset-admin code goes straight to Settings (no games step)', async ({
    page,
    request,
  }) => {
    const res = await request.post('/api/test/setup-code', { data: { purpose: 'reset' } });
    expect(res.ok(), await res.text()).toBe(true);
    const { code } = (await res.json()) as { code: string };
    const username = `setup${Date.now() % 1e8}`;
    const password = `Setup-${Date.now()}-pass`;

    await page.goto('/setup', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('setup-code').fill(code);
    await page.getByTestId('setup-code-submit').click();
    await page.getByTestId('setup-username').fill(username);
    await page.getByTestId('setup-password').fill(password);
    await page.getByTestId('setup-confirm').fill(password);
    await page.getByTestId('setup-account-submit').click();
    await page.getByTestId('totp-skip').click();

    await expect(page.getByTestId('setup-games')).toHaveCount(0);
    await expect(page).toHaveURL(/\/manage\/settings/, { timeout: 15000 });
  });
});
