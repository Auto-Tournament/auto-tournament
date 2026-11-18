import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { FakeCsm, createPendingHost, enrollHost, newMachineId } from '../helpers/fleetHost';

/**
 * Map and skin pictures come from a csm host's CS2 install (host.asset): the
 * platform asks, the host uploads to PUT /api/fleet/host/assets/:id, and the
 * platform serves and caches it.
 */

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function link(request: APIRequestContext) {
  const pending = await createPendingHost(request, 'pictures-spec');
  const machineId = newMachineId();
  const res = await enrollHost(request, { code: pending.code }, machineId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const csm = await FakeCsm.connect(res.body.token, res.body.host_id, machineId);
  await csm.handshake({
    capabilities: ['host.v1', 'assets.v1'],
  });
  return { csm, token: res.body.token as string };
}

test.describe.serial('CS2 pictures from a csm host', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('asked once from the host, then served from the cache', async ({ request, playwright }) => {
    const { csm, token } = await link(request);
    const file = `weapon_ak47_cu_spec_${Date.now()}.webp`;
    const picture = request.get(`/api/game/cs2/img/skins-256/${file}`);

    const ask = await csm.nextCommand('host.asset');
    expect(ask.payload).toMatchObject({ set: 'skins-256', file });
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const bad = await anon.put(`/api/fleet/host/assets/${ask.id}`, {
      headers: {
        Authorization: 'Bearer rhs_aaaaaaaaaaaa_' + 'a'.repeat(43),
        'Content-Type': 'image/png',
      },
      data: PNG,
    });
    expect(bad.status()).toBe(401);
    const up = await anon.put(`/api/fleet/host/assets/${ask.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      data: PNG,
    });
    expect(up.status(), await up.text()).toBe(204);
    csm.sendReliable('host.result', { status: 'ok', output: 'uploaded' }, { ref: ask.id });

    const res = await picture;
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect(Buffer.compare(await res.body(), PNG)).toBe(0);

    const again = await request.get(`/api/game/cs2/img/skins-256/${file}`);
    expect(again.status()).toBe(200);
    await expect(csm.nextCommand('host.asset', 1000)).rejects.toThrow();
    await anon.dispose();
    csm.close();
  });

  test('a picture the host does not have is a 404', async ({ request }) => {
    const { csm } = await link(request);
    const picture = request.get(`/api/game/cs2/img/maps-480/de_spec_${Date.now()}.webp`);
    const ask = await csm.nextCommand('host.asset');
    csm.sendReliable(
      'host.result',
      { status: 'failed', error: { code: 'not_found', message: 'not in this install' } },
      { ref: ask.id }
    );
    expect((await picture).status()).toBe(404);
    csm.close();
  });

  test('odd names are refused without asking a host', async ({ request }) => {
    for (const path of ['skins/..%2Fpak01.webp', 'nope/de_dust2.webp', 'skins/A.webp']) {
      expect((await request.get(`/api/game/cs2/img/${path}`)).status()).toBe(404);
    }
  });
});
