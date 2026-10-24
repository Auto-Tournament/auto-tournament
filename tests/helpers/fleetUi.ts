import type { Page } from '@playwright/test';

/** A Ready Up server as GET /api/fleet/servers lists it, for UI specs that stub the list. */
export const fleetServer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenantId: 'default',
  name: `ru-${id}`,
  status: 'enrolled',
  installId: `inst-${id}`,
  enrolledVia: 'key',
  enrollmentKeyId: null,
  online: true,
  availability: 'available',
  availabilityReason: null,
  availabilityDetail: null,
  versions: { core: '0.1.0', plugin_api: '1.11', plugins: { fleet: '0.1.0' }, cs2_build: 14032 },
  readyUpUpdate: { state: 'current', running: '0.1.0', latest: '0.1.0', releaseUrl: null },
  capabilities: ['match.v1'],
  host: { hostname: id, game_port: 27015 },
  health: null,
  protocol: 1,
  connectedAt: 1,
  lastSeen: 1,
  createdAt: 1,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  linkedServerId: `cs2-${id}`,
  connect: null,
  ...over,
});

export async function stubFleet(page: Page, servers: unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/fleet/servers',
    (route) => route.fulfill({ json: { success: true, count: servers.length, servers } })
  );
  await page.route(
    (url) => url.pathname === '/api/fleet/keys',
    (route) => route.fulfill({ json: { success: true, keys: [] } })
  );
}

/** A csm machine with one server, as GET /api/fleet/hosts lists it, for UI specs that stub the list. */
export const fleetHost = (
  id: string,
  fleetServerId: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  name: `machine-${id}`,
  status: 'enrolled',
  machineId: `m-${id}`,
  enrolledVia: 'code',
  hostname: `host-${id}`,
  os: 'linux',
  csmVersion: '0.1.0',
  online: true,
  connectedAt: 1,
  lastSeen: 1,
  createdAt: 1,
  inventory: null,
  inventoryAt: null,
  publicAddress: null,
  token: null,
  rotateRequested: false,
  codeExpiresAt: null,
  servers: [
    {
      name: 'server-1',
      dir: '/srv/server-1',
      game_port: 27015,
      status_port: 27022,
      process: { running: true, restarts_24h: 0 },
      readyup: { installed: '0.1.0', health: 'ok', phase: 'idle', update_safe: true },
      cs2_build: 14032,
      launch_args: [],
      fleetServer: {
        id: fleetServerId,
        name: 'ru-server-1',
        status: 'enrolled',
        online: true,
        availability: 'available',
        readyUpVersion: '0.1.0',
      },
      matchInProgress: false,
    },
  ],
  enrolledServers: [],
  autoUpdate: null,
  commands: [],
  health: [],
  ...over,
});

export async function stubHosts(page: Page, hosts: unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/fleet/hosts',
    (route) => route.fulfill({ json: { success: true, count: hosts.length, hosts } })
  );
}
