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

  test(
    'notices of one kind stack: one row, the rest behind "more like this"',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await page.goto('/manage');
      const stamp = Date.now();
      for (const name of [`stack-a-${stamp}`, `stack-b-${stamp}`]) {
        const raised = await request.post('/api/test/admin-notice', {
          headers: getAuthHeader(),
          data: {
            kind: 'recorder_offline',
            data: { recorder: name },
            dedupeKey: `recorder_offline:${name}`,
          },
        });
        expect(raised.ok(), await raised.text()).toBe(true);
      }

      await page.getByTestId('admin-notice-bell').click();
      const newest = page.getByTestId('admin-notice').filter({ hasText: `stack-b-${stamp}` });
      const older = page.getByTestId('admin-notice').filter({ hasText: `stack-a-${stamp}` });
      await expect(newest).toBeVisible();
      await expect(older).toHaveCount(0);

      const stack = newest.locator('xpath=following-sibling::*[1]');
      await stack.getByRole('button', { name: /more like this/i }).click();
      await expect(older).toBeVisible();
      await stack.getByRole('button', { name: /dismiss all/i }).click();
      await expect(newest).toContainText(/resolved/i);
      await expect(older).toContainText(/resolved/i);
    }
  );

  test(
    'opening a notice shows it at the top of its page, with what to do',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await page.goto('/manage');
      const key = `autoscale_license:ui-${Date.now()}`;
      const raised = await request.post('/api/test/admin-notice', {
        headers: getAuthHeader(),
        data: { kind: 'autoscale_license', data: {}, dedupeKey: key },
      });
      expect(raised.ok(), await raised.text()).toBe(true);

      await page.getByTestId('admin-notice-bell').click();
      await page
        .getByTestId('admin-notice')
        .filter({ hasText: 'license has no room' })
        .first()
        .click();
      await expect(page).toHaveURL(/\/manage\/servers\?notice=\d+/);
      const card = page.getByTestId('notice-card');
      await expect(card).toContainText('license has no room');
      await expect(card).toContainText('Every server the license covers is running');

      await card.getByTestId('notice-card-dismiss').click();
      await expect(card).toHaveCount(0);
      await expect(page).not.toHaveURL(/notice=/);
    }
  );
});
