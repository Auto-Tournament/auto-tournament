import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';

/**
 * Skin tryout servers (/api/skins/tryout): online Ready Up servers running
 * practice and skins without the match plugin, for the inventory's
 * "Try them in game". A server that takes matches is not one.
 *
 * @tag api
 * @tag skins
 */

async function readyUp(
  request: Parameters<typeof enroll>[0],
  key: string,
  name: string,
  state: { installed: string[]; disabled: string[] }
) {
  const installId = newInstallId();
  const res = await enroll(request, { key }, installId, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const client = await FleetTestClient.connect(res.body.token as string);
  await client.handshake(res.body.server_id as string, installId, {
    stream: { id: `tryout-${installId}`, last_tx_seq: 0, last_rx_seq: 0 },
    plugins_state: state,
  });
  return client;
}

test(
  'tryout servers: practice + skins without match, online; signed-in players only',
  { tag: ['@api'] },
  async ({ request, playwright, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const clients: FleetTestClient[] = [];
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      const key = await createFleetKey(request, { name: `tryout-${Date.now()}` });
      const stamp = Date.now();
      clients.push(
        await readyUp(request, key.value, `tryout-${stamp}`, {
          installed: ['fleet', 'match', 'essentials', 'practice', 'skins'],
          disabled: ['match'],
        })
      );
      clients.push(
        await readyUp(request, key.value, `matches-${stamp}`, {
          installed: ['fleet', 'match', 'essentials', 'practice', 'skins'],
          disabled: [],
        })
      );

      const anon = await playwright.request.newContext({ baseURL });
      expect((await anon.get('/api/skins/tryout')).status()).toBe(401);
      expect(await signInAsPlayerViaRequest(anon, '76561198099990311', 'Tryout Player')).toBe(true);
      await expect
        .poll(
          async () =>
            ((await (await anon.get('/api/skins/tryout')).json()).servers ?? []).map(
              (s: { name: string }) => s.name
            ),
          { timeout: 10000 }
        )
        .toContain(`tryout-${stamp}`);
      const servers = (await (await anon.get('/api/skins/tryout')).json()).servers as Array<{
        name: string;
        address: string;
        port: number;
      }>;
      expect(servers.map((s) => s.name)).not.toContain(`matches-${stamp}`);
      const mine = servers.find((s) => s.name === `tryout-${stamp}`)!;
      expect(mine.address).toMatch(/:\d+$/);
      await anon.dispose();

      // Skins off: nothing to try.
      await request.put('/api/skins/admin/config', { headers, data: { enabled: false } });
      const player = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(player, '76561198099990311', 'Tryout Player')).toBe(
        true
      );
      expect((await player.get('/api/skins/tryout')).status()).toBe(404);
      await player.dispose();
    } finally {
      for (const c of clients) c.close();
      await request.put('/api/skins/admin/config', { headers, data: config });
    }
  }
);
