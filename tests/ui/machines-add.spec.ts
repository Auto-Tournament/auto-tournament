import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createPendingHost } from '../helpers/fleetHost';

/**
 * Servers → Add machine shows the platform's one line (it installs csm when
 * missing and links the machine), not a bare `csm link`.
 *
 * @tag ui
 * @tag fleet
 */
test.describe('Add machine', () => {
  test('the dialog shows the one-line install-and-link command', async ({ page, request }) => {
    await setupTestContext(page, request);
    // A machine already listed: Add machine opens the dialog (not the first-machine guide).
    await createPendingHost(request, `listed-${Date.now()}`);
    await page.goto('/manage/servers', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('machines-add').click();
    await page.getByTestId('machines-create-code').click();
    const command = page.getByTestId('machines-link-command');
    await expect(command).toBeVisible({ timeout: 15000 });
    await expect(command).toContainText('curl -fsSL');
    await expect(command).toContainText('/api/fleet/install-csm.sh | bash -s -- RUE-');
  });
});
