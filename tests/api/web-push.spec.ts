import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * Browser and phone notifications (api/src/services/webPush.ts): the site's public key, a
 * browser's subscription saved and removed, and push as a notification channel.
 */

const TAGS = { tag: ['@api'] };
const BASE_URL = process.env.BASE_URL || 'http://localhost:3069';

test('a player turns push on in a browser and off again', TAGS, async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const steamId = `7656119${String(Date.now()).slice(-10)}`;
  expect(await signInAsPlayerViaRequest(ctx, steamId, 'Push Test Player')).toBe(true);

  // The key is made on first use and stays the same.
  const key1 = (await (await ctx.get('/api/social/push/key')).json()).publicKey as string;
  const key2 = (await (await ctx.get('/api/social/push/key')).json()).publicKey as string;
  expect(key1).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  expect(key2).toBe(key1);

  // Before: push is not available for the player.
  let prefs = await (await ctx.get('/api/social/notifications/channels')).json();
  expect(prefs.channels.push).toMatchObject({ available: false, reason: 'no_push' });

  // A malformed subscription is refused.
  const bad = await ctx.post('/api/social/push/subscription', { data: { endpoint: 'nope' } });
  expect(bad.status()).toBe(400);

  const endpoint = `https://push.example.com/send/${Date.now()}`;
  const ok = await ctx.post('/api/social/push/subscription', {
    data: { endpoint, keys: { p256dh: 'BP' + 'a'.repeat(85), auth: 'b'.repeat(22) } },
  });
  expect(ok.status()).toBe(200);
  prefs = await (await ctx.get('/api/social/notifications/channels')).json();
  expect(prefs.channels.push).toMatchObject({ available: true });
  expect(prefs.events.match_ready.push).toBe(true);

  const off = await ctx.delete('/api/social/push/subscription', { data: { endpoint } });
  expect(off.status()).toBe(200);
  prefs = await (await ctx.get('/api/social/notifications/channels')).json();
  expect(prefs.channels.push).toMatchObject({ available: false });
  await ctx.dispose();
});
