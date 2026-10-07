import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Friends, party invites and the bell (routes/social.ts, matchmaking party
 * invites): requests and their notices, who may invite whom (the player's
 * setting and the party's game on their profile), joining by invite, and
 * searching only once everyone is set up for the game.
 *
 * @tag api
 * @tag social
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@social'] };

interface Player {
  ctx: APIRequestContext;
  id: string;
  name: string;
}

interface Notice {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  read: boolean;
}

function digits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

const contexts: APIRequestContext[] = [];

async function player(games: string[] = ['cs2']): Promise<Player> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  contexts.push(ctx);
  const id = `7656119${digits(10)}`;
  const name = `soc-${id.slice(-5)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, name, { games })).toBe(true);
  return { ctx, id, name };
}

async function notices(p: Player): Promise<{ items: Notice[]; unread: number }> {
  const res = await p.ctx.get('/api/social/notifications');
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function overview(p: Player) {
  const res = await p.ctx.get('/api/social/friends');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as {
    friends: Array<{ id: string; invite: unknown; online: boolean }>;
    incoming: Array<{ id: string }>;
    sent: Array<{ id: string }>;
  };
}

test.describe.serial('friends, invites and the bell', () => {
  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
  });

  test('signed out: no friends, no bell', TAGS, async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect((await anon.get('/api/social/friends')).status()).toBe(401);
    expect((await anon.get('/api/social/notifications')).status()).toBe(401);
    await anon.dispose();
  });

  test('a friend request: a notice, accept, friends on both sides', TAGS, async () => {
    const [a, b] = await Promise.all([player(), player()]);
    expect((await a.ctx.post('/api/social/friends/requests', { data: { playerId: a.id } })).status()).toBe(400);
    expect((await a.ctx.post('/api/social/friends/requests', { data: { playerId: '76561190000000000' } })).status()).toBe(404);

    const sent = await a.ctx.post('/api/social/friends/requests', { data: { playerId: b.id } });
    expect(sent.ok(), await sent.text()).toBe(true);
    expect((await sent.json()).relation).toBe('sent');
    expect((await overview(a)).sent.map((p) => p.id)).toEqual([b.id]);
    expect((await overview(b)).incoming.map((p) => p.id)).toEqual([a.id]);
    expect((await (await b.ctx.get(`/api/social/relation/${a.id}`)).json()).relation).toBe('incoming');

    const bell = await notices(b);
    const request = bell.items.find((n) => n.kind === 'friend_request');
    expect(request?.data.from).toMatchObject({ id: a.id, name: a.name });
    expect(bell.unread).toBeGreaterThanOrEqual(1);

    expect((await b.ctx.post(`/api/social/friends/requests/${a.id}/accept`, { data: {} })).ok()).toBe(true);
    expect((await overview(a)).friends.map((f) => f.id)).toEqual([b.id]);
    expect((await overview(b)).friends.map((f) => f.id)).toEqual([a.id]);
    expect((await notices(b)).items.find((n) => n.kind === 'friend_request')?.data.answer).toBe('accepted');
    expect((await notices(a)).items.some((n) => n.kind === 'friend_accepted' && (n.data.by as { id: string }).id === b.id)).toBe(true);

    // Removing is both sides.
    expect((await a.ctx.delete(`/api/social/friends/${b.id}`, { data: {} })).ok()).toBe(true);
    expect((await overview(b)).friends).toHaveLength(0);
  });

  test('asking someone who already asked you accepts; a cancelled request leaves their bell', TAGS, async () => {
    const [a, b, c] = await Promise.all([player(), player(), player()]);
    await a.ctx.post('/api/social/friends/requests', { data: { playerId: b.id } });
    const back = await b.ctx.post('/api/social/friends/requests', { data: { playerId: a.id } });
    expect((await back.json()).relation).toBe('friend');
    expect((await overview(a)).friends.map((f) => f.id)).toEqual([b.id]);

    await a.ctx.post('/api/social/friends/requests', { data: { playerId: c.id } });
    expect((await notices(c)).items.some((n) => n.kind === 'friend_request')).toBe(true);
    expect((await a.ctx.delete(`/api/social/friends/requests/${c.id}`, { data: {} })).ok()).toBe(true);
    expect((await notices(c)).items.some((n) => n.kind === 'friend_request')).toBe(false);
    expect((await overview(c)).incoming).toHaveLength(0);
  });

  test('find players by name or Steam link', TAGS, async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const byName = await (await a.ctx.get(`/api/social/people?q=${encodeURIComponent(b.name)}`)).json();
    expect(byName.people.map((p: { id: string }) => p.id)).toContain(b.id);
    const byLink = await (await a.ctx.get(`/api/social/people?q=${encodeURIComponent(`https://steamcommunity.com/profiles/${b.id}`)}`)).json();
    expect(byLink.people.map((p: { id: string }) => p.id)).toEqual([b.id]);
    expect(byLink.people[0]).toMatchObject({ relation: 'none', invite: true });
  });

  test('who may invite you: everyone, friends only, nobody; and only players of the game', TAGS, async () => {
    const [a, b, noGame] = await Promise.all([player(), player(), player([])]);
    expect((await b.ctx.put('/api/social/settings', { data: { partyInvitesFrom: 'sometimes' } })).status()).toBe(400);

    expect((await b.ctx.put('/api/social/settings', { data: { partyInvitesFrom: 'nobody' } })).ok()).toBe(true);
    const off = await a.ctx.post('/api/matchmaking/party/invites', { data: { playerId: b.id } });
    expect(off.status()).toBe(403);
    expect((await off.json()).code).toBe('invites_off');

    expect((await b.ctx.put('/api/social/settings', { data: { partyInvitesFrom: 'friends' } })).ok()).toBe(true);
    expect((await (await b.ctx.get('/api/social/settings')).json()).partyInvitesFrom).toBe('friends');
    const notFriends = await a.ctx.post('/api/matchmaking/party/invites', { data: { playerId: b.id } });
    expect((await notFriends.json()).code).toBe('friends_only');
    await a.ctx.post('/api/social/friends/requests', { data: { playerId: b.id } });
    await b.ctx.post(`/api/social/friends/requests/${a.id}/accept`, { data: {} });
    const ok = await a.ctx.post('/api/matchmaking/party/invites', { data: { playerId: b.id } });
    expect(ok.ok(), await ok.text()).toBe(true);

    const game = await a.ctx.post('/api/matchmaking/party/invites', { data: { playerId: noGame.id } });
    expect(game.status()).toBe(409);
    expect((await game.json()).code).toBe('no_game');
  });

  test('a party invite: in the bell, accept joins the party, the invite is answered', TAGS, async () => {
    const [leader, friend] = await Promise.all([player(), player()]);
    const invited = await leader.ctx.post('/api/matchmaking/party/invites', { data: { playerId: friend.id } });
    expect(invited.ok(), await invited.text()).toBe(true);
    const party = (await invited.json()).party as { id: string; invited: Array<{ id: string }> };
    expect(party.invited.map((p) => p.id)).toEqual([friend.id]);

    const theirs = (await (await friend.ctx.get('/api/matchmaking/me')).json()) as { invites: Array<{ partyId: string }> };
    expect(theirs.invites.map((i) => i.partyId)).toEqual([party.id]);
    expect((await notices(friend)).items.find((n) => n.kind === 'party_invite')?.data.partyId).toBe(party.id);

    const joined = await friend.ctx.post(`/api/matchmaking/invites/${party.id}/accept`, { data: {} });
    expect(joined.ok(), await joined.text()).toBe(true);
    const after = (await joined.json()) as { party: { id: string; members: string[] }; invites: unknown[] };
    expect(after.party.id).toBe(party.id);
    expect([...after.party.members].sort()).toEqual([leader.id, friend.id].sort());
    expect(after.invites).toHaveLength(0);
    expect((await notices(friend)).items.find((n) => n.kind === 'party_invite')?.data.answer).toBe('joined');
    expect((await friend.ctx.post(`/api/matchmaking/invites/${party.id}/accept`, { data: {} })).status()).toBe(404);
  });

  test('an invite whose party ends shows as expired; declining answers it', TAGS, async () => {
    const [leader, a, b] = await Promise.all([player(), player(), player()]);
    const res = await leader.ctx.post('/api/matchmaking/party/invites', { data: { playerId: a.id } });
    const partyId = ((await res.json()).party as { id: string }).id;
    await leader.ctx.post('/api/matchmaking/party/invites', { data: { playerId: b.id } });
    expect((await b.ctx.post(`/api/matchmaking/invites/${partyId}/decline`, { data: {} })).ok()).toBe(true);
    expect((await notices(b)).items.find((n) => n.kind === 'party_invite')?.data.answer).toBe('declined');
    await leader.ctx.post('/api/matchmaking/party/leave', { data: {} });
    expect((await notices(a)).items.find((n) => n.kind === 'party_invite')?.data.answer).toBe('expired');
  });

  test('nobody searches until everyone has the game on their profile', TAGS, async () => {
    const noGame = await player([]);
    const me = (await (await noGame.ctx.get('/api/matchmaking/me')).json()) as { notReady: Array<{ id: string; missing: string }> };
    expect(me.notReady).toEqual([expect.objectContaining({ id: noGame.id, missing: 'game' })]);
    const refused = await noGame.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe('profile_incomplete');
  });

  test('marking notices read', TAGS, async () => {
    const [a, b] = await Promise.all([player(), player()]);
    await a.ctx.post('/api/social/friends/requests', { data: { playerId: b.id } });
    const before = await notices(b);
    expect(before.unread).toBeGreaterThanOrEqual(1);
    const read = await b.ctx.post('/api/social/notifications/read', { data: { ids: [before.items[0].id] } });
    expect((await read.json()).unread).toBe(before.unread - 1);
    const all = await b.ctx.post('/api/social/notifications/read', { data: {} });
    expect((await all.json()).unread).toBe(0);
    expect((await notices(b)).items.every((n) => n.read)).toBe(true);
  });

  test('admins send news to every player; players cannot', TAGS, async () => {
    const p = await player();
    expect((await p.ctx.post('/api/social/news', { data: { title: 'Nope' } })).status()).toBeGreaterThanOrEqual(401);
    const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
    contexts.push(admin);
    expect(await signInViaRequest(admin)).toBe(true);
    expect((await admin.post('/api/social/news', { data: { title: '' } })).status()).toBe(400);
    const sent = await admin.post('/api/social/news', { data: { title: 'Season 2 starts Monday', url: '/play' } });
    expect(sent.ok(), await sent.text()).toBe(true);
    expect((await sent.json()).sent).toBeGreaterThanOrEqual(1);
    expect((await notices(p)).items.find((n) => n.kind === 'news')?.data).toMatchObject({ title: 'Season 2 starts Monday', url: '/play' });
  });
});
