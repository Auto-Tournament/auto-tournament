import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createPlayer } from '../helpers/players';

/**
 * Admins (and the MCP server) equip a player's skins as the player would:
 * POST /api/skins/admin/players/:steamId/equip and DELETE …/equip/:slot.
 *
 * @tag api
 * @tag skins
 */
test.describe('Skins: admin equips for a player', () => {
  test('equip a knife on one side, then empty the slot', async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    const before = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
    try {
      const steamId = `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
      expect(await createPlayer(request, { id: steamId, name: 'Equip Target' })).not.toBeNull();
      const given = await request.post(`/api/skins/admin/players/${steamId}/skins`, {
        headers,
        data: { weapon: 'weapon_knife_karambit', paintKit: 417, float: 0.01 },
      });
      expect(given.ok(), await given.text()).toBe(true);
      const { id } = (await given.json()) as { id: number };

      const equip = await request.post(`/api/skins/admin/players/${steamId}/equip`, {
        headers,
        data: { skinId: id, team: 3 },
      });
      expect(equip.ok(), await equip.text()).toBe(true);
      const inv = async () =>
        (
          (
            await (
              await request.get(`/api/skins/admin/players/${steamId}/inventory`, { headers })
            ).json()
          ).inventory as Array<{ id: number; equipped: boolean; equippedSides: number[] }>
        ).find((s) => s.id === id);
      // (A first skin in a slot is equipped on both sides when given; CT is set now too.)
      const equipped = await inv();
      expect(equipped?.equipped).toBe(true);
      expect(equipped?.equippedSides).toContain(3);

      const empty = await request.delete(`/api/skins/admin/players/${steamId}/equip/knife`, {
        headers,
      });
      expect(empty.ok(), await empty.text()).toBe(true);
      expect((await inv())?.equipped).toBe(false);

      // Not a player: 404.
      const none = await request.post('/api/skins/admin/players/76561190000000001/equip', {
        headers,
        data: { skinId: id, team: 0 },
      });
      expect(none.status()).toBe(404);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: before });
    }
  });
});
