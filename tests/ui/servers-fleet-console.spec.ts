import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetHost, stubFleet, stubHosts } from '../helpers/fleetUi';

/**
 * A Ready Up server's sheet has a console: the live view for admins, the command
 * box for root admins only.
 *
 * @tag ui
 * @tag fleet
 */
test.describe('Ready Up fleet: console', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    await stubFleet(page, []);
    await stubHosts(page, [fleetHost('h1', 'fs_one')]);
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/fs_one/players',
      (route) => route.fulfill({ json: { success: true, players: [] } })
    );
  });

  test('a root admin sends a line and reads the output', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/fleet/root',
      (route) => route.fulfill({ json: { success: true, root: true } })
    );
    let sent: unknown = null;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/fs_one/exec',
      async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({ json: { success: true, response: 'hostname: readyup' } });
      }
    );
    await page.goto('/servers');
    await page.getByTestId('machine-tile-h1-server-1').click();
    const input = page.getByTestId('fleet-console-input');
    await input.fill('status');
    await input.press('Enter');
    await expect(page.getByTestId('fleet-console-output')).toContainText('hostname: readyup');
    expect(sent).toEqual({ command: 'status' });
  });

  test('anyone else gets the live view but no command box', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/fleet/root',
      (route) => route.fulfill({ json: { success: true, root: false } })
    );
    await page.goto('/servers');
    await page.getByTestId('machine-tile-h1-server-1').click();
    await expect(page.getByTestId('server-sheet')).toBeVisible();
    await expect(page.getByText('Console', { exact: true })).toBeVisible();
    await expect(page.getByText('Root admins only')).toBeVisible();
    await expect(page.getByTestId('fleet-console-input')).toHaveCount(0);
  });
});
