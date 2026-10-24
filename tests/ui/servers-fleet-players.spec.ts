import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { fleetHost, stubFleet, stubHosts } from '../helpers/fleetUi';

/**
 * A Ready Up server's sheet lists who is connected (its last snapshot) and
 * kicks one after a confirm, with an optional message.
 *
 * @tag ui
 * @tag fleet
 */
test.describe('Ready Up fleet: players', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test('the sheet lists the players and a kick sends the SteamID and the message', async ({
    page,
  }) => {
    await stubFleet(page, []);
    await stubHosts(page, [fleetHost('h1', 'fs_one')]);
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/fs_one/players',
      (route) =>
        route.fulfill({
          json: {
            success: true,
            players: [
              { steamid64: '76561198000000001', name: 'alice', team: 'ct' },
              { steamid64: '76561198000000002', name: 'bob', team: 'spectator' },
            ],
          },
        })
    );
    let kicked: unknown = null;
    await page.route(
      (url) => url.pathname === '/api/fleet/servers/fs_one/kick',
      async (route) => {
        kicked = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true } });
      }
    );
    await page.goto('/servers');
    await page.getByTestId('machine-tile-h1-server-1').click();
    const sheet = page.getByTestId('server-sheet');
    await expect(sheet.getByText('alice')).toBeVisible();
    await expect(sheet.getByText('bob')).toBeVisible();
    await sheet.getByTestId('fleet-kick-76561198000000002').click();
    await page.getByRole('dialog').getByLabel('Message shown on kick (optional)').fill('afk');
    await page.getByRole('dialog').getByRole('button', { name: 'Kick' }).click();
    await expect(page.getByText('bob kicked')).toBeVisible();
    expect(kicked).toEqual({ steamid64: '76561198000000002', message: 'afk' });
  });
});
