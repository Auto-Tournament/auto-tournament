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
