import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/** Core's Highlights page (pages/HighlightsAdmin.tsx) and CS2's tab on it. */
test.describe('Highlights page', () => {
  test("settings are core's; CS2 adds its recorders tab", { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/manage/highlights');
    await expect(page.getByTestId('highlights-admin-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('highlights-settings')).toBeVisible();
    await expect(page.getByTestId('highlights-resolution')).toBeVisible();

    const cs2 = page.getByTestId('highlights-tab-cs2');
    await expect(cs2).toBeVisible({ timeout: 30000 });
    await cs2.click();
    await expect(page.getByTestId('cs2-highlights-admin')).toBeVisible();
    await expect(page.getByTestId('highlights-tab-recorders')).toBeVisible();
  });
});
