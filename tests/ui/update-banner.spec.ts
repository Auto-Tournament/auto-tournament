import { test, expect, type Page } from '@playwright/test';

/**
 * The admin's "a newer Auto Tournament is out" banner (UpdateBanner) across
 * the top of Manage: one per update, its release notes clickable, closing it
 * closes only it, and a closed version stays closed while a newer one shows
 * again.
 *
 * @tag ui
 */

const update = (latest: string) => ({
  success: true,
  running: '3.0.0-beta.81',
  latest,
  available: true,
  releaseUrl: `https://example.test/${latest}`,
  modules: [
    {
      kind: 'module',
      id: 'cs2',
      name: 'Counter-Strike 2',
      installed: '3.0.0-beta.81',
      available: '3.0.0-beta.82',
      problem: null,
    },
  ],
});

async function signInAdmin(page: Page) {
  const steamId = process.env.TEST_STEAM_ID || '76561198000000001';
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const ok = await page.evaluate(async (id) => {
    const resp = await globalThis.fetch('/api/test/login-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId: id }),
    });
    return resp.ok;
  }, steamId);
  expect(ok).toBeTruthy();
}

test.describe.serial('Platform update banner', () => {
  let latest = '3.0.0-beta.82';

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/system/update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(update(latest)),
      })
    );
    await signInAdmin(page);
  });

  test('one banner per update, clickable notes, closing one keeps the other, dismissal per version', async ({
    page,
  }) => {
    // The update banners are Manage's (the admin dashboard).
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-banner')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('module-update-banner')).toHaveCount(1);

    // Moving around the app does not add the same banner again.
    await page.goto('/manage/teams', { waitUntil: 'domcontentloaded' });
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-banner')).toHaveCount(1, { timeout: 15_000 });

    // The release notes take a real click.
    const notes = page.getByTestId('update-banner').getByRole('link');
    const popup = page.waitForEvent('popup');
    await notes.click();
    await (await popup).close();

    // Closing the platform banner leaves the module's.
    await page.getByTestId('update-banner').getByTestId('update-banner-close').click();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    await expect(page.getByTestId('module-update-banner')).toHaveCount(1);

    // Dismissed: it stays away on reload; a newer version shows again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('module-update-banner')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    latest = '3.0.0-beta.83';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-banner')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('update-banner')).toContainText('3.0.0-beta.83');
  });
});
