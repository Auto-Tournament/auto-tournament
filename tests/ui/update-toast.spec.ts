import { test, expect, type Page } from '@playwright/test';

/**
 * The admin's "a newer Auto Tournament is out" toast (UpdateToast): one at a
 * time, its release notes clickable, closing it closes only it, and a
 * dismissed version stays dismissed while a newer one shows again.
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

test.describe.serial('Platform update toast', () => {
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

  test('one toast per update, clickable notes, closing one keeps the other, dismissal per version', async ({
    page,
  }) => {
    // The update toasts are Manage's (the admin dashboard).
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-toast')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('module-update-toast')).toHaveCount(1);

    // Moving around the app does not add the same toast again.
    await page.goto('/manage/teams', { waitUntil: 'domcontentloaded' });
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-toast')).toHaveCount(1, { timeout: 15_000 });

    // The release notes take a real click (a toast's message used to be inert).
    const notes = page.getByTestId('update-toast').getByRole('link');
    const popup = page.waitForEvent('popup');
    await notes.click();
    await (await popup).close();

    // Closing the platform toast leaves the module's.
    const platformToast = page.locator('.notistack-SnackbarContainer > *', {
      has: page.getByTestId('update-toast'),
    });
    await platformToast.getByTestId('snackbar-close-button').click();
    await expect(page.getByTestId('update-toast')).toHaveCount(0);
    await expect(page.getByTestId('module-update-toast')).toHaveCount(1);

    // Dismissed: it stays away on reload; a newer version shows again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('module-update-toast')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('update-toast')).toHaveCount(0);
    latest = '3.0.0-beta.83';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('update-toast')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('update-toast')).toContainText('3.0.0-beta.83');
  });
});
