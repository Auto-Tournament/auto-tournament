import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

/**
 * Settings → API tokens: the section opens (from the menu and by its
 * address), a token is made and shown once, and it can be revoked.
 *
 * @tag ui
 * @tag settings
 */
test('make and revoke an API token in Settings', { tag: ['@ui'] }, async ({ page }) => {
  expect(await signIn(page)).toBe(true);
  await page.goto('/manage/settings');
  await page.getByRole('link', { name: /API tokens/ }).click();
  await expect(page).toHaveURL(/section=apitokens/);
  const card = page.getByTestId('api-tokens');
  await expect(card).toBeVisible();

  const label = `ui-${String(Date.now()).slice(-8)}`;
  await page.getByTestId('api-token-name').fill(label);
  await page.getByTestId('api-token-make').click();
  await expect(page.getByTestId('api-token-secret')).toHaveText(/^att_[0-9a-f]{64}$/);
  await page.keyboard.press('Escape');

  await page.getByTestId(`api-token-revoke-${label}`).click();
  await page.getByTestId('api-token-revoke-confirm').click();
  await expect(page.getByTestId(`api-token-revoke-${label}`)).toHaveCount(0);

  // The address alone opens it too.
  await page.goto('/manage/settings?section=apitokens');
  await expect(page.getByTestId('api-tokens')).toBeVisible();
});
