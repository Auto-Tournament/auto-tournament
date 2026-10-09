import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

const TAGS = { tag: ['@api'] };

test('a recorder sends a file in parts', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const start = await request.post('/api/game/cs2/recorder/uploads');
  expect(start.status()).toBe(200);
  const { id } = (await start.json()) as { id: string };
  expect(id).toMatch(/^[0-9a-f]{32}$/);
  const part = (offset: number, body: string) =>
    request.put(`/api/game/cs2/recorder/uploads/${id}?offset=${offset}`, {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: Buffer.from(body),
    });
  expect(await (await part(0, 'hello ')).json()).toMatchObject({ bytes: 6 });
  // A part sent again (its answer lost) is turned down with where the upload ends.
  const again = await part(0, 'hello ');
  expect(again.status()).toBe(409);
  expect(await again.json()).toMatchObject({ bytes: 6 });
  expect(await (await part(6, 'world')).json()).toMatchObject({ bytes: 11 });
  // No such upload.
  expect(
    (
      await request.put(`/api/game/cs2/recorder/uploads/${'0'.repeat(32)}?offset=0`, {
        headers: { 'Content-Type': 'application/octet-stream' },
        data: Buffer.from('x'),
      })
    ).status()
  ).toBe(404);
});

test('parts need a recorder', TAGS, async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.post('/api/game/cs2/recorder/uploads')).status()).toBe(401);
  await anon.dispose();
});
