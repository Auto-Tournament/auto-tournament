import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';

/**
 * The admins' bell in the top bar: a notice raised on the server shows there
 * live (and as a toast), opens where it can be fixed, and can be dismissed;
 * Settings has the per-kind delivery.
 *
 * @tag ui
 */

test.describe.serial('Admin notices', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'a notice shows on the bell, live, and can be dismissed',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await page.goto('/manage/settings?section=adminNotices');
      await expect(page.getByTestId('admin-notices-settings')).toBeVisible();
      await expect(page.getByTestId('admin-notice-setting-recorder_offline')).toBeAttached();

      const bell = page.getByTestId('admin-notice-bell');
      await expect(bell).toBeVisible();
      const key = `recorder_offline:ui-${Date.now()}`;
      const raised = await request.post('/api/test/admin-notice', {
        headers: getAuthHeader(),
        data: { kind: 'recorder_offline', data: { recorder: 'ui-recorder' }, dedupeKey: key },
      });
      expect(raised.ok(), await raised.text()).toBe(true);

      await bell.click();
      const row = page.getByTestId('admin-notice').filter({ hasText: 'ui-recorder' });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /dismiss/i }).click();
      await expect(row).toContainText(/resolved/i);
    }
  );
});
