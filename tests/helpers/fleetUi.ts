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
