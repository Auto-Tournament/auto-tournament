import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer } from '../helpers/servers';

/**
 * Server UI tests.
 *
 * Servers come only through csm now: the page has no "add a server by
 * address". One added by address before (here: through the API) is listed
 * under "Servers not on a machine", opens its settings, and can be removed.
 *
 * @tag ui
 * @tag servers
 * @tag crud
 */

test.describe.serial('Server UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'a server added by address is listed apart from the machines, and can be removed',
    {
      tag: ['@ui', '@servers', '@crud'],
    },
    async ({ page, request }) => {
      const server = await createTestServer(request, 'ui');
      expect(server, 'creating a server through the API').toBeTruthy();

      await page.goto('/manage/servers');
      // Nothing on the page adds a server by address.
      await expect(page.getByTestId('machines-add')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('add-server-button')).toHaveCount(0);
      await expect(page.getByTestId('servers-add-existing')).toHaveCount(0);

      const other = page.getByTestId('servers-other');
      await expect(other).toBeVisible({ timeout: 15000 });
      const card = page.getByTestId(`server-card-${server!.name.replace(/\s+/g, '-').toLowerCase()}`);
      await expect(card).toBeVisible();
      await expect(card.getByTestId('server-host')).toContainText(`${server!.host}:${server!.port}`);

      // Its settings open from the card; delete it there.
      await card.click();
      const modal = page.getByTestId('server-modal');
      await expect(modal).toBeVisible();
      await page.getByTestId('server-delete-button').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();
      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/servers') && resp.request().method() === 'DELETE',
          { timeout: 15000 }
        ),
        page.getByTestId('confirm-dialog-confirm-button').click(),
      ]);
      expect(deleteResponse.ok(), 'DELETE /api/servers should succeed').toBe(true);
      await expect(card).toHaveCount(0);
    }
  );
});
