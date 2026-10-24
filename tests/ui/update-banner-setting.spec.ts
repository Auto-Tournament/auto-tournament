import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * With the admin setting off (`banner: false` from /api/system/update) the
 * update banner stays away, whatever is out; with it on it shows.
 *
 * @tag ui
 */

const update = (banner: boolean) => ({
  success: true,
  running: '3.0.0-beta.81',
  latest: '3.0.0-beta.99',
  available: true,
  releaseUrl: 'https://example.test/3.0.0-beta.99',
  modules: [],
  banner,
});

for (const banner of [true, false]) {
  test(`update banner ${banner ? 'shows' : 'stays away'} when the setting is ${banner ? 'on' : 'off'}`, async ({
    page,
  }) => {
    await page.route('**/api/system/update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(update(banner)),
      })
    );
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate(async () => {
      const resp = await globalThis.fetch('/api/test/login-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId: '76561198000000001' }),
      });
      return resp.ok;
    });
    expect(ok).toBeTruthy();
    await page.goto('/manage', { waitUntil: 'domcontentloaded' });
    if (banner) {
      await expect(page.getByTestId('update-banner')).toHaveCount(1, { timeout: 15_000 });
    } else {
      await expect(page.getByTestId('manage-page').or(page.locator('main')).first()).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('update-banner')).toHaveCount(0);
    }
  });
}

test('the switch in Settings → Admin notifications saves the choice', async ({ page, request }) => {
  await setupTestContext(page, request);
  await page.goto('/manage/settings?section=adminNotices', { waitUntil: 'domcontentloaded' });
  const toggle = page.getByTestId('admin-update-banner-setting');
  await expect(toggle).toBeChecked({ timeout: 15_000 });
  const saved = page.waitForRequest(
    (r) => r.url().endsWith('/api/admin-notices/update-banner') && r.method() === 'PUT'
  );
  await toggle.click();
  expect((await saved).postDataJSON()).toEqual({ enabled: false });
  await expect(toggle).not.toBeChecked();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-update-banner-setting')).not.toBeChecked({
    timeout: 15_000,
  });
  await page.getByTestId('admin-update-banner-setting').click();
  await expect(page.getByTestId('admin-update-banner-setting')).toBeChecked();
});
