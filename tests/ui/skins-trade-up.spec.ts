import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * The Inventory page's trade-up: pick five skins of one grade, see what the
 * next grade can give, trade up, and the new skin opens.
 *
 * @tag ui
 * @tag skins
 */

const STEAM_ID = '76561198099990099';

test(
  'a player trades five commons up from the inventory',
  { tag: ['@ui'] },
  async ({ page, request }) => {
    test.setTimeout(60_000);
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    try {
      await request.put('/api/skins/admin/config', {
        headers,
        data: { enabled: true, tradeUp: { enabled: true, count: 5 } },
      });
      expect(await signInAsPlayer(page, STEAM_ID, 'Trade Up Browser')).toBe(true);

      const commons: Array<{ weapon: string; paintKit: number }> = [];
      for (const q of ['p250', 'nova', 'mp7', 'sawed', 'mag', 'xm1014', 'ump', 'tec']) {
        const skins = ((
          await (await request.get(`/api/skins/admin/catalog?q=${q}`, { headers })).json()
        ).skins ?? []) as Array<{ weapon: string; paintKit: number; rarity: string }>;
        commons.push(...skins.filter((s) => s.rarity === 'common'));
        if (commons.length >= 5) break;
      }
      test.skip(commons.length < 5, 'The skin catalogue could not be read');
      for (const s of commons.slice(0, 5)) {
        const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
          headers,
          data: { weapon: s.weapon, paintKit: s.paintKit },
        });
        expect(given.ok()).toBe(true);
      }

      // Seen already: the "new skin" reveal would cover the page.
      const mine = (await (await page.request.get('/api/skins/me')).json()).inventory as Array<{
        id: number;
      }>;
      await page.request.post('/api/skins/me/seen', { data: { ids: mine.map((s) => s.id) } });
      await page.goto('/inventory');
      await page.getByTestId('trade-up-start').click();
      await expect(page.getByTestId('trade-up-count')).toHaveText('0 of 5 picked');
      const cards = page.getByRole('button', { name: /^Pick / });
      for (let i = 0; i < 5; i++) await cards.first().click();
      await expect(page.getByTestId('trade-up-count')).toHaveText('5 of 5 picked');
      await expect(page.getByTestId('trade-up-outcomes')).toBeVisible();
      await page.getByTestId('trade-up-confirm').click();
      // The new skin opens; the panel is gone.
      await expect(page.getByTestId('trade-up-panel')).toHaveCount(0);
      // The reveal and the skin's detail both open; whichever renders first is not the point.
      const reveal = page.getByRole('dialog').filter({ hasText: 'New skin acquired' });
      await expect(reveal).toBeVisible({ timeout: 15000 });
      await expect(reveal).toContainText('5 × Common');
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
    }
  }
);
