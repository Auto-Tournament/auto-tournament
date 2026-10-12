import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Comments on a video (api/src/integrations/cs2/demos/comments.ts): signed-in
 * players comment, edit and delete their own; an admin deletes any; posting
 * is rate limited; the text is kept as plain text.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

async function player(name: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, name)).toBe(true);
  return { ctx, id };
}

test('players comment, edit and delete their own; admins delete any', TAGS, async ({ request }) => {
  const video = `clip/${800000000 + Number(digits(6))}`;
  const list = async () =>
    (
      await (
        await request.get(`/api/game/cs2/watch/comments?video=${encodeURIComponent(video)}`)
      ).json()
    ).comments as Array<{ id: number; body: string; playerId: string; editedAt: number | null }>;

  // Nobody signed in: no comment.
  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  expect(
    (await anon.post('/api/game/cs2/watch/comments', { data: { video, body: 'hi' } })).status()
  ).toBe(401);

  const a = await player('Commenter A');
  const b = await player('Commenter B');
  const posted = await a.ctx.post('/api/game/cs2/watch/comments', {
    data: { video, body: '  look at 0:23 <b>wow</b>  ' },
  });
  expect(posted.status(), await posted.text()).toBe(200);
  const comment = (await posted.json()).comment;
  // Trimmed, and kept as the text it is (the page shows it as text).
  expect(comment).toMatchObject({
    playerId: a.id,
    body: 'look at 0:23 <b>wow</b>',
    editedAt: null,
  });
  // Again straight away: too soon.
  expect(
    (await a.ctx.post('/api/game/cs2/watch/comments', { data: { video, body: 'again' } })).status()
  ).toBe(429);
  // Empty or too long: refused.
  expect(
    (await b.ctx.post('/api/game/cs2/watch/comments', { data: { video, body: '   ' } })).status()
  ).toBe(400);
  expect(
    (
      await b.ctx.post('/api/game/cs2/watch/comments', { data: { video, body: 'x'.repeat(1001) } })
    ).status()
  ).toBe(400);
  const other = (
    await (
      await b.ctx.post('/api/game/cs2/watch/comments', { data: { video, body: 'nice' } })
    ).json()
  ).comment;
  expect((await list()).map((c) => c.id)).toEqual([comment.id, other.id]);

  // Only the author edits.
  expect(
    (
      await b.ctx.put(`/api/game/cs2/watch/comments/${comment.id}`, { data: { body: 'x' } })
    ).status()
  ).toBe(403);
  const edited = await a.ctx.put(`/api/game/cs2/watch/comments/${comment.id}`, {
    data: { body: 'look at 0:24' },
  });
  expect((await edited.json()).comment).toMatchObject({ body: 'look at 0:24' });
  expect((await list())[0].editedAt).not.toBeNull();

  // Another player cannot delete it; its author can; an admin can delete any.
  expect((await b.ctx.delete(`/api/game/cs2/watch/comments/${comment.id}`)).status()).toBe(403);
  expect((await a.ctx.delete(`/api/game/cs2/watch/comments/${comment.id}`)).status()).toBe(200);
  await signInViaRequest(request);
  expect((await request.delete(`/api/game/cs2/watch/comments/${other.id}`)).status()).toBe(200);
  expect(await list()).toEqual([]);

  await Promise.all([anon.dispose(), a.ctx.dispose(), b.ctx.dispose()]);
});
