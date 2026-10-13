import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * A finished tournament's rewards (GET /api/skins/tournaments/:id/rewards):
 * public while skins are on, 404 while off, empty for a tournament that
 * gave none.
 *
 * @tag api
 */
test.describe.serial('Tournament rewards', () => {
  test(
    'off: 404; on: a list, empty when nothing was given',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      await signInViaRequest(request);
      const anon = await playwright.request.newContext({ baseURL });
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: false },
      });
      expect((await anon.get('/api/skins/tournaments/999999/rewards')).status()).toBe(404);
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: true },
      });
      expect((await anon.get('/api/skins/tournaments/abc/rewards')).status()).toBe(400);
      const res = await anon.get('/api/skins/tournaments/999999/rewards');
      expect(res.ok(), await res.text()).toBe(true);
      expect((await res.json()).rewards).toEqual([]);
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: false },
      });
      await anon.dispose();
    }
  );
});
