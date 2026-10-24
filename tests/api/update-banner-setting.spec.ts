import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The admin setting that stops the update banner (Settings → Admin
 * notifications): on by default, read with the notice settings, saved on its
 * own, and told to the banner by GET /api/system/update.
 *
 * @tag api
 */

test.describe.serial('update banner setting (api)', () => {
  test(
    'admin only, and the value must be true or false',
    { tag: ['@api'] },
    async ({ playwright, baseURL, request }) => {
      const anon = await playwright.request.newContext({ baseURL });
      expect(
        (await anon.put('/api/admin-notices/update-banner', { data: { enabled: false } })).status()
      ).toBe(401);
      const player = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(player, '76561198099990212', 'Not An Admin')).toBe(
        true
      );
      expect(
        (
          await player.put('/api/admin-notices/update-banner', { data: { enabled: false } })
        ).status()
      ).toBe(403);
      await anon.dispose();
      await player.dispose();

      expect(await signInViaRequest(request)).toBe(true);
      const headers = getAuthHeader();
      for (const data of [{}, { enabled: 'no' }, { enabled: 0 }]) {
        expect(
          (await request.put('/api/admin-notices/update-banner', { headers, data })).status()
        ).toBe(400);
      }
    }
  );

  test(
    'on by default; off and on again are kept and told to the banner',
    { tag: ['@api'] },
    async ({ request }) => {
      expect(await signInViaRequest(request)).toBe(true);
      const headers = getAuthHeader();
      const read = async () => {
        const settings = await (
          await request.get('/api/admin-notices/settings', { headers })
        ).json();
        const update = await (await request.get('/api/system/update', { headers })).json();
        expect(update.banner).toBe(settings.updateBanner);
        return settings.updateBanner;
      };
      expect(await read()).toBe(true);

      const off = await request.put('/api/admin-notices/update-banner', {
        headers,
        data: { enabled: false },
      });
      expect((await off.json()).updateBanner).toBe(false);
      expect(await read()).toBe(false);

      const on = await request.put('/api/admin-notices/update-banner', {
        headers,
        data: { enabled: true },
      });
      expect((await on.json()).updateBanner).toBe(true);
      expect(await read()).toBe(true);
    }
  );
});
