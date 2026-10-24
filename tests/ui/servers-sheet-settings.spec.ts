import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * A server that plays matches as a platform server opens its settings from
 * its panel, on a machine or not; one outside the match pool has no button.
 *
 * @tag ui
 * @tag servers
 */
const now = Math.floor(Date.now() / 1000);

function machineServer(name: string, fleetId: string) {
  return {
    name,
    dir: `/srv/${name}`,
    game_port: 27015,
    status_port: 27115,
    process: { running: true, restarts_24h: 0, started_at: now - 600 },
    readyup: { installed: '0.1.0', health: 'ok' },
    cs2_build: 1,
    launch_args: [],
    matchInProgress: false,
    fleetServer: {
      id: fleetId,
      name,
      status: 'enrolled',
      online: true,
      availability: 'free',
      readyUpVersion: '0.1.0',
    },
  };
}

const host = {
  id: 'h1',
  name: 'box',
  status: 'enrolled',
  machineId: 'm1',
  enrolledVia: 'code',
  hostname: 'box',
  os: 'linux',
  csmVersion: '1.0.0',
  online: true,
  connectedAt: now,
  lastSeen: now,
  createdAt: now,
  inventory: null,
  inventoryAt: null,
  publicAddress: null,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  servers: [machineServer('server-1', 'f-a'), machineServer('server-2', 'f-b')],
  enrolledServers: [],
  autoUpdate: null,
  commands: [],
  health: [],
};

const record = {
  id: 'cs2-a',
  name: 'ru-a',
  host: '10.0.0.1',
  port: 27015,
  password: '',
  enabled: true,
  transport: 'fleet',
  tournamentUse: true,
  failoverUse: true,
  skins: false,
  createdAt: 1,
  updatedAt: 1,
};

test(
  'a linked server opens its settings from its panel and saves them',
  {
    tag: ['@ui', '@servers'],
  },
  async ({ page, request }) => {
    await setupTestContext(page, request);
    await page.route('**/api/fleet/hosts', (route) =>
      route.fulfill({ json: { success: true, hosts: [host], count: 1 } })
    );
    await page.route('**/api/fleet/servers/f-a', (route) =>
      route.fulfill({ json: { success: true, server: { id: 'f-a', linkedServerId: 'cs2-a' } } })
    );
    await page.route('**/api/fleet/servers/f-b', (route) =>
      route.fulfill({ json: { success: true, server: { id: 'f-b', linkedServerId: null } } })
    );
    let saved: Record<string, unknown> | null = null;
    await page.route(
      (url) => url.pathname === '/api/servers/cs2-a',
      (route) => {
        if (route.request().method() === 'PUT') {
          saved = route.request().postDataJSON();
          return route.fulfill({ json: { success: true, server: { ...record, ...saved } } });
        }
        return route.fulfill({ json: { success: true, server: record } });
      }
    );
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) => route.fulfill({ json: { success: true, servers: [record], count: 1 } })
    );

    await page.goto('/manage/servers');
    await page.getByTestId('server-row-m:h1:server-2').click();
    await expect(page.getByTestId('server-sheet')).toBeVisible();
    await expect(page.getByTestId('server-sheet-settings')).toHaveCount(0);
    await page.getByTestId('side-sheet-close').click();

    await page.getByTestId('server-row-m:h1:server-1').click();
    await page.getByTestId('server-sheet-settings').click();
    const modal = page.getByTestId('server-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('server-tournament-use').click();
    await modal.getByTestId('server-save-button').click();
    await expect(modal).toHaveCount(0);
    expect(saved).toMatchObject({ name: 'ru-a', tournamentUse: false });
  }
);

test(
  'a linked Ready Up server on no machine opens its settings from its panel',
  {
    tag: ['@ui', '@servers'],
  },
  async ({ page, request }) => {
    await setupTestContext(page, request);
    const solo = (id: string, linkedServerId: string | null) => ({
      id,
      tenantId: 't',
      name: id,
      status: 'enrolled',
      online: true,
      availability: 'available',
      versions: { core: '0.1.0', plugin_api: '1', plugins: {} },
      capabilities: [],
      host: null,
      health: null,
      protocol: 1,
      connectedAt: now,
      lastSeen: now,
      createdAt: now,
      token: null,
      rotateRequested: false,
      codeExpiresAt: null,
      linkedServerId,
      connect: { host: '10.0.0.9', port: 27015, address: '10.0.0.9:27015', source: 'public_addr' },
    });
    await page.route('**/api/fleet/hosts', (route) =>
      route.fulfill({ json: { success: true, hosts: [], count: 0 } })
    );
    await page.route('**/api/fleet/servers', (route) =>
      route.fulfill({
        json: {
          success: true,
          count: 2,
          servers: [solo('solo-a', 'cs2-a'), solo('solo-b', null)],
        },
      })
    );
    await page.route(
      (url) => url.pathname === '/api/servers',
      (route) => route.fulfill({ json: { success: true, servers: [record], count: 1 } })
    );

    await page.goto('/manage/servers');
    await page.getByTestId('server-row-r:solo-b').click();
    await expect(page.getByTestId('server-sheet-readyup')).toBeVisible();
    await expect(page.getByTestId('server-sheet-settings')).toHaveCount(0);
    await page.getByTestId('side-sheet-close').click();

    await page.getByTestId('server-row-r:solo-a').click();
    await page.getByTestId('server-sheet-settings').click();
    await expect(page.getByTestId('server-modal')).toBeVisible();
  }
);
