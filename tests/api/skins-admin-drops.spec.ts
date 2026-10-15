import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * An admin gives drops now: a preview names who gets one, then each player
 * gets a choice of three that waits until they open it. Several wait in line.
 *
 * @tag api
 * @tag skins
 */

test(
  'an admin drop: preview names the player, two drops wait in line',
  { tag: ['@api'] },
  async ({ request, playwright }) => {
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const steamId = `7656119807${String(Date.now()).slice(-7)}`;
    const player = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      expect(await signInAsPlayerViaRequest(player, steamId, 'Drop Receiver')).toBe(true);

      const target = { kind: 'player', id: steamId };
      const preview = await request.post('/api/skins/admin/drops', {
        headers,
        data: { target, preview: true },
      });
      expect(preview.ok(), await preview.text()).toBe(true);
      expect(await preview.json()).toMatchObject({ count: 1, names: ['Drop Receiver'] });
      // A preview gives nothing.
      const before = (await (await player.get('/api/skins/me')).json()).choices ?? [];
      expect(before).toHaveLength(0);

      for (let i = 0; i < 2; i++) {
        const given = await request.post('/api/skins/admin/drops', { headers, data: { target } });
        expect(given.ok(), await given.text()).toBe(true);
        expect((await given.json()).given).toBe(1);
      }
      const choices = (await (await player.get('/api/skins/me')).json()).choices as Array<{
        id: number;
        source: string;
        options: unknown[];
      }>;
      expect(choices).toHaveLength(2);
      expect(choices.every((c) => c.source === 'admin' && c.options.length > 0)).toBe(true);

      // The options' pictures are the platform's own picture route.
      for (const c of choices) {
        for (const o of c.options as Array<{ image: string }>)
          expect(o.image).toMatch(/^\/api\/game\/cs2\/img\/skins\/.+\.webp$/);
      }
      // No bell notice for a choice (it opens on every page until one is kept)...
      const skinNotices = async () =>
        (
          ((await (await player.get('/api/social/notifications')).json()).items ?? []) as Array<{
            kind: string;
            data: { image?: string };
          }>
        ).filter((n) => n.kind === 'skin');
      expect(await skinNotices()).toHaveLength(0);
      // ...but the kept skin gets one, with its picture.
      const kept = await player.post(`/api/skins/me/choices/${choices[0]!.id}`, {
        data: { index: 0 },
      });
      expect(kept.ok(), await kept.text()).toBe(true);
      const after = await skinNotices();
      expect(after).toHaveLength(1);
      expect(after[0]!.data.image).toMatch(/^https:\/\/.+\.webp$/);

      // Not a target: refused.
      const bad = await request.post('/api/skins/admin/drops', {
        headers,
        data: { target: { kind: 'team' } },
      });
      expect(bad.status()).toBe(400);

      // A tournament's players: a tournament that has none names nobody.
      const none = await request.post('/api/skins/admin/drops', {
        headers,
        data: { target: { kind: 'tournament', id: '999999' }, preview: true },
      });
      expect(none.ok(), await none.text()).toBe(true);
      expect((await none.json()).count).toBe(0);
      expect(
        (
          await request.post('/api/skins/admin/drops', {
            headers,
            data: { target: { kind: 'tournament' }, preview: true },
          })
        ).status()
      ).toBe(400);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
      await player.dispose();
    }
  }
);
