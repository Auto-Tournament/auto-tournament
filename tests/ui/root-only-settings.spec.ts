import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Settings -> Sign-in for an admin who is not root: the Admin Steam IDs field
 * and the switches that make a local account an admin are disabled.
 *
 * @tag ui
 * @tag settings
 */

test(
  'a non-root admin cannot edit the Admin Steam IDs or grant local admin',
  {
    tag: ['@ui', '@settings'],
  },
  async ({ page }) => {
    expect(await signInViaRequest(page.request, '76561198000000072')).toBe(true);
    await page.goto('/manage/settings?section=signin');
    await page.getByTestId('admin-access').getByRole('button').first().click();
    await expect(page.getByTestId('admin-access-steam-ids')).toBeDisabled();
    await expect(page.getByTestId('admin-access-emails')).toBeEnabled();
    await page.getByTestId('local-accounts').getByRole('button').first().click();
    // The last switch is "Admin" on the new-account form.
    await expect(
      page.getByTestId('local-accounts').getByRole('switch', { name: 'Admin' }).last()
    ).toBeDisabled();
  }
);
