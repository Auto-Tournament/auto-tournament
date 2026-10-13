import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * The favourites on a player's profile: the owner's order, the first two big
 * and the rest small, whatever was saved as big.
 *
 * @tag ui
 * @tag skins
 */

const STEAM_ID = '76561198099990177';

test(
  'the profile favourites: two big, the rest small',
  { tag: ['@ui'] },
  async ({ page, request }) => {
    test.setTimeout(60_000);
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      expect(await signInAsPlayer(page, STEAM_ID, 'Showcase Browser')).toBe(true);

      const picks: Array<{ weapon: string; paintKit: number }> = [];
      for (const q of ['p250', 'nova', 'mp7', 'ump']) {
        const skins = ((
          await (await request.get(`/api/skins/admin/catalog?q=${q}`, { headers })).json()
        ).skins ?? []) as Array<{ weapon: string; paintKit: number }>;
        if (skins[0]) picks.push(skins[0]);
      }
      test.skip(picks.length < 3, 'The skin catalogue could not be read');
      for (const s of picks.slice(0, 3)) {
        const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
          headers,
          data: { weapon: s.weapon, paintKit: s.paintKit },
        });
        expect(given.ok()).toBe(true);
      }
      const mine = (await (await page.request.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
      }>;
      await page.request.post('/api/skins/me/seen', { data: { ids: mine.map((s) => s.id) } });
      // Saved all big: the profile still shows only the first two big.
      const saved = await page.request.put('/api/skins/me/showcase', {
        data: { items: mine.slice(0, 3).map((s) => ({ skinId: s.id, big: true })) },
      });
      expect(saved.ok()).toBe(true);

      await page.goto(`/player/${STEAM_ID}`);
      const tiles = page.getByTestId('profile-favourites').getByRole('button');
      await expect(tiles).toHaveCount(3, { timeout: 15000 });
      const spans = await tiles.evaluateAll((els) =>
        els.map((el) => window.getComputedStyle(el).gridColumnStart)
      );
      expect(spans).toEqual(['span 2', 'span 2', 'span 1']);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
    }
  }
);

test(
  'the inventory marks the side a skin is on with a dot per side',
  { tag: ['@ui'] },
  async ({ page, request }) => {
    test.setTimeout(60_000);
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const steamId = `7656119809${String(Date.now()).slice(-7)}`;
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      expect(await signInAsPlayer(page, steamId, 'Side Chip Browser')).toBe(true);
      // Two weapons both sides use (one-side weapons are always their side's).
      for (const q of ['mp7', 'nova']) {
        const skins = ((
          await (await request.get(`/api/skins/admin/catalog?q=${q}`, { headers })).json()
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
      }
      const mine = (await (await page.request.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
        weapon: string;
      }>;
      await page.request.post('/api/skins/me/seen', { data: { ids: mine.map((s) => s.id) } });
      const mp7 = mine.find((s) => s.weapon === 'weapon_mp7')!;
      const nova = mine.find((s) => s.weapon === 'weapon_nova')!;
      // Given skins go on for both sides: take the MP7 off, then put it on CT only.
      expect((await page.request.delete('/api/skins/me/equip/weapon_mp7?team=0')).ok()).toBe(true);
      expect(
        (await page.request.post('/api/skins/me/equip', { data: { skinId: mp7.id, team: 3 } })).ok()
      ).toBe(true);
      expect(
        (
          await page.request.post('/api/skins/me/equip', { data: { skinId: nova.id, team: 0 } })
        ).ok()
      ).toBe(true);

      await page.goto('/inventory');
      const chips = page.getByTestId('skin-card-sides');
      await expect(chips).toHaveCount(2, { timeout: 15000 });
      // CT only: one blue dot. Both: a CT and a T dot.
      const ctOnly = chips
        .filter({ hasText: 'CT' })
        .filter({ hasNot: page.getByTestId('skin-card-side-t') });
      await expect(ctOnly.getByTestId('skin-card-side-ct')).toHaveCount(1);
      const both = chips.filter({ has: page.getByTestId('skin-card-side-t') });
      await expect(both.getByTestId('skin-card-side-ct')).toHaveCount(1);
      await expect(both.getByTestId('skin-card-side-t')).toHaveCount(1);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
    }
  }
);
