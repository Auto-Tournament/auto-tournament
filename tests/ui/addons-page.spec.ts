import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * Modules → Add-ons: an admin turns an add-on on and off from the page,
 * and it sticks (the test-only add-on, addons/testAddon.ts).
 *
 * @tag ui
 */
test.describe.serial('Add-ons on the Modules page', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    expect(await signInViaRequest(request)).toBe(true);
    await request.put('/api/addons/test-addon', { data: { enabled: false } });
  });

  test('an admin turns an add-on on and off', { tag: ['@ui'] }, async ({ page, request }) => {
    await page.goto('/manage/modules');
    const card = page.getByTestId('addon-test-addon');
    await expect(card).toBeVisible({ timeout: 15000 });
    const toggle = page.getByTestId('addon-toggle-test-addon').locator('input');
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => (await request.get('/api/addons/test-addon/state')).status())
      .toBe(200);

    await page.reload();
    await expect(page.getByTestId('addon-toggle-test-addon').locator('input')).toBeChecked();
    await page.getByTestId('addon-toggle-test-addon').locator('input').click();
    await expect
      .poll(async () => (await request.get('/api/addons/test-addon/state')).status())
      .toBe(404);
  });

  test('an add-on with no page says so', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/manage/modules/test-addon');
    await expect(page.getByTestId('addon-page-missing')).toBeVisible({ timeout: 15000 });
  });
});
