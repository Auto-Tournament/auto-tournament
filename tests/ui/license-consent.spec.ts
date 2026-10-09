import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * The license terms step: until an admin accepts the terms, admin pages send
 * them to /welcome/license, and typing I AGREE lets them through to the page
 * they asked for. Public pages are never sent there. The E2E server
 * pre-accepts (AT_ACCEPT_LICENSE), so each test forgets the acceptance first
 * and the suite puts it back afterwards.
 *
 * @tag ui
 * @tag settings
 */

async function clearConsent(request: APIRequestContext) {
  const res = await request.post('/api/test/license-consent', { data: { action: 'clear' } });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe.serial('License consent UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
    await clearConsent(page.request);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/license-consent', { data: { action: 'restore' } });
  });

  test('an admin page waits for the terms; typing I AGREE opens it', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/manage/teams');
    await expect(page).toHaveURL(/\/welcome\/license\?next=%2Fmanage%2Fteams/);
    await expect(page.getByTestId('license-consent-page')).toBeVisible();
    await expect(page.getByTestId('license-consent-summary')).toBeVisible();

    // Another admin page lands here too.
    await page.goto('/manage/settings');
    await expect(page).toHaveURL(/\/welcome\/license/);

    const accept = page.getByTestId('license-consent-accept');
    await expect(accept).toBeDisabled();

    await page.getByTestId('license-consent-noncommercial').check();
    await page.getByTestId('license-consent-confirm').fill('I agre');
    await expect(accept).toBeDisabled();
    await page.getByTestId('license-consent-confirm').fill('i agree');
    await expect(accept).toBeEnabled();
    await accept.click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('license-consent-page')).toHaveCount(0);

    // Settings > License shows what was declared.
    await page.goto('/manage/settings?section=license');
    await expect(page.getByTestId('settings-license-consent-use')).toHaveText('Non-commercial use');
  });

  test('Settings > License: change to commercial, accepting again', { tag: ['@ui', '@settings'] }, async ({ page }) => {
    // No saved key (an earlier spec in the same shard may have left one), so
    // commercial use shows the "needs a key" note below.
    const cleared = await page.request.delete('/api/license');
    expect([200, 204, 404]).toContain(cleared.status());
    // Accept once through the page, then change it from Settings.
    await page.goto('/manage/settings?section=license');
    await expect(page).toHaveURL(/\/welcome\/license/);
    await page.getByTestId('license-consent-noncommercial').check();
    await page.getByTestId('license-consent-confirm').fill('I AGREE');
    await page.getByTestId('license-consent-accept').click();
    await expect(page.getByTestId('settings-license-consent-use')).toHaveText('Non-commercial use');

    await page.getByTestId('settings-license-consent-change').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('license-consent-commercial').check();
    await expect(dialog.getByTestId('license-consent-key')).toBeVisible();
    await expect(dialog.getByTestId('license-consent-accept')).toBeDisabled();
    await dialog.getByTestId('license-consent-confirm').fill('I AGREE');
    await dialog.getByTestId('license-consent-accept').click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('settings-license-consent-use')).toHaveText('Commercial use');
    // Commercial without a key: a friendly note, nothing locked.
    await expect(page.getByTestId('settings-license-consent-needs-key')).toBeVisible();
  });

  test('public pages are never sent to the terms', { tag: ['@ui'] }, async ({ browser, baseURL }) => {
    const visitor = await browser.newContext({ baseURL });
    try {
      const page = await visitor.newPage();
      await page.goto('/browse');
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/welcome\/license/);
      await page.goto('/compatibility');
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/welcome\/license/);
    } finally {
      await visitor.close();
    }
  });
});
