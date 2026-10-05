import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import {
  abandonCooldownSeconds,
  isAbandon,
  cooldownSeconds,
  findGroup,
  inviteCode,
  freeForTournament,
  parseReservedServers,
  partyRating,
  parseSearchWindow,
  searchWindow,
  validateSearchWindow,
  splitTeams,
  type QueuedParty,
} from '../../api/src/services/matchmaking/rules';
import { levelFor, parseCommend, xpForMatch } from '../../api/src/services/matchmaking/progression';
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

  test('search window: ±100 Elo, +50 every 30 s, capped at 400, any rating after 5 min', TAGS, () => {
    const elo = (s: number) => searchWindow(s) * 200;
    expect([0, 29, 30, 90, 179, 180, 299].map(elo)).toEqual([100, 100, 150, 250, 350, 400, 400]);
    expect(searchWindow(300)).toBe(Number.POSITIVE_INFINITY);
  });

  test('party rating leans to the best player, plus a small premium per extra member', TAGS, () => {
    expect(partyRating([25])).toBe(25);
    // 0.7 × 25 + 0.3 × 30 + 20 / 200
    expect(partyRating([20, 30])).toBeCloseTo(0.7 * 25 + 0.3 * 30 + 0.1, 10);
  });

  test('ratings: only parties inside each other\'s window are grouped', TAGS, () => {
    const rated = (id: string, mu: number, queuedAt: number, window: number): QueuedParty => ({
      ...party(id, 1, queuedAt),
      mus: [mu],
      rating: mu,
      window,
    });
    const near = Array.from({ length: 10 }, (_, i) => rated(`n${i}`, 25 + i * 0.05, i + 2, 0.5));
    const far = rated('far', 40, 1, 0.5);
    const group = findGroup([far, ...near], 5)!;
    expect(group.map((p) => p.partyId)).not.toContain('p-far');
    // After waiting long enough, anyone goes.
    expect(findGroup([{ ...far, window: Infinity }, ...near.slice(0, 9).map((p) => ({ ...p, window: Infinity }))], 5)).not.toBeNull();
  });

  test('balanced split: the smallest gap in total mu', TAGS, () => {
    const mus = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21];
    const group = mus.map((mu, i) => ({ ...party(`s${i}`, 1, i), mus: [mu], rating: mu }));
    const [t1, t2] = splitTeams(group, 5)!;
    const total = (t: QueuedParty[]) => t.reduce((n, p) => n + p.mus![0], 0);
    expect(Math.abs(total(t1) - total(t2))).toBe(1);
  });

  test('XP: 100 played, +50 win / +25 draw, up to +50 performance, +100 first win of the day', TAGS, () => {
    const sum = (parts: Array<{ amount: number }>) => parts.reduce((n, p) => n + p.amount, 0);
    expect(sum(xpForMatch({ result: 'loss', performanceRank: null, rankedPlayers: 0, firstWinToday: true }))).toBe(100);
    expect(sum(xpForMatch({ result: 'draw', performanceRank: 9, rankedPlayers: 10, firstWinToday: true }))).toBe(125);
    expect(sum(xpForMatch({ result: 'win', performanceRank: 0, rankedPlayers: 10, firstWinToday: true }))).toBe(300);
    expect(sum(xpForMatch({ result: 'win', performanceRank: 0, rankedPlayers: 10, firstWinToday: false }))).toBe(200);
  });

  test('levels: 400 + 50 × (n − 1) XP per level', TAGS, () => {
    expect(levelFor(0)).toEqual({ level: 1, intoLevel: 0, forNext: 400 });
    expect(levelFor(399).level).toBe(1);
    expect(levelFor(400)).toEqual({ level: 2, intoLevel: 0, forNext: 450 });
    expect(levelFor(1900).level).toBe(5);
    expect(levelFor(5400).level).toBe(10);
  });

  test('commends: thumbs up with an optional tag, thumbs down needs a reason', TAGS, () => {
    expect(parseCommend({ value: 1 })).toEqual({ ok: true, value: 1, tag: null });
    expect(parseCommend({ value: 1, tag: 'leader' })).toEqual({ ok: true, value: 1, tag: 'leader' });
    expect(parseCommend({ value: 1, tag: 'toxic' }).ok).toBe(false);
    expect(parseCommend({ value: -1 }).ok).toBe(false);
    expect(parseCommend({ value: -1, tag: 'afk' })).toEqual({ ok: true, value: -1, tag: 'afk' });
    expect(parseCommend({ value: 2 }).ok).toBe(false);
  });

  test('abandons: 1 h, doubling within 7 days, at most 7 days', TAGS, () => {
    expect([0, 1, 2, 3].map(abandonCooldownSeconds)).toEqual([3600, 7200, 14400, 28800]);
    expect(abandonCooldownSeconds(20)).toBe(7 * 24 * 3600);
  });

  test('abandon: missing 5 minutes after the server is ready, never on time the watcher did not see', TAGS, () => {
    const base = { serverReadyAt: 1000, watchingSince: 1000 };
    expect(isAbandon({ ...base, now: 1299, lastSeen: null })).toBe(false);
    expect(isAbandon({ ...base, now: 1300, lastSeen: null })).toBe(true);
    expect(isAbandon({ ...base, now: 2000, lastSeen: 1800 })).toBe(false);
    expect(isAbandon({ ...base, now: 2100, lastSeen: 1800 })).toBe(true);
    // A restart at 1900: nobody is judged before 2200.
    expect(isAbandon({ serverReadyAt: 1000, watchingSince: 1900, now: 2100, lastSeen: null })).toBe(false);
    expect(isAbandon({ serverReadyAt: 1000, watchingSince: 1900, now: 2200, lastSeen: null })).toBe(true);
  });

  test('search window settings: stored values, defaults for anything missing or out of range', TAGS, () => {
    expect(parseSearchWindow(null)).toMatchObject({ start: 100, step: 50, cap: 400, uncappedAfterSeconds: 300 });
    expect(parseSearchWindow('{"start":200,"step":25,"cap":600,"uncappedAfterMinutes":10}')).toMatchObject({
      start: 200,
      step: 25,
      cap: 600,
      uncappedAfterSeconds: 600,
    });
    expect(parseSearchWindow('{"uncappedAfterMinutes":null}').uncappedAfterSeconds).toBe(Infinity);
    expect(parseSearchWindow('{"start":-5,"cap":10}')).toMatchObject({ start: 100, cap: 100 });
    expect(parseSearchWindow('not json').start).toBe(100);
    expect(validateSearchWindow({ start: 100, step: 50, cap: 400, uncappedAfterMinutes: null })).not.toBeNull();
    expect(validateSearchWindow({ start: 500, step: 50, cap: 400, uncappedAfterMinutes: 5 })).toBeNull();
    expect(validateSearchWindow({ start: 100.5, step: 50, cap: 400, uncappedAfterMinutes: 5 })).toBeNull();
    expect(validateSearchWindow({ start: 100, step: 50, cap: 400, uncappedAfterMinutes: 0 })).toBeNull();
  });

  test('servers kept free for matchmaking: only while players wait', TAGS, () => {
    expect(freeForTournament(3, 1, true)).toBe(2);
    expect(freeForTournament(1, 2, true)).toBe(0);
    expect(freeForTournament(3, 1, false)).toBe(3);
    expect(freeForTournament(3, 0, true)).toBe(3);
    expect([parseReservedServers('2'), parseReservedServers('x'), parseReservedServers(null), parseReservedServers('51')]).toEqual([2, 0, 0, 0]);
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
  rating: { elo: number; games: number; wins: number } | null;
  modes: string[];
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

  test('admins set the search window; a bad one is refused', TAGS, async () => {
    const bad = await admin.put('/api/matchmaking/admin/settings', {
      data: { searchWindow: { start: 500, step: 50, cap: 100, uncappedAfterMinutes: 5 } },
    });
    expect(bad.status()).toBe(400);
    const set = await admin.put('/api/matchmaking/admin/settings', {
      data: { searchWindow: { start: 150, step: 25, cap: 500, uncappedAfterMinutes: null } },
    });
    expect(set.ok(), await set.text()).toBe(true);
    const status = await (await admin.get('/api/matchmaking/status')).json();
    expect(status.searchWindow).toEqual({ start: 150, step: 25, cap: 500, uncappedAfterMinutes: null });
    // Back to the defaults for the rest of the suite.
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', {
          data: { searchWindow: { start: 100, step: 50, cap: 400, uncappedAfterMinutes: 5 } },
        })
      ).ok()
    ).toBe(true);
    expect((await admin.get('/api/matchmaking/admin/commends/review')).ok()).toBe(true);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 2.5 } })).status()).toBe(400);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 1 } })).ok()).toBe(true);
    expect((await (await admin.get('/api/matchmaking/status')).json()).reservedServers).toBe(1);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 0 } })).ok()).toBe(true);
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

    // The match exists: a standalone Bo1 on a map from the pool, both teams as split.
    const room = await leader.ctx.get(`/api/matchmaking/lobbies/${lobbyId}`);
    expect(room.ok(), await room.text()).toBe(true);
    const view = (await room.json()).lobby as {
      matchSlug: string;
      map: string;
      teams: Array<{ team: number; players: Array<{ id: string; accepted: boolean }> }>;
    };
    expect(view.matchSlug).toMatch(/^mm-/);
    expect(view.map).toMatch(/^de_|^cs_/);
    expect(view.teams.map((t) => t.players.length)).toEqual([5, 5]);
    expect(view.teams.flatMap((t) => t.players).every((p) => p.accepted)).toBe(true);
    const leaderTeam = view.teams.find((t) => t.players.some((p) => p.id === leader.id))!;
    expect(leaderTeam.players.some((p) => p.id === friend.id)).toBe(true);
    const match = await admin.get(`/api/matches/${view.matchSlug}`);
    expect(match.ok(), await match.text()).toBe(true);

    // The match ends, team 1 wins: both teams get a matchmaking rating, the
    // winners above the losers; a second result changes nothing.
    const end = { slug: view.matchSlug, result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] } };
    expect((await admin.post('/api/test/series-result', { data: end })).ok()).toBe(true);
    const winnerId = view.teams.find((t) => t.team === 1)!.players[0].id;
    const loserId = view.teams.find((t) => t.team === 2)!.players[0].id;
    const ctxOf = (id: string) => players.find((p) => p.id === id)!.ctx;
    await expect.poll(async () => (await me(ctxOf(winnerId))).rating?.games ?? 0).toBe(1);
    const won = (await me(ctxOf(winnerId))).rating!;
    const lost = (await me(ctxOf(loserId))).rating!;
    expect(won.wins).toBe(1);
    expect(lost).toMatchObject({ games: 1, wins: 0 });
    expect((await admin.post('/api/test/series-result', { data: end })).ok()).toBe(true);
    expect((await me(ctxOf(winnerId))).rating!.games).toBe(1);
    expect((await me(leader.ctx)).lobby).toBeNull();

    // XP: the winner played, won and got the first win of the day; no stats,
    // so no performance part. The loser got 100.
    const result = async (ctx: APIRequestContext) => {
      const res = await ctx.get(`/api/matchmaking/matches/${view.matchSlug}/result`);
      expect(res.ok(), await res.text()).toBe(true);
      return (await res.json()).result as {
        xp: Array<{ reason: string; amount: number }>;
        progress: { level: number; totalXp: number };
        rating: { before: number; after: number } | null;
      };
    };
    const winnerResult = await result(ctxOf(winnerId));
    expect(winnerResult.xp.map((x) => x.reason).sort()).toEqual(['completed', 'first_win', 'win']);
    expect(winnerResult.progress.totalXp).toBe(250);
    expect(winnerResult.rating!.after).toBeGreaterThan(winnerResult.rating!.before);
    expect((await result(ctxOf(loserId))).progress.totalXp).toBe(100);
    expect((await outsider.ctx.get(`/api/matchmaking/matches/${view.matchSlug}/result`)).status()).toBe(404);

    // Commends: up, down with a reason, never yourself or an outsider.
    const commend = (from: APIRequestContext, to: string, data: unknown) =>
      from.put(`/api/matchmaking/matches/${view.matchSlug}/commends/${to}`, { data });
    expect((await commend(ctxOf(loserId), winnerId, { value: 1, tag: 'team_player' })).ok()).toBe(true);
    expect((await commend(leader.ctx, winnerId === leader.id ? loserId : winnerId, { value: -1, tag: 'afk' })).ok()).toBe(true);
    expect((await commend(ctxOf(loserId), winnerId, { value: -1 })).status()).toBe(400);
    expect((await commend(ctxOf(loserId), loserId, { value: 1 })).status()).toBe(400);
    expect((await commend(outsider.ctx, winnerId, { value: 1 })).status()).toBe(404);
    const progress = await (await admin.get(`/api/matchmaking/players/${winnerId}/progress`)).json();
    expect(progress.progress.thumbsUp).toBeGreaterThanOrEqual(1);
    expect(progress.progress.topTags).toContainEqual({ tag: 'team_player', count: 1 });

    // History: the match with the rating before and after.
    const history = (await (await admin.get(`/api/matchmaking/players/${winnerId}/history`)).json()).matches as Array<{
      matchSlug: string;
      eloBefore: number;
      eloAfter: number;
    }>;
    expect(history[0]).toMatchObject({ matchSlug: view.matchSlug });
    expect(history[0].eloAfter).toBeGreaterThan(history[0].eloBefore);

    // Leaderboard: needs 10 matches in 30 days, so nobody from this test yet;
    // signed in only until it is made public.
    const board = await leader.ctx.get('/api/matchmaking/leaderboard?mode=5v5');
    expect(board.ok(), await board.text()).toBe(true);
    expect((await board.json()).players.some((p: { id: string }) => p.id === winnerId)).toBe(false);
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect((await anon.get('/api/matchmaking/leaderboard')).status()).toBe(401);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { leaderboardPublic: true } })).ok()).toBe(true);
    expect((await anon.get('/api/matchmaking/leaderboard')).status()).toBe(200);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { leaderboardPublic: false } })).ok()).toBe(true);
    await anon.dispose();
    expect((await outsider.ctx.get(`/api/matchmaking/lobbies/${lobbyId}`)).status()).toBe(404);
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

    // The admin queue shows the nine back in line and the decliner's cooldown.
    const queue = await (await admin.get('/api/matchmaking/admin/queue')).json();
    const searchingIds = queue.searching.flatMap((p: { players: Array<{ id: string }> }) => p.players.map((x) => x.id));
    expect(players.slice(1).every((p) => searchingIds.includes(p.id))).toBe(true);
    expect(queue.penalties).toContainEqual(expect.objectContaining({ playerId: players[0].id, kind: 'decline', cleared: false }));
    expect([401, 403]).toContain((await players[1].ctx.get('/api/matchmaking/admin/queue')).status());

    // An admin clears the cooldown.
    const cleared = await admin.delete(`/api/matchmaking/admin/players/${players[0].id}/cooldown`, { data: {} });
    expect(cleared.ok(), await cleared.text()).toBe(true);
    expect((await me(players[0].ctx)).cooldownUntil).toBeNull();

    for (const p of players) await p.ctx.delete('/api/matchmaking/queue', { data: {} });
  });
  test('live: a player\'s socket hears mm:changed for their own changes only', TAGS, async () => {
    const a = await player();
    const b = await player();
    contexts.push(a.ctx, b.ctx);
    const connect = async (ctx: APIRequestContext): Promise<Socket> => {
      const cookie = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const socket = io(BASE_URL, { transports: ['polling'], extraHeaders: { cookie }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit('player:subscribe', resolve));
      expect(joined.ok).toBe(true);
      return socket;
    };
    const sa = await connect(a.ctx);
    const sb = await connect(b.ctx);
    let bHeard = 0;
    sb.on('mm:changed', () => (bHeard += 1));
    try {
      const heard = new Promise<void>((resolve) => sa.once('mm:changed', () => resolve()));
      expect((await a.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(true);
      await heard;
      await a.ctx.delete('/api/matchmaking/queue', { data: {} });
      await new Promise((r) => setTimeout(r, 300));
      expect(bHeard).toBe(0);
    } finally {
      sa.close();
      sb.close();
    }
  });
  test('1v1: off until an admin turns it on, then two players make a match', TAGS, async () => {
    const [a, b] = await Promise.all([player(), player()]);
    contexts.push(a.ctx, b.ctx);
    const off = await a.ctx.post('/api/matchmaking/queue', { data: { mode: '1v1' } });
    expect(off.status()).toBe(409);
    expect((await off.json()).code).toBe('mode_off');
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', 'bogus'] } })).status()).toBe(400);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '1v1'] } })).ok()).toBe(true);
    try {
      expect((await me(a.ctx)).modes).toEqual(['5v5', '1v1']);
      for (const p of [a, b]) {
        const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '1v1' } });
        expect(res.ok(), await res.text()).toBe(true);
      }
      const lobby = await lobbyOf(a.ctx);
      expect(lobby.total).toBe(2);
      for (const p of [a, b]) expect((await p.ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()).toBe(true);
      const room = (await (await a.ctx.get(`/api/matchmaking/lobbies/${lobby.id}`)).json()).lobby;
      expect(room.mode).toBe('1v1');
      expect(room.teams.map((t: { players: unknown[] }) => t.players.length)).toEqual([1, 1]);
      expect(room.matchSlug).toMatch(/^mm-/);
      expect((await admin.get(`/api/matches/${room.matchSlug}`)).ok()).toBe(true);
    } finally {
      await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5'] } });
    }
  });
  test('2v2 wingman on a pool the admin picked; the room carries the roulette pool', TAGS, async () => {
    const players4 = await Promise.all(Array.from({ length: 4 }, () => player()));
    contexts.push(...players4.map((p) => p.ctx));
    const status = await (await admin.get('/api/matchmaking/status')).json();
    const activeDuty = (status.pools as Array<{ id: number; name: string; maps: number }>).find((p) => p.name === 'Active Duty');
    expect(activeDuty, JSON.stringify(status.pools)).toBeTruthy();
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { modePools: { '2v2': 'x' } } })).status()).toBe(400);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '2v2'], modePools: { '2v2': activeDuty!.id } } })).ok()
    ).toBe(true);
    try {
      for (const p of players4) {
        const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '2v2' } });
        expect(res.ok(), await res.text()).toBe(true);
      }
      const lobby = await lobbyOf(players4[0].ctx);
      expect(lobby.total).toBe(4);
      for (const p of players4) expect((await p.ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()).toBe(true);
      const room = (await (await players4[0].ctx.get(`/api/matchmaking/lobbies/${lobby.id}`)).json()).lobby as {
        mode: string;
        map: string;
        mapPool: Array<{ id: string; name: string }>;
        teams: Array<{ players: unknown[] }>;
      };
      expect(room.mode).toBe('2v2');
      expect(room.teams.map((t) => t.players.length)).toEqual([2, 2]);
      expect(room.mapPool.length).toBe(activeDuty!.maps);
      expect(room.mapPool.map((m) => m.id)).toContain(room.map);
    } finally {
      await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5'], modePools: { '2v2': null } } });
    }
  });
});
