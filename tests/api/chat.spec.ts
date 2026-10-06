import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * Chat (api/src/services/chatService.ts): a match's chat for both teams and
 * the admins, a team's chat for its players only, live delivery over the
 * socket, unread counts, the rate limit, and "call an admin".
 *
 * @tag api
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };
const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

interface Player {
  ctx: APIRequestContext;
  id: string;
}

async function player(name: string): Promise<Player> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, name)).toBe(true);
  return { ctx, id };
}

async function listen(ctx: APIRequestContext): Promise<Socket> {
  const cookie = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const socket = io(BASE_URL, { transports: ['polling'], extraHeaders: { cookie }, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit('player:subscribe', resolve));
  expect(joined.ok).toBe(true);
  return socket;
}

test.describe.serial('Chat', () => {
  const contexts: APIRequestContext[] = [];
  const made: number[] = [];
  const teamIds: string[] = [];
  let a1: Player;
  let a2: Player;
  let b1: Player;
  let outsider: Player;
  let slug = '';
  let teamA = '';

  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    [a1, a2, b1, outsider] = await Promise.all([player('Ada'), player('Abe'), player('Bea'), player('Out')]);
    contexts.push(a1.ctx, a2.ctx, b1.ctx, outsider.ctx);
    const stamp = Date.now();
    teamA = `chat-a-${stamp}`;
    const teamB = `chat-b-${stamp}`;
    for (const [id, name, players] of [
      [teamA, `Chat A ${stamp}`, [a1, a2]],
      [teamB, `Chat B ${stamp}`, [b1]],
    ] as const) {
      const res = await request.post('/api/teams', {
        headers: getAuthHeader(),
        data: { id, name, players: players.map((p, i) => ({ steamId: p.id, name: `P${i}` })) },
      });
      expect(res.ok(), await res.text()).toBe(true);
      teamIds.push(id);
    }
    const created = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'Chat cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = (await created.json()).tournament.id as number;
    made.push(id);
    const started = await request.post('/api/tournament/start', { headers: as(id) });
    expect(started.ok(), await started.text()).toBe(true);
    const match = await findMatchByTeams(request, teamA, teamB);
    expect(match).toBeTruthy();
    slug = match!.slug;
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    for (const id of made) await request.delete('/api/tournament', { headers: as(id) });
    for (const id of teamIds) await request.delete(`/api/teams/${id}`, { headers: getAuthHeader() });
    await Promise.all(contexts.map((c) => c.dispose()));
  });

  test('a player sees their match and team chats; others are refused', TAGS, async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: BASE_URL });
    expect((await anon.get('/api/chat/channels')).status()).toBe(401);
    await anon.dispose();

    const list = await a1.ctx.get('/api/chat/channels');
    expect(list.ok(), await list.text()).toBe(true);
    const channels = (await list.json()).channels as Array<{ channel: string; kind: string; title: string; myTeam: string }>;
    const match = channels.find((c) => c.kind === 'match');
    expect(match).toMatchObject({ channel: `match:${slug}`, myTeam: teamA });
    expect(match!.title).toContain('Chat B');
    expect(channels.find((c) => c.kind === 'team')).toMatchObject({ channel: `team:${teamA}` });

    expect((await outsider.ctx.get(`/api/chat/${encodeURIComponent(`match:${slug}`)}/messages`)).status()).toBe(403);
    expect((await b1.ctx.get(`/api/chat/${encodeURIComponent(`team:${teamA}`)}/messages`)).status()).toBe(403);
    expect((await a1.ctx.get('/api/chat/nope/messages')).status()).toBe(400);
    expect((await a1.ctx.get(`/api/chat/${encodeURIComponent('match:no-such-match')}/messages`)).status()).toBe(404);
  });

  test('a match message reaches the other team live, and counts as unread until read', TAGS, async () => {
    const channel = `match:${slug}`;
    const path = `/api/chat/${encodeURIComponent(channel)}`;
    const socket = await listen(b1.ctx);
    try {
      const heard = new Promise<{ body: string; senderTeam: string }>((resolve) => socket.once('chat:message', resolve));
      const sent = await a1.ctx.post(`${path}/messages`, { data: { body: '  gl   hf  ' } });
      expect(sent.ok(), await sent.text()).toBe(true);
      expect((await sent.json()).message).toMatchObject({ body: 'gl hf', senderKind: 'player', senderTeam: teamA });
      expect(await heard).toMatchObject({ body: 'gl hf', senderTeam: teamA });
    } finally {
      socket.close();
    }

    const read = await b1.ctx.get(`${path}/messages`);
    const page = await read.json();
    expect(page.myTeam).not.toBe(teamA);
    expect(page.messages.map((m: { body: string }) => m.body)).toEqual(['gl hf']);

    const unread = async (p: Player) =>
      ((await (await p.ctx.get('/api/chat/channels')).json()).channels as Array<{ channel: string; unread: number }>).find(
        (c) => c.channel === channel
      )?.unread;
    expect(await unread(b1)).toBe(1);
    // The sender's own message is not unread for them.
    expect(await unread(a1)).toBe(0);
    expect((await b1.ctx.post(`${path}/read`, { data: { lastId: page.messages[0].id } })).ok()).toBe(true);
    expect(await unread(b1)).toBe(0);
  });

  test('an admin reads and writes a match chat as ADMIN, but not a team chat', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const path = `/api/chat/${encodeURIComponent(`match:${slug}`)}`;
    const read = await request.get(`${path}/messages`, { headers: getAuthHeader() });
    expect(read.ok(), await read.text()).toBe(true);
    const sent = await request.post(`${path}/messages`, { headers: getAuthHeader(), data: { body: 'Server is on its way' } });
    expect(sent.ok(), await sent.text()).toBe(true);
    expect((await sent.json()).message).toMatchObject({ senderKind: 'admin', senderTeam: null });
    expect((await request.get(`/api/chat/${encodeURIComponent(`team:${teamA}`)}/messages`, { headers: getAuthHeader() })).status()).toBe(403);
  });

  test('team chat stays in the team; empty, long and fast messages are refused', TAGS, async () => {
    const path = `/api/chat/${encodeURIComponent(`team:${teamA}`)}/messages`;
    expect((await a2.ctx.post(path, { data: { body: 'eco this round' } })).ok()).toBe(true);
    expect(((await (await a1.ctx.get(path)).json()).messages as Array<{ body: string }>).map((m) => m.body)).toContain('eco this round');
    expect((await a2.ctx.post(path, { data: { body: '   ' } })).status()).toBe(400);
    expect((await a2.ctx.post(path, { data: { body: 'x'.repeat(501) } })).status()).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await a2.ctx.post(path, { data: { body: `spam ${i}` } })).status());
    expect(statuses).toContain(429);
  });

  test('call an admin: once per player until resolved, and a line in the match chat', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const path = `/api/chat/${encodeURIComponent(`match:${slug}`)}`;
    const called = await b1.ctx.post(`${path}/call-admin`, { data: { message: 'one of ours cannot connect' } });
    expect(called.ok(), await called.text()).toBe(true);
    expect((await b1.ctx.post(`${path}/call-admin`, { data: {} })).status()).toBe(409);
    expect((await outsider.ctx.post(`${path}/call-admin`, { data: {} })).status()).toBe(403);

    const calls = await request.get('/api/admin-calls', { headers: getAuthHeader() });
    expect(calls.ok(), await calls.text()).toBe(true);
    const body = await calls.json();
    const list = (body.open ?? []) as Array<{ matchSlug: string; message: string; player: { steamId: string } }>;
    expect(list.find((c) => c.matchSlug === slug && c.player.steamId === b1.id)).toMatchObject({ message: 'one of ours cannot connect' });

    const lines = (await (await a1.ctx.get(`${path}/messages`)).json()).messages as Array<{ senderKind: string; body: string }>;
    expect(lines.at(-1)).toMatchObject({ senderKind: 'system' });
    expect(lines.at(-1)!.body).toContain('called an admin');
  });
});
