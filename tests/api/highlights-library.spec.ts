import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * The highlights library (api/src/integrations/cs2/demos/library.ts): every
 * clip and reel in one list, sorted and filtered; a view counts once per
 * viewer every 12 hours; a like is one per signed-in player.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

test('the library lists videos with their counts', TAGS, async ({ request }) => {
  for (const sort of ['new', 'views', 'likes']) {
    const res = await request.get(`/api/game/cs2/library?sort=${sort}&kind=all&limit=5`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, page: 1, limit: 5 });
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    for (const item of body.items) {
      expect(typeof item.key).toBe('string');
      expect(typeof item.views).toBe('number');
      expect(typeof item.likes).toBe('number');
    }
  }
  // Clips only, or reels only.
  const clips = (await (await request.get('/api/game/cs2/library?kind=clips')).json()).items;
  expect(clips.every((i: { kind: string }) => i.kind === 'clip')).toBe(true);
  const reels = (await (await request.get('/api/game/cs2/library?kind=reels')).json()).items;
  expect(reels.every((i: { kind: string }) => i.kind !== 'clip')).toBe(true);
  // One map's (the site search's map hits link here).
  const onMap = await request.get('/api/game/cs2/library?map=de_mirage');
  expect(onMap.ok(), await onMap.text()).toBe(true);
  expect(
    ((await onMap.json()).items as Array<{ map: string | null }>).every(
      (i) => i.map === 'de_mirage'
    )
  ).toBe(true);
});

test('a view counts once per viewer, a like once per player', TAGS, async () => {
  const video = `clip/${900000000 + Number(digits(6))}`;
  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const browser = `spec-${digits(12)}`;
  const view = (ctx = anon) => ctx.post('/api/game/cs2/watch/view', { data: { video, browser } });
  expect((await (await view()).json()).counted).toBe(true);
  expect((await (await view()).json()).counted).toBe(false);
  const stats = async (ctx = anon) =>
    (await ctx.get(`/api/game/cs2/watch/stats?video=${encodeURIComponent(video)}`)).json();
  expect(await stats()).toMatchObject({ views: 1, likes: 0, liked: false });
  // Not a video key: refused.
  expect(
    (await anon.post('/api/game/cs2/watch/view', { data: { video: '../x', browser } })).status()
  ).toBe(400);
  // Liking needs a signed-in player.
  expect(
    (await anon.put('/api/game/cs2/watch/like', { data: { video, liked: true } })).status()
  ).toBe(401);

  const fan = await playwrightRequest.newContext({ baseURL: BASE_URL });
  expect(await signInAsPlayerViaRequest(fan, `7656119${digits(10)}`, 'Library fan')).toBe(true);
  for (let i = 0; i < 2; i++) {
    const like = await fan.put('/api/game/cs2/watch/like', { data: { video, liked: true } });
    expect(await like.json()).toMatchObject({ likes: 1, liked: true });
  }
  // A signed-in view counts for the player, apart from the browser's.
  expect((await (await view(fan)).json()).counted).toBe(true);
  expect(await stats(fan)).toMatchObject({ views: 2, likes: 1, liked: true });
  const unlike = await fan.put('/api/game/cs2/watch/like', { data: { video, liked: false } });
  expect(await unlike.json()).toMatchObject({ likes: 0, liked: false });
  await anon.dispose();
  await fan.dispose();
});
