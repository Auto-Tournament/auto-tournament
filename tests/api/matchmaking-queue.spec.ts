import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import {
  cooldownSeconds,
  findGroup,
  inviteCode,
  splitTeams,
  type QueuedParty,
} from '../../api/src/services/matchmaking/rules';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Matchmaking phase 1 (docs/design/matchmaking.md): the pure rules, then the
 * queue end to end with real player sessions: parties, matching, accept,
 * decline, cooldowns and requeue at the front. The server's own 2-second loop
 * forms the matches, so the API tests poll /me.
 *
 * @tag api
 * @tag matchmaking
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@matchmaking'] };

function party(id: string, size: number, queuedAt: number): QueuedParty {
  return { entryId: `e-${id}`, partyId: `p-${id}`, players: Array.from({ length: size }, (_, i) => `${id}-${i}`), queuedAt };
}

test.describe('matchmaking rules (pure)', () => {
  test('cooldown ladder: 2 min, 10 min, 1 h, then 24 h', TAGS, () => {
    expect([0, 1, 2, 3, 4, 9].map(cooldownSeconds)).toEqual([120, 600, 3600, 86400, 86400, 86400]);
  });

  test('a group fills exactly 10, oldest first, never splitting a party', TAGS, () => {
    const queue = [party('a', 1, 1), party('b', 5, 2), party('c', 1, 3), party('d', 4, 4), party('e', 1, 5), party('f', 1, 6)];
    const group = findGroup(queue, 5)!;
    expect(group.reduce((n, p) => n + p.players.length, 0)).toBe(10);
    expect(group[0].partyId).toBe('p-a');
    expect(group.map((p) => p.partyId)).toEqual(['p-a', 'p-b', 'p-d']);
    expect(findGroup(queue.slice(0, 3), 5)).toBeNull();
  });

  test('parties that cannot be split evenly are not grouped', TAGS, () => {
    // 4 + 3 + three solos: 4 + 1 against 3 + 1 + 1.
    expect(findGroup([party('a', 4, 1), party('b', 3, 2), party('c', 1, 3), party('d', 1, 4), party('e', 1, 5)], 5)).not.toBeNull();
    // 4 + 4 + 2 = 10 has no 5 / 5 split.
    expect(findGroup([party('a', 4, 1), party('b', 4, 2), party('c', 2, 3)], 5)).toBeNull();
  });

  test('teams are 5 / 5 with parties whole', TAGS, () => {
    const group = [party('a', 2, 1), party('b', 3, 2), party('c', 1, 3), party('d', 1, 4), party('e', 3, 5)];
    for (let i = 0; i < 20; i++) {
      const [t1, t2] = splitTeams(group, 5)!;
      expect(t1.reduce((n, p) => n + p.players.length, 0)).toBe(5);
      expect(t2.reduce((n, p) => n + p.players.length, 0)).toBe(5);
      expect([...t1, ...t2].map((p) => p.partyId).sort()).toEqual(group.map((p) => p.partyId).sort());
    }
  });

  test('invite codes: 10 characters, no lookalikes', TAGS, () => {
    const codes = new Set(Array.from({ length: 200 }, () => inviteCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });
});

function digits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

interface Me {
  party: { id: string; leader: string; inviteCode: string; members: string[] } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  lobby: { id: string; status: string; accepted: number; total: number; youAccepted: boolean; team: number } | null;
  cooldownUntil: number | null;
}

async function player(): Promise<{ ctx: APIRequestContext; id: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, `mm-${id.slice(-4)}`)).toBe(true);
  return { ctx, id };
}

async function me(ctx: APIRequestContext): Promise<Me> {
  const res = await ctx.get('/api/matchmaking/me');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Me;
}

async function lobbyOf(ctx: APIRequestContext): Promise<NonNullable<Me['lobby']>> {
  let lobby: Me['lobby'] = null;
  await expect
    .poll(async () => (lobby = (await me(ctx)).lobby)?.status ?? 'none', { timeout: 15_000 })
    .toBe('accepting');
  return lobby!;
}

test.describe.serial('matchmaking queue (phase 1)', () => {
  let admin: APIRequestContext;
  const contexts: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInViaRequest(admin)).toBe(true);
    expect((await admin.put('/api/experimental/matchmaking', { data: { enabled: true } })).ok()).toBe(true);
  });

  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
    await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: false } });
    await admin.put('/api/experimental/matchmaking', { data: { enabled: false } });
    await admin.dispose();
  });

  test('players are refused until matchmaking is open to them', TAGS, async () => {
    const p = await player();
    contexts.push(p.ctx);
    expect((await p.ctx.get('/api/matchmaking/me')).status()).toBe(403);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: true } })).ok()).toBe(true);
    expect((await p.ctx.get('/api/matchmaking/me')).status()).toBe(200);
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect((await anon.get('/api/matchmaking/me')).status()).toBe(401);
    await anon.dispose();
  });

  test('a party of two and eight solos are matched; everyone accepts', TAGS, async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => player()));
    contexts.push(...players.map((p) => p.ctx));
    const [leader, friend, ...solos] = players;

    const created = await leader.ctx.post('/api/matchmaking/party', { data: { mode: '5v5' } });
    expect(created.ok(), await created.text()).toBe(true);
    const code = ((await created.json()) as Me).party!.inviteCode;
    expect((await friend.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(true);
    // Only the leader starts the search.
    expect((await friend.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).status()).toBe(403);

    for (const p of [leader, ...solos]) {
      const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } });
      expect(res.ok(), await res.text()).toBe(true);
    }

    const lobbies = await Promise.all(players.map((p) => lobbyOf(p.ctx)));
    const lobbyId = lobbies[0].id;
    expect(new Set(lobbies.map((l) => l.id))).toEqual(new Set([lobbyId]));
    expect(lobbies[0].total).toBe(10);
    // The party is on one team.
    expect(lobbies[0].team).toBe(lobbies[1].team);
    expect(lobbies.filter((l) => l.team === 1)).toHaveLength(5);

    // Someone else's match: 404.
    const outsider = await player();
    contexts.push(outsider.ctx);
    expect((await outsider.ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} })).status()).toBe(404);

    const statuses: string[] = [];
    for (const p of players) {
      const res = await p.ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} });
      expect(res.ok(), await res.text()).toBe(true);
      statuses.push(((await res.json()) as { status: string }).status);
    }
    expect(statuses.slice(0, 9).every((s) => s === 'accepting')).toBe(true);
    expect(statuses[9]).toBe('ready');
    const after = await me(leader.ctx);
    expect(after.lobby).toMatchObject({ status: 'ready', accepted: 10, total: 10 });
    expect(after.queue).toBeNull();
  });

  test('a decline: cooldown for the decliner, everyone else back at the front', TAGS, async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => player()));
    contexts.push(...players.map((p) => p.ctx));
    for (const p of players) expect((await p.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(true);
    const queuedAt = (await me(players[1].ctx)).queue!.queuedAt;

    const lobby = await lobbyOf(players[0].ctx);
    expect((await players[1].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()).toBe(true);
    expect((await players[0].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/decline`, { data: {} })).ok()).toBe(true);

    const decliner = await me(players[0].ctx);
    expect(decliner.queue).toBeNull();
    expect(decliner.lobby).toBeNull();
    expect(decliner.cooldownUntil).toBeGreaterThan(Date.now() / 1000 + 100);
    const refused = await players[0].ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe('cooldown');

    // The one who accepted is searching again with the same place in line.
    const back = await me(players[1].ctx);
    expect(back.queue).toMatchObject({ status: 'searching', queuedAt });
    expect(back.lobby).toBeNull();

    // The match is gone: answering it now is refused.
    expect((await players[2].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).status()).toBe(409);

    // An admin clears the cooldown.
    const cleared = await admin.delete(`/api/matchmaking/admin/players/${players[0].id}/cooldown`, { data: {} });
    expect(cleared.ok(), await cleared.text()).toBe(true);
    expect((await me(players[0].ctx)).cooldownUntil).toBeNull();

    for (const p of players) await p.ctx.delete('/api/matchmaking/queue', { data: {} });
  });
});
