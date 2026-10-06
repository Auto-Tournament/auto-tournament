import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Virtual skins: off by default, every player route 404s until an admin
 * turns them on; the settings are admin only.
 *
 * @tag api
 */

test.describe.serial('Skins', () => {
  test('are off until an admin turns them on', { tag: ['@api'] }, async ({ request, playwright, baseURL }) => {
    await signInViaRequest(request);
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/skins/admin/config')).status()).toBe(401);

    const off = await request.put('/api/skins/admin/config', { headers: getAuthHeader(), data: { enabled: false } });
    expect(off.ok()).toBe(true);
    expect((await (await anon.get('/api/skins/status')).json()).enabled).toBe(false);

    const player = await playwright.request.newContext({ baseURL });
    expect(await signInAsPlayerViaRequest(player, '76561198099990001', 'Skin Tester')).toBe(true);
    expect((await player.get('/api/skins/me')).status()).toBe(404);

    const on = await request.put('/api/skins/admin/config', {
      headers: getAuthHeader(),
      data: { enabled: true, dropChance: 150, rarityWeights: { common: -5 } },
    });
    const config = (await on.json()).config;
    // Out-of-range values are clamped, not stored.
    expect(config).toMatchObject({ enabled: true, dropChance: 100 });
    expect(config.rarityWeights.common).toBe(0);

    const me = await player.get('/api/skins/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ inventory: [], showcase: [], unseen: [] });
    expect((await player.post('/api/skins/me/equip', { data: { skinId: 999999 } })).status()).toBe(404);

    await request.put('/api/skins/admin/config', { headers: getAuthHeader(), data: { enabled: false } });
    await anon.dispose();
    await player.dispose();
  });
});
