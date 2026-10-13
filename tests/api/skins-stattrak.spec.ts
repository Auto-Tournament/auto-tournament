import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import {
  loadoutPayload,
  rollStatTrak,
  statTrakCapable,
} from '../../api/src/integrations/cs2/skins/skinService';
import { WEAPON_DEFINDEX } from '../../api/src/integrations/cs2/skins/skinDefindex';

/**
 * StatTrak: weapons and knives can drop as StatTrak (gloves cannot), the
 * loadout carries the count to Ready Up, and Ready Up's kill reports go on the
 * player's equipped StatTrak skin.
 *
 * @tag api
 * @tag skins
 */

test.describe('StatTrak (rules)', () => {
  test('weapons and knives can be StatTrak, gloves cannot', () => {
    expect(statTrakCapable('weapon_ak47')).toBe(true);
    expect(statTrakCapable('weapon_knife_butterfly')).toBe(true);
    expect(statTrakCapable('sporty_gloves')).toBe(false);
    expect(rollStatTrak('weapon_ak47', 100)).toBe(true);
    expect(rollStatTrak('weapon_ak47', 0)).toBe(false);
    expect(rollStatTrak('sporty_gloves', 100)).toBe(false);
  });

  test('the loadout sends the count only for a StatTrak skin', () => {
    const base = { paint_kit: 44, float_value: 0.1, pattern: 1, slot: 'weapon_ak47', team: 0 };
    const payload = loadoutPayload([
      { ...base, weapon: 'weapon_ak47', stattrak: 12 },
      { ...base, weapon: 'weapon_mp7', slot: 'weapon_mp7', stattrak: null },
    ]);
    expect(payload?.paints[0]).toMatchObject({ stattrak: 12 });
    expect(payload?.paints[1]).not.toHaveProperty('stattrak');
  });
});

test(
  'a StatTrak drop counts the kills Ready Up reports',
  { tag: ['@api'] },
  async ({ request, playwright }) => {
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const steamId = `7656119806${String(Date.now()).slice(-7)}`;
    const player = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await request.put('/api/skins/admin/config', {
        headers,
        data: { enabled: true, statTrakChance: 100 },
      });
      expect(await signInAsPlayerViaRequest(player, steamId, 'StatTrak Tester')).toBe(true);
      const skins = ((
        await (await request.get('/api/skins/admin/catalog?q=mp7', { headers })).json()
      ).skins ?? []) as Array<{ weapon: string; paintKit: number }>;
      test.skip(!skins[0], 'The skin catalogue could not be read');
      // At 100 % every weapon an admin gives is StatTrak.
      const given = await request.post(`/api/skins/admin/players/${steamId}/skins`, {
        headers,
        data: { weapon: skins[0].weapon, paintKit: skins[0].paintKit },
      });
      expect(given.ok(), await given.text()).toBe(true);

      const inventory = (await (await player.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
        weapon: string;
        stattrak: number | null;
        equipped: boolean;
      }>;
      const skin = inventory.find((s) => s.weapon === skins[0].weapon)!;
      expect(skin.stattrak).toBe(0);
      if (!skin.equipped) {
        await player.post('/api/skins/me/equip', { data: { skinId: skin.id, team: 0 } });
      }

      const reported = await request.post('/api/test/fleet/stattrak', {
        headers,
        data: {
          increments: [
            { steamid64: steamId, defindex: WEAPON_DEFINDEX[skin.weapon], kills: 3 },
            { steamid64: steamId, defindex: WEAPON_DEFINDEX[skin.weapon], kills: 2 },
          ],
        },
      });
      expect(reported.ok(), await reported.text()).toBe(true);
      expect((await reported.json()).counted).toBe(2);
      const after = (await (await player.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
        stattrak: number | null;
      }>;
      expect(after.find((s) => s.id === skin.id)?.stattrak).toBe(5);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
      await player.dispose();
    }
  }
);
