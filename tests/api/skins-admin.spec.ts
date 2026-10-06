import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Admin inventory management: find a player, give an exact skin (a Doppler
 * phase, with float and pattern), see it in their inventory, take it away.
 *
 * @tag api
 */

const STEAM_ID = '76561198099990077';

test.describe.serial('Skins admin inventory', () => {
  test('gives and takes away skins', { tag: ['@api'] }, async ({ request, playwright, baseURL }) => {
    await signInViaRequest(request);
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/skins/admin/players')).status()).toBe(401);
    expect((await anon.delete('/api/skins/admin/skins/1')).status()).toBe(401);

    const player = await playwright.request.newContext({ baseURL });
    expect(await signInAsPlayerViaRequest(player, STEAM_ID, 'Inventory Admin Tester')).toBe(true);

    const found = await (await request.get(`/api/skins/admin/players?q=${STEAM_ID}`, { headers: getAuthHeader() })).json();
    expect(found.players).toEqual([expect.objectContaining({ steamId: STEAM_ID, skins: 0 })]);

    const unknown = await request.post('/api/skins/admin/players/76561198000000999/skins', {
      headers: getAuthHeader(),
      data: { weapon: 'weapon_ak47', paintKit: 44 },
    });
    expect(unknown.status()).toBe(404);

    // Every phase of a Doppler is its own catalogue row. The catalogue comes
    // from GitHub; without it there is nothing to give.
    const catalog = await (
      await request.get('/api/skins/admin/catalog?all=1&q=karambit doppler', { headers: getAuthHeader() })
    ).json();
    const sapphire = (catalog.skins ?? []).find((s: { variant: string | null }) => s.variant === 'Sapphire');
    test.skip(!sapphire, 'The skin catalogue could not be read');

    const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
      headers: getAuthHeader(),
      data: { weapon: sapphire.weapon, paintKit: sapphire.paintKit, float: 0.0123, pattern: 661 },
    });
    expect(given.ok()).toBe(true);
    const { id } = await given.json();

    const inventory = await (
      await request.get(`/api/skins/admin/players/${STEAM_ID}/inventory`, { headers: getAuthHeader() })
    ).json();
    expect(inventory.inventory).toEqual([
      expect.objectContaining({ id, name: 'Doppler (Sapphire)', float: 0.0123, pattern: 661, source: 'admin' }),
    ]);

    expect((await request.delete(`/api/skins/admin/skins/${id}`, { headers: getAuthHeader() })).ok()).toBe(true);
    expect((await request.delete(`/api/skins/admin/skins/${id}`, { headers: getAuthHeader() })).status()).toBe(404);
    const after = await (
      await request.get(`/api/skins/admin/players/${STEAM_ID}/inventory`, { headers: getAuthHeader() })
    ).json();
    expect(after.inventory).toEqual([]);

    await anon.dispose();
    await player.dispose();
  });
});
