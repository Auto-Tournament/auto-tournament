import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

test(
  'long account names stay inside the Manage rail',
  { tag: ['@ui', '@navigation'] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1237, height: 1292 });
    await page.route('**/api/players/*/summary', (route) =>
      route.fulfill({
        json: { success: true, player: { name: 'Test Admin 76561198000000001'.repeat(3) } },
      })
    );
    await ensureSignedIn(page);
    await page.goto('/manage');

    const rail = page.getByTestId('manage-rail');
    const account = rail.getByRole('button', { name: 'Account menu', exact: true });
    await expect(account).toBeVisible();
    await expect(account).toContainText('Test Admin');
    const railBounds = await rail.boundingBox();
    const accountBounds = await account.boundingBox();
    expect(railBounds).not.toBeNull();
    expect(accountBounds).not.toBeNull();
    if (!railBounds || !accountBounds) throw new Error('Rail and account must be visible');
    expect(accountBounds.x).toBeGreaterThanOrEqual(railBounds.x);
    expect(accountBounds.x + accountBounds.width).toBeLessThanOrEqual(
      railBounds.x + railBounds.width
    );

    await account.click();
    await expect(page.getByRole('menu')).toBeVisible();
  }
);
