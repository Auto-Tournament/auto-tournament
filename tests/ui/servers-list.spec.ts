import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Servers page lists every server once: the servers of each machine, one
 * row each with its state, the match on it and where players connect, then the
 * Ready Up servers on no machine. A row opens its panel.
 *
 * @tag ui
 * @tag servers
 */
const now = Math.floor(Date.now() / 1000);

function machineServer(name: string, fleetId: string, matchInProgress = false) {
  return {
    name,
    dir: `/srv/${name}`,
    game_port: 27015,
    status_port: 27115,
    process: { running: true, restarts_24h: 0, started_at: now - 600 },
    readyup: { installed: '0.1.0', health: 'ok' },
    cs2_build: 1,
    launch_args: [],
    matchInProgress,
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
  servers: [machineServer('server-1', 'f-a', true), machineServer('server-2', 'f-b')],
  enrolledServers: [],
  autoUpdate: null,
  commands: [],
  health: [],
};

function fleetServer(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: 't',
    name,
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
    linkedServerId: null,
    connect: { host: '10.0.0.9', port: 27015, address: '10.0.0.9:27015', source: 'public_addr' },
    ...extra,
  };
}

test(
  'every server is one row; the match shows on its row; a row opens its panel',
  {
    tag: ['@ui', '@servers'],
  },
  async ({ page, request }) => {
    await setupTestContext(page, request);
    await page.route('**/api/fleet/hosts', (route) =>
      route.fulfill({ json: { success: true, hosts: [host], count: 1 } })
    );
    await page.route('**/api/fleet/servers', (route) =>
      route.fulfill({
        json: {
          success: true,
          count: 3,
          servers: [
            fleetServer('f-a', 'server-1', { linkedServerId: 'cs2-a' }),
            fleetServer('f-b', 'server-2'),
            fleetServer('f-solo', 'solo'),
          ],
        },
      })
    );
    await page.route('**/api/tournament/server-availability', (route) =>
      route.fulfill({
        json: {
          success: true,
          availableServerCount: 1,
          gracePeriodSeconds: 0,
          nextAllocationInSeconds: null,
          requiredServerCount: 0,
          simulationEnabled: false,
          servers: [
            {
              id: 'cs2-a',
              name: 'server-1',
              online: true,
              status: 'loaded',
              matchSlug: 'm1',
              matchNumber: 1,
              matchRound: 1,
              updatedAt: now,
              inGraceWindow: false,
              secondsUntilReady: null,
              allocatable: false,
              notAllocatableReason: 'busy',
            },
          ],
        },
      })
    );
    await page.route('**/api/matches/m1', (route) =>
      route.fulfill({
        json: {
          success: true,
          match: {
            slug: 'm1',
            status: 'live',
            team1: { name: 'Alpha' },
            team2: { name: 'Bravo' },
            team1MapScore: 7,
            team2MapScore: 5,
            currentMap: 'de_mirage',
            mapNumber: 0,
            maps: ['de_mirage'],
            liveStatus: 'live',
          },
        },
      })
    );
    await page.goto('/manage/servers');

    await expect(page.getByTestId('servers-limit')).toContainText('3 servers');
    const inMatch = page.getByTestId('server-row-m:h1:server-1');
    await expect(inMatch).toBeVisible();
    await expect(page.getByTestId('server-row-state-m:h1:server-1')).toContainText('Live');
    await expect(inMatch).toContainText('Alpha vs Bravo');
    await expect(inMatch).toContainText('7 – 5');
    await expect(page.getByTestId('server-row-state-m:h1:server-2')).toContainText('Free');
    await expect(page.getByTestId('server-row-address-m:h1:server-2')).toContainText(
      '10.0.0.9:27015'
    );
    await expect(page.getByTestId('server-group-none')).toContainText('solo');

    await inMatch.click();
    await expect(page.getByTestId('server-sheet')).toBeVisible();
    await page.getByTestId('side-sheet-close').click();

    await page.getByTestId('server-row-r:f-solo').click();
    await expect(page.getByTestId('server-sheet-readyup')).toContainText('10.0.0.9:27015');
  }
);
