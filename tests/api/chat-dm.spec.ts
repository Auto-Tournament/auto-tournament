import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * Direct messages (chatService, `dm:<id>:<id>`): two friends write to each
 * other; the channel shows in both docks once it has a message; nobody else
 * reads it, and it ends with the friendship.
 *
 * @tag api
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

test.describe.serial('Direct messages', () => {
  let a: { ctx: APIRequestContext; id: string };
  let b: { ctx: APIRequestContext; id: string };
  let other: { ctx: APIRequestContext; id: string };
  let channel = '';

  test.beforeAll(async () => {
    [a, b, other] = await Promise.all([player('Dee'), player('Em'), player('Eve')]);
    channel = `dm:${[a.id, b.id].sort().join(':')}`;
  });

  test.afterAll(async () => {
    await Promise.all([a.ctx.dispose(), b.ctx.dispose(), other.ctx.dispose()]);
  });

  test('not friends: no DM', TAGS, async () => {
    const res = await a.ctx.post(`/api/chat/${channel}/messages`, { data: { body: 'hi' } });
    expect(res.status()).toBe(404);
  });

  test('friends write to each other; it shows in both docks', TAGS, async () => {
    expect(
      (await a.ctx.post('/api/social/friends/requests', { data: { playerId: b.id } })).ok()
    ).toBe(true);
    expect((await b.ctx.post(`/api/social/friends/requests/${a.id}/accept`)).ok()).toBe(true);

    const sent = await a.ctx.post(`/api/chat/${channel}/messages`, { data: { body: 'gg?' } });
    expect(sent.ok()).toBe(true);

    const read = await b.ctx.get(`/api/chat/${channel}/messages`);
    expect(read.ok()).toBe(true);
    const { messages } = (await read.json()) as { messages: Array<{ body: string }> };
    expect(messages.map((m) => m.body)).toContain('gg?');

    const dock = await b.ctx.get('/api/chat/channels');
    const { channels } = (await dock.json()) as {
      channels: Array<{ channel: string; kind: string; title: string; unread: number }>;
    };
    const dm = channels.find((c) => c.channel === channel);
    expect(dm).toMatchObject({ kind: 'dm', title: 'Dee', unread: 1 });
  });

  test('nobody else reads it', TAGS, async () => {
    expect((await other.ctx.get(`/api/chat/${channel}/messages`)).status()).toBe(403);
  });

  test('a channel not in order is not a DM', TAGS, async () => {
    const reversed = `dm:${[a.id, b.id].sort().reverse().join(':')}`;
    expect((await a.ctx.get(`/api/chat/${reversed}/messages`)).status()).toBe(400);
  });

  test('it ends with the friendship', TAGS, async () => {
    expect((await a.ctx.delete(`/api/social/friends/${b.id}`)).ok()).toBe(true);
    expect((await a.ctx.get(`/api/chat/${channel}/messages`)).status()).toBe(404);
  });
});
