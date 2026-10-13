import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * The inventory's equipper: a click on a skin both sides can use asks for
 * CT, T or both, and dragging a skin onto a side's loadout slot equips it
 * there.
 *
 * @tag ui
 * @tag skins
 */

test(
  'pick a side from the card, then drag the skin onto the other side',
  { tag: ['@ui'] },
  async ({ page, request }) => {
    test.setTimeout(60_000);
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const steamId = `7656119808${String(Date.now()).slice(-7)}`;
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      expect(await signInAsPlayer(page, steamId, 'Equipper Browser')).toBe(true);
      const skins = ((
        await (await request.get('/api/skins/admin/catalog?q=mp7', { headers })).json()
      ).skins ?? []) as Array<{ weapon: string; paintKit: number }>;
      test.skip(!skins[0], 'The skin catalogue could not be read');
      expect(
        (
          await request.post(`/api/skins/admin/players/${steamId}/skins`, {
            headers,
            data: { weapon: skins[0].weapon, paintKit: skins[0].paintKit },
          })
        ).ok()
      ).toBe(true);
      const sides = async () => {
        const inv = (await (await page.request.get('/api/skins/me')).json()).inventory as Array<{
          weapon: string;
          equippedSides: number[];
        }>;
        return [...(inv.find((s) => s.weapon === 'weapon_mp7')?.equippedSides ?? [])].sort();
      };
      const mine = (await (await page.request.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
      }>;
      await page.request.post('/api/skins/me/seen', { data: { ids: mine.map((s) => s.id) } });
      // A given skin goes on for both sides; start with it off.
      expect((await page.request.delete('/api/skins/me/equip/weapon_mp7?team=0')).ok()).toBe(true);

      await page.goto('/inventory');
      const card = page.getByTestId('skin-card').first();
      await expect(card).toBeVisible({ timeout: 15000 });

      // Click: the side picker; CT only.
      await card.click();
      await expect(page.getByTestId('side-picker')).toBeVisible();
      await page.getByTestId('side-picker-ct').click();
      await expect(page.getByTestId('side-picker')).toBeHidden();
      await expect.poll(sides).toEqual([3]);

      // Drag onto the T side's MP7 slot: on both sides now, each its own pick.
      const tSlot = page
        .getByTestId('loadout-side-t')
        .getByTestId('loadout-slot')
        .filter({ hasText: /MP7/i });
      await expect(tSlot).toHaveCount(1);
      await card.dragTo(tSlot);
      await expect.poll(sides).toEqual([2, 3]);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
    }
  }
);
