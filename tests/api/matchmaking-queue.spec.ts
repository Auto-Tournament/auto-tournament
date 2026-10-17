import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import {
  abandonCooldownSeconds,
  everyoneGone,
  isAbandon,
  rematchOpen,
  rematchOutcome,
  teamRematchAnswer,
  cooldownSeconds,
  findGroup,
  fewSearching,
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
  return {
    entryId: `e-${id}`,
    partyId: `p-${id}`,
    players: Array.from({ length: size }, (_, i) => `${id}-${i}`),
    queuedAt,
  };
}

test.describe('matchmaking rules (pure)', () => {
  test('cooldown ladder: 2 min, 10 min, 1 h, then 24 h', TAGS, () => {
    expect([0, 1, 2, 3, 4, 9].map(cooldownSeconds)).toEqual([120, 600, 3600, 86400, 86400, 86400]);
  });

  test('a group fills exactly 10, oldest first, never splitting a party', TAGS, () => {
    const queue = [
      party('a', 1, 1),
      party('b', 5, 2),
      party('c', 1, 3),
      party('d', 4, 4),
      party('e', 1, 5),
      party('f', 1, 6),
    ];
    const group = findGroup(queue, 5)!;
    expect(group.reduce((n, p) => n + p.players.length, 0)).toBe(10);
    expect(group[0].partyId).toBe('p-a');
    expect(group.map((p) => p.partyId)).toEqual(['p-a', 'p-b', 'p-d']);
    expect(findGroup(queue.slice(0, 3), 5)).toBeNull();
  });

  test('parties that cannot be split evenly are not grouped', TAGS, () => {
    // 4 + 3 + three solos: 4 + 1 against 3 + 1 + 1.
    expect(
      findGroup(
        [party('a', 4, 1), party('b', 3, 2), party('c', 1, 3), party('d', 1, 4), party('e', 1, 5)],
        5
      )
    ).not.toBeNull();
    // 4 + 4 + 2 = 10 has no 5 / 5 split.
    expect(findGroup([party('a', 4, 1), party('b', 4, 2), party('c', 2, 3)], 5)).toBeNull();
  });

  test('teams are 5 / 5 with parties whole', TAGS, () => {
    const group = [
      party('a', 2, 1),
      party('b', 3, 2),
      party('c', 1, 3),
      party('d', 1, 4),
      party('e', 3, 5),
    ];
    for (let i = 0; i < 20; i++) {
      const [t1, t2] = splitTeams(group, 5)!;
      expect(t1.reduce((n, p) => n + p.players.length, 0)).toBe(5);
      expect(t2.reduce((n, p) => n + p.players.length, 0)).toBe(5);
      expect([...t1, ...t2].map((p) => p.partyId).sort()).toEqual(
        group.map((p) => p.partyId).sort()
      );
    }
  });

  test(
    'search window: ±100 Elo, +50 every 30 s, capped at 400, any rating after 5 min',
    TAGS,
    () => {
      const elo = (s: number) => searchWindow(s) * 200;
      expect([0, 29, 30, 90, 179, 180, 299].map(elo)).toEqual([100, 100, 150, 250, 350, 400, 400]);
      expect(searchWindow(300)).toBe(Number.POSITIVE_INFINITY);
    }
  );

  test('party rating leans to the best player, plus a small premium per extra member', TAGS, () => {
    expect(partyRating([25])).toBe(25);
    // 0.7 × 25 + 0.3 × 30 + 20 / 200
    expect(partyRating([20, 30])).toBeCloseTo(0.7 * 25 + 0.3 * 30 + 0.1, 10);
  });

  test("ratings: only parties inside each other's window are grouped", TAGS, () => {
    const rated = (id: string, mu: number, queuedAt: number, window: number): QueuedParty => ({
      ...party(id, 1, queuedAt),
      mus: [mu],
      rating: mu,
      window,
    });
    // Enough searching for two matches: the rating window holds.
    const near = Array.from({ length: 20 }, (_, i) => rated(`n${i}`, 25 + i * 0.05, i + 2, 0.5));
    const far = rated('far', 40, 1, 0.5);
    const group = findGroup([far, ...near], 5)!;
    expect(group.map((p) => p.partyId)).not.toContain('p-far');
    // After waiting long enough, anyone goes.
    expect(
      findGroup(
        [
          { ...far, window: Infinity },
          ...near.slice(0, 9).map((p) => ({ ...p, window: Infinity })),
        ],
        5
      )
    ).not.toBeNull();
  });

  test('few searching: a match now, whatever the ratings', TAGS, () => {
    const rated = (id: string, mu: number, queuedAt: number): QueuedParty => ({
      ...party(id, 1, queuedAt),
      mus: [mu],
      rating: mu,
      window: 0.5,
    });
    // Two in an empty 1v1 queue, far apart (2026-10-12: they waited 5 minutes).
    const pair = [rated('a', 38, 1), rated('b', 22, 2)];
    expect(fewSearching(pair, 1)).toBe(true);
    expect(findGroup(pair, 1)?.map((p) => p.partyId)).toEqual(['p-a', 'p-b']);
    // Four searching 1v1 is two matches' worth: ratings apply again.
    expect(fewSearching([...pair, rated('c', 38, 3), rated('d', 22, 4)], 1)).toBe(false);
  });

  test('balanced split: the smallest gap in total mu', TAGS, () => {
    const mus = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21];
    const group = mus.map((mu, i) => ({ ...party(`s${i}`, 1, i), mus: [mu], rating: mu }));
    const [t1, t2] = splitTeams(group, 5)!;
    const total = (t: QueuedParty[]) => t.reduce((n, p) => n + p.mus![0], 0);
    expect(Math.abs(total(t1) - total(t2))).toBe(1);
  });

  test(
    'XP: 100 played, +50 win / +25 draw, up to +50 performance, +100 first win of the day',
    TAGS,
    () => {
      const sum = (parts: Array<{ amount: number }>) => parts.reduce((n, p) => n + p.amount, 0);
      expect(
        sum(
          xpForMatch({
            result: 'loss',
            performanceRank: null,
            rankedPlayers: 0,
            firstWinToday: true,
          })
        )
      ).toBe(100);
      expect(
        sum(
          xpForMatch({ result: 'draw', performanceRank: 9, rankedPlayers: 10, firstWinToday: true })
        )
      ).toBe(125);
      expect(
        sum(
          xpForMatch({ result: 'win', performanceRank: 0, rankedPlayers: 10, firstWinToday: true })
        )
      ).toBe(300);
      expect(
        sum(
          xpForMatch({ result: 'win', performanceRank: 0, rankedPlayers: 10, firstWinToday: false })
        )
      ).toBe(200);
    }
  );

  test('levels: 400 + 50 × (n − 1) XP per level', TAGS, () => {
    expect(levelFor(0)).toEqual({ level: 1, intoLevel: 0, forNext: 400 });
    expect(levelFor(399).level).toBe(1);
    expect(levelFor(400)).toEqual({ level: 2, intoLevel: 0, forNext: 450 });
    expect(levelFor(1900).level).toBe(5);
    expect(levelFor(5400).level).toBe(10);
  });

  test('commends: thumbs up with an optional tag, thumbs down needs a reason', TAGS, () => {
    expect(parseCommend({ value: 1 })).toEqual({ ok: true, value: 1, tag: null });
    expect(parseCommend({ value: 1, tag: 'leader' })).toEqual({
      ok: true,
      value: 1,
      tag: 'leader',
    });
    expect(parseCommend({ value: 1, tag: 'toxic' }).ok).toBe(false);
    expect(parseCommend({ value: -1 }).ok).toBe(false);
    expect(parseCommend({ value: -1, tag: 'afk' })).toEqual({ ok: true, value: -1, tag: 'afk' });
    expect(parseCommend({ value: 2 }).ok).toBe(false);
  });

  test('abandons: 1 h, doubling within 7 days, at most 7 days', TAGS, () => {
    expect([0, 1, 2, 3].map(abandonCooldownSeconds)).toEqual([3600, 7200, 14400, 28800]);
    expect(abandonCooldownSeconds(20)).toBe(7 * 24 * 3600);
  });

  test('abandon: the whole match gone at once is the server, not the players', TAGS, () => {
    // A map change or a crash drops all ten: no penalties.
    expect(everyoneGone(10, 10, 0)).toBe(true);
    expect(everyoneGone(10, 4, 6)).toBe(true);
    // One player leaves a match the others are still in: they are penalized.
    expect(everyoneGone(10, 1, 0)).toBe(false);
    expect(everyoneGone(10, 9, 0)).toBe(false);
    expect(everyoneGone(0, 0, 0)).toBe(false);
  });

  test('rematch: open for 2 minutes after a completed match only', TAGS, () => {
    const done = { status: 'completed', completed_at: 1000 };
    expect(rematchOpen(done, 1000)).toBe(true);
    expect(rematchOpen(done, 1119)).toBe(true);
    expect(rematchOpen(done, 1120)).toBe(false);
    expect(rematchOpen({ status: 'cancelled', completed_at: 1000 }, 1010)).toBe(false);
    expect(rematchOpen({ status: 'live', completed_at: null }, 1010)).toBe(false);
    expect(rematchOpen(null, 1010)).toBe(false);
  });

  test(
    'abandon: missing 5 minutes after the server is ready, never on time the watcher did not see',
    TAGS,
    () => {
      const base = { serverReadyAt: 1000, watchingSince: 1000 };
      expect(isAbandon({ ...base, now: 1299, lastSeen: null })).toBe(false);
      expect(isAbandon({ ...base, now: 1300, lastSeen: null })).toBe(true);
      expect(isAbandon({ ...base, now: 2000, lastSeen: 1800 })).toBe(false);
      expect(isAbandon({ ...base, now: 2100, lastSeen: 1800 })).toBe(true);
      // A restart at 1900: nobody is judged before 2200.
      expect(
        isAbandon({ serverReadyAt: 1000, watchingSince: 1900, now: 2100, lastSeen: null })
      ).toBe(false);
      expect(
        isAbandon({ serverReadyAt: 1000, watchingSince: 1900, now: 2200, lastSeen: null })
      ).toBe(true);
    }
  );

  test(
    'search window settings: stored values, defaults for anything missing or out of range',
    TAGS,
    () => {
      expect(parseSearchWindow(null)).toMatchObject({
        start: 100,
        step: 50,
        cap: 400,
        uncappedAfterSeconds: 300,
      });
      expect(
        parseSearchWindow('{"start":200,"step":25,"cap":600,"uncappedAfterMinutes":10}')
      ).toMatchObject({
        start: 200,
        step: 25,
        cap: 600,
        uncappedAfterSeconds: 600,
      });
      expect(parseSearchWindow('{"uncappedAfterMinutes":null}').uncappedAfterSeconds).toBe(
        Infinity
      );
      expect(parseSearchWindow('{"start":-5,"cap":10}')).toMatchObject({ start: 100, cap: 100 });
      expect(parseSearchWindow('not json').start).toBe(100);
      expect(
        validateSearchWindow({ start: 100, step: 50, cap: 400, uncappedAfterMinutes: null })
      ).not.toBeNull();
      expect(
        validateSearchWindow({ start: 500, step: 50, cap: 400, uncappedAfterMinutes: 5 })
      ).toBeNull();
      expect(
        validateSearchWindow({ start: 100.5, step: 50, cap: 400, uncappedAfterMinutes: 5 })
      ).toBeNull();
      expect(
        validateSearchWindow({ start: 100, step: 50, cap: 400, uncappedAfterMinutes: 0 })
      ).toBeNull();
    }
  );

  test('rematch: each team decides by majority; a tie is a no', TAGS, () => {
    // Before the time is up: a yes majority, or a no once a yes majority is out of reach.
    expect(teamRematchAnswer([true, true, true, null, null], false)).toBe('yes');
    expect(teamRematchAnswer([true, true, null, null, null], false)).toBe('open');
    expect(teamRematchAnswer([true, true, false, false, false], false)).toBe('no');
    expect(teamRematchAnswer([true, false], false)).toBe('no');
    expect(teamRematchAnswer([true, null], false)).toBe('open');
    expect(teamRematchAnswer([false], false)).toBe('no');
    // The bots' side of a bot-filled game always agrees.
    expect(teamRematchAnswer([], false)).toBe('yes');
    const v = (team: number, ...votes: Array<boolean | null>) =>
      votes.map((vote) => ({ team, vote }));
    expect(
      rematchOutcome(
        [...v(1, true, true, true, null, null), ...v(2, true, true, true, false, null)],
        false
      )
    ).toBe('ready');
    expect(rematchOutcome([...v(1, true, true, true), ...v(2, null, null, null)], false)).toBe(
      'voting'
    );
    expect(rematchOutcome([...v(1, true, false), ...v(2, true, true)], false)).toBe('declined');
  });

  test('rematch: when the 30 s run out the votes cast decide; none is a no', TAGS, () => {
    expect(teamRematchAnswer([true, true, false, null, null], true)).toBe('yes');
    expect(teamRematchAnswer([true, false, null, null, null], true)).toBe('no');
    expect(teamRematchAnswer([true, null], true)).toBe('yes');
    expect(teamRematchAnswer([null, null], true)).toBe('no');
    const v = (team: number, ...votes: Array<boolean | null>) =>
      votes.map((vote) => ({ team, vote }));
    expect(rematchOutcome([...v(1, true), ...v(2, null)], true)).toBe('declined');
    expect(rematchOutcome([...v(1, true, true), ...v(2, true, null)], true)).toBe('ready');
  });

  test('servers kept free for matchmaking: only while players wait', TAGS, () => {
    expect(freeForTournament(3, 1, true)).toBe(2);
    expect(freeForTournament(1, 2, true)).toBe(0);
    expect(freeForTournament(3, 1, false)).toBe(3);
    expect(freeForTournament(3, 0, true)).toBe(3);
    expect([
      parseReservedServers('2'),
      parseReservedServers('x'),
      parseReservedServers(null),
      parseReservedServers('51'),
    ]).toEqual([2, 0, 0, 0]);
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
  party: { id: string; leader: string; inviteCode: string; members: string[]; mode: string } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  lobby: {
    id: string;
    status: string;
    accepted: number;
    total: number;
    youAccepted: boolean;
    team: number;
  } | null;
  cooldownUntil: number | null;
  rating: { elo: number; games: number; wins: number } | null;
  modes: string[];
  searchWindow?: Record<string, number | null>;
}

async function player(): Promise<{ ctx: APIRequestContext; id: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, `mm-${id.slice(-4)}`, { games: ['cs2'] })).toBe(
    true
  );
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

interface VetoView {
  status: string;
  currentTurn: 'team1' | 'team2';
  currentAction: 'ban' | 'pick' | 'side_pick';
  availableMaps: string[];
  actions: Array<{
    team: string;
    action: string;
    mapName?: string;
    timedOut?: boolean;
    votes?: number;
  }>;
  turnDeadline?: string;
}

async function vetoOf(ctx: APIRequestContext, slug: string): Promise<VetoView> {
  const res = await ctx.get(`/api/veto/${slug}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).veto as VetoView;
}

/**
 * Walk a matchmaking 5v5's veto vote: on each step every player of the side whose turn it
 * is votes for the same map (or side), which ends the turn at once. Returns the map;
 * checks it is the match config's only map and the match waits for a server.
 */
async function runVeto(
  slug: string,
  team1: APIRequestContext[],
  team2: APIRequestContext[],
  admin: APIRequestContext
): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const veto = await vetoOf(team1[0], slug);
    if (veto.status === 'completed') break;
    const side = veto.currentTurn === 'team1' ? team1 : team2;
    const other = veto.currentTurn === 'team1' ? team2 : team1;
    const data =
      veto.currentAction === 'side_pick' ? { side: 'CT' } : { mapName: veto.availableMaps[0] };
    // The other team cannot vote out of turn.
    expect((await other[0].post(`/api/veto/${slug}/action`, { data })).status()).toBe(403);
    for (const ctx of side) {
      const res = await ctx.post(`/api/veto/${slug}/action`, { data });
      expect(res.ok(), await res.text()).toBe(true);
    }
    // The whole side voted: the step is taken now, not when the 10 s run out.
    await expect
      .poll(async () => (await vetoOf(team1[0], slug)).actions.length, { timeout: 5_000 })
      .toBe(veto.actions.length + 1);
    const after = await vetoOf(team1[0], slug);
    expect(after.actions[after.actions.length - 1]).toMatchObject({ votes: side.length });
  }
  const done = (await (await team1[0].get(`/api/veto/${slug}`)).json()).veto as {
    status: string;
    pickedMaps: Array<{ mapName: string; sideTeam1?: string; sideTeam2?: string }>;
  };
  expect(done.status).toBe('completed');
  const map = done.pickedMaps[0].mapName;
  await expect
    .poll(async () => {
      const match = (await (await admin.get(`/api/matches/${slug}`)).json()).match as {
        status: string;
        config: { maplist?: string[] };
      };
      return { status: match.status, maplist: match.config?.maplist };
    })
    .toEqual({ status: 'ready', maplist: [map] });
  return map;
}

test.describe.serial('matchmaking queue (phase 1)', () => {
  let admin: APIRequestContext;
  const contexts: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInViaRequest(admin)).toBe(true);
  });

  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
    await admin.put('/api/matchmaking/admin/settings', {
      data: { openToPlayers: true, modes: ['5v5', '2v2', '1v1'] },
    });
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
    expect(status.searchWindow).toEqual({
      start: 150,
      step: 25,
      cap: 500,
      uncappedAfterMinutes: null,
    });
    // Players get it too, so the queue screen can show the window widening.
    const p = await player();
    contexts.push(p.ctx);
    expect((await me(p.ctx)).searchWindow).toEqual({
      start: 150,
      step: 25,
      everySeconds: 30,
      cap: 500,
      uncappedAfterSeconds: null,
    });
    // Back to the defaults for the rest of the suite.
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', {
          data: { searchWindow: { start: 100, step: 50, cap: 400, uncappedAfterMinutes: 5 } },
        })
      ).ok()
    ).toBe(true);
    expect((await admin.get('/api/matchmaking/admin/commends/review')).ok()).toBe(true);
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 2.5 } })
      ).status()
    ).toBe(400);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 1 } })).ok()
    ).toBe(true);
    expect((await (await admin.get('/api/matchmaking/status')).json()).reservedServers).toBe(1);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { reservedServers: 0 } })).ok()
    ).toBe(true);
  });

  test('matchmaking is open to players by default; an admin can close it', TAGS, async () => {
    const p = await player();
    contexts.push(p.ctx);
    expect((await p.ctx.get('/api/matchmaking/me')).status()).toBe(200);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: false } })).ok()
    ).toBe(true);
    expect((await p.ctx.get('/api/matchmaking/me')).status()).toBe(403);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: true } })).ok()
    ).toBe(true);
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
    expect((await friend.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(
      true
    );
    // Only the leader starts the search.
    expect(
      (await friend.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).status()
    ).toBe(403);

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
    expect(
      (await outsider.ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} })).status()
    ).toBe(404);

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

    // The match exists: a standalone Bo1 whose map the 5v5 veto picks, both teams as split.
    const room = await leader.ctx.get(`/api/matchmaking/lobbies/${lobbyId}`);
    expect(room.ok(), await room.text()).toBe(true);
    const view = (await room.json()).lobby as {
      matchSlug: string;
      map: string | null;
      veto: boolean;
      matchStatus: string;
      teams: Array<{ team: number; players: Array<{ id: string; accepted: boolean }> }>;
    };
    expect(view.matchSlug).toMatch(/^mm-/);
    expect(view).toMatchObject({ veto: true, map: null, matchStatus: 'pending' });
    const ctxOfTeam = (team: number) =>
      view.teams
        .find((t) => t.team === team)!
        .players.map((member) => players.find((p) => p.id === member.id)!.ctx);
    const vetoed = await runVeto(view.matchSlug, ctxOfTeam(1), ctxOfTeam(2), admin);
    await expect
      .poll(
        async () =>
          (
            (await (await leader.ctx.get(`/api/matchmaking/lobbies/${lobbyId}`)).json()).lobby as {
              map: string | null;
            }
          ).map
      )
      .toBe(vetoed);
    expect(view.teams.map((t) => t.players.length)).toEqual([5, 5]);
    expect(view.teams.flatMap((t) => t.players).every((p) => p.accepted)).toBe(true);
    const leaderTeam = view.teams.find((t) => t.players.some((p) => p.id === leader.id))!;
    expect(leaderTeam.players.some((p) => p.id === friend.id)).toBe(true);
    const match = await admin.get(`/api/matches/${view.matchSlug}`);
    expect(match.ok(), await match.text()).toBe(true);

    // The match ends, team 1 wins: both teams get a matchmaking rating, the
    // winners above the losers; a second result changes nothing.
    const end = {
      slug: view.matchSlug,
      result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
    };
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
    expect(
      (await outsider.ctx.get(`/api/matchmaking/matches/${view.matchSlug}/result`)).status()
    ).toBe(404);

    // Commends: up, down with a reason, never yourself or an outsider.
    const commend = (from: APIRequestContext, to: string, data: unknown) =>
      from.put(`/api/matchmaking/matches/${view.matchSlug}/commends/${to}`, { data });
    expect((await commend(ctxOf(loserId), winnerId, { value: 1, tag: 'team_player' })).ok()).toBe(
      true
    );
    expect(
      (
        await commend(leader.ctx, winnerId === leader.id ? loserId : winnerId, {
          value: -1,
          tag: 'afk',
        })
      ).ok()
    ).toBe(true);
    expect((await commend(ctxOf(loserId), winnerId, { value: -1 })).status()).toBe(400);
    expect((await commend(ctxOf(loserId), loserId, { value: 1 })).status()).toBe(400);
    expect((await commend(outsider.ctx, winnerId, { value: 1 })).status()).toBe(404);
    const progress = await (
      await admin.get(`/api/matchmaking/players/${winnerId}/progress`)
    ).json();
    expect(progress.progress.thumbsUp).toBeGreaterThanOrEqual(1);
    expect(progress.progress.topTags).toContainEqual({ tag: 'team_player', count: 1 });

    // History: the match with the rating before and after.
    const history = (await (await admin.get(`/api/matchmaking/players/${winnerId}/history`)).json())
      .matches as Array<{
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
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', { data: { leaderboardPublic: true } })
      ).ok()
    ).toBe(true);
    expect((await anon.get('/api/matchmaking/leaderboard')).status()).toBe(200);
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', { data: { leaderboardPublic: false } })
      ).ok()
    ).toBe(true);
    await anon.dispose();
    expect((await outsider.ctx.get(`/api/matchmaking/lobbies/${lobbyId}`)).status()).toBe(404);
  });

  test('5v5 veto vote: when the 10 s run out the most-voted map is banned', TAGS, async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => player()));
    contexts.push(...players.map((p) => p.ctx));
    for (const p of players) {
      const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const lobby = await lobbyOf(players[0].ctx);
    for (const p of players)
      expect(
        (await p.ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()
      ).toBe(true);
    const room = (await (await players[0].ctx.get(`/api/matchmaking/lobbies/${lobby.id}`)).json())
      .lobby as {
      matchSlug: string;
      veto: boolean;
      teams: Array<{ team: number; players: Array<{ id: string }> }>;
    };
    expect(room.veto).toBe(true);
    const opening = await vetoOf(players[0].ctx, room.matchSlug);
    expect(opening.turnDeadline).toBeTruthy();
    // One player of the side to act votes, the rest do not: their map goes when time is up.
    const voterId = room.teams.find((t) => t.team === (opening.currentTurn === 'team1' ? 1 : 2))!
      .players[0].id;
    const voter = players.find((p) => p.id === voterId)!.ctx;
    const target = opening.availableMaps[opening.availableMaps.length - 1];
    expect(
      (await voter.post(`/api/veto/${room.matchSlug}/action`, { data: { mapName: target } })).ok()
    ).toBe(true);
    expect((await vetoOf(players[0].ctx, room.matchSlug)) as unknown).toMatchObject({
      votes: { [voterId]: target },
    });
    await expect
      .poll(async () => (await vetoOf(players[0].ctx, room.matchSlug)).actions.length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    const veto = await vetoOf(players[0].ctx, room.matchSlug);
    expect(veto.actions[0]).toMatchObject({ action: 'ban', mapName: target, votes: 1 });
    // Nobody votes on the next turn: a map is drawn, marked as out of time.
    await expect
      .poll(async () => (await vetoOf(players[0].ctx, room.matchSlug)).actions.length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(1);
    expect((await vetoOf(players[0].ctx, room.matchSlug)).actions[1]).toMatchObject({
      action: 'ban',
      timedOut: true,
    });
    await admin.post('/api/test/series-result', {
      data: {
        slug: room.matchSlug,
        result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
      },
    });
  });

  test('a decline: cooldown for the decliner, everyone else back at the front', TAGS, async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => player()));
    contexts.push(...players.map((p) => p.ctx));
    for (const p of players)
      expect((await p.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(
        true
      );
    const queuedAt = (await me(players[1].ctx)).queue!.queuedAt;

    const lobby = await lobbyOf(players[0].ctx);
    expect(
      (await players[1].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()
    ).toBe(true);
    expect(
      (await players[0].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/decline`, { data: {} })).ok()
    ).toBe(true);

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
    expect(
      (
        await players[2].ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })
      ).status()
    ).toBe(409);

    // The admin queue shows the nine back in line and the decliner's cooldown.
    const queue = await (await admin.get('/api/matchmaking/admin/queue')).json();
    const searchingIds = queue.searching.flatMap((p: { players: Array<{ id: string }> }) =>
      p.players.map((x) => x.id)
    );
    expect(players.slice(1).every((p) => searchingIds.includes(p.id))).toBe(true);
    expect(queue.penalties).toContainEqual(
      expect.objectContaining({ playerId: players[0].id, kind: 'decline', cleared: false })
    );
    expect([401, 403]).toContain(
      (await players[1].ctx.get('/api/matchmaking/admin/queue')).status()
    );

    // An admin clears the cooldown.
    const cleared = await admin.delete(`/api/matchmaking/admin/players/${players[0].id}/cooldown`, {
      data: {},
    });
    expect(cleared.ok(), await cleared.text()).toBe(true);
    expect((await me(players[0].ctx)).cooldownUntil).toBeNull();

    for (const p of players) await p.ctx.delete('/api/matchmaking/queue', { data: {} });
  });
  test("live: a player's socket hears mm:changed for their own changes only", TAGS, async () => {
    const a = await player();
    const b = await player();
    contexts.push(a.ctx, b.ctx);
    const connect = async (ctx: APIRequestContext): Promise<Socket> => {
      const cookie = (await ctx.storageState()).cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      const socket = io(BASE_URL, {
        transports: ['polling'],
        extraHeaders: { cookie },
        forceNew: true,
      });
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const joined = await new Promise<{ ok: boolean }>((resolve) =>
        socket.emit('player:subscribe', resolve)
      );
      expect(joined.ok).toBe(true);
      return socket;
    };
    const sa = await connect(a.ctx);
    const sb = await connect(b.ctx);
    let bHeard = 0;
    sb.on('mm:changed', () => (bHeard += 1));
    try {
      const heard = new Promise<void>((resolve) => sa.once('mm:changed', () => resolve()));
      expect((await a.ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(
        true
      );
      await heard;
      await a.ctx.delete('/api/matchmaking/queue', { data: {} });
      await new Promise((r) => setTimeout(r, 300));
      expect(bHeard).toBe(0);
    } finally {
      sa.close();
      sb.close();
    }
  });
  test(
    '1v1: on by default, refused when an admin turns it off, then two players make a match',
    TAGS,
    async () => {
      const [a, b] = await Promise.all([player(), player()]);
      contexts.push(a.ctx, b.ctx);
      expect(
        (
          await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', 'bogus'] } })
        ).status()
      ).toBe(400);
      expect(
        (await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5'] } })).ok()
      ).toBe(true);
      try {
        const off = await a.ctx.post('/api/matchmaking/queue', { data: { mode: '1v1' } });
        expect(off.status()).toBe(409);
        expect((await off.json()).code).toBe('mode_off');
        expect(
          (
            await admin.put('/api/matchmaking/admin/settings', {
              data: { modes: ['5v5', '2v2', '1v1'] },
            })
          ).ok()
        ).toBe(true);
        expect((await me(a.ctx)).modes).toEqual(['5v5', '2v2', '1v1']);
        for (const p of [a, b]) {
          const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '1v1' } });
          expect(res.ok(), await res.text()).toBe(true);
        }
        const lobby = await lobbyOf(a.ctx);
        expect(lobby.total).toBe(2);
        for (const p of [a, b])
          expect(
            (await p.ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()
          ).toBe(true);
        const room = (await (await a.ctx.get(`/api/matchmaking/lobbies/${lobby.id}`)).json()).lobby;
        expect(room.mode).toBe('1v1');
        expect(room.teams.map((t: { players: unknown[] }) => t.players.length)).toEqual([1, 1]);
        expect(room.matchSlug).toMatch(/^mm-/);
        expect((await admin.get(`/api/matches/${room.matchSlug}`)).ok()).toBe(true);
      } finally {
        await admin.put('/api/matchmaking/admin/settings', {
          data: { modes: ['5v5', '2v2', '1v1'] },
        });
      }
    }
  );
  test(
    '2v2 wingman on a pool the admin picked; the room carries the roulette pool',
    TAGS,
    async () => {
      const players4 = await Promise.all(Array.from({ length: 4 }, () => player()));
      contexts.push(...players4.map((p) => p.ctx));
      const status = await (await admin.get('/api/matchmaking/status')).json();
      const activeDuty = (status.pools as Array<{ id: number; name: string; maps: number }>).find(
        (p) => p.name === 'Active Duty'
      );
      expect(activeDuty, JSON.stringify(status.pools)).toBeTruthy();
      expect(
        (
          await admin.put('/api/matchmaking/admin/settings', {
            data: { modePools: { '2v2': 'x' } },
          })
        ).status()
      ).toBe(400);
      expect(
        (
          await admin.put('/api/matchmaking/admin/settings', {
            data: { modes: ['5v5', '2v2'], modePools: { '2v2': activeDuty!.id } },
          })
        ).ok()
      ).toBe(true);
      try {
        for (const p of players4) {
          const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode: '2v2' } });
          expect(res.ok(), await res.text()).toBe(true);
        }
        const lobby = await lobbyOf(players4[0].ctx);
        expect(lobby.total).toBe(4);
        for (const p of players4)
          expect(
            (await p.ctx.post(`/api/matchmaking/lobbies/${lobby.id}/accept`, { data: {} })).ok()
          ).toBe(true);
        const room = (
          await (await players4[0].ctx.get(`/api/matchmaking/lobbies/${lobby.id}`)).json()
        ).lobby as {
          mode: string;
          map: string;
          veto: boolean;
          mapPool: Array<{ id: string; name: string }>;
          teams: Array<{ players: unknown[] }>;
        };
        expect(room.mode).toBe('2v2');
        // 2v2 has no veto: the roulette's map, at once.
        expect(room.veto).toBe(false);
        expect(room.teams.map((t) => t.players.length)).toEqual([2, 2]);
        expect(room.mapPool.length).toBe(activeDuty!.maps);
        expect(room.mapPool.map((m) => m.id)).toContain(room.map);
      } finally {
        await admin.put('/api/matchmaking/admin/settings', {
          data: { modes: ['5v5', '2v2', '1v1'], modePools: { '2v2': null } },
        });
      }
    }
  );

  test('anyone can read the queue counts per mode; no names or ids', TAGS, async () => {
    const [leader, friend] = await Promise.all([player(), player()]);
    contexts.push(leader.ctx, friend.ctx);
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '2v2'] } })).ok()
    ).toBe(true);
    try {
      const created = await leader.ctx.post('/api/matchmaking/party', { data: { mode: '2v2' } });
      const code = ((await created.json()) as Me).party!.inviteCode;
      expect((await friend.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(
        true
      );
      const queued = await leader.ctx.post('/api/matchmaking/queue', { data: { mode: '2v2' } });
      expect(queued.ok(), await queued.text()).toBe(true);

      const res = await anon.get('/api/matchmaking/queue');
      expect(res.status(), await res.text()).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(leader.id);
      expect(text).not.toContain(friend.id);
      const body = JSON.parse(text) as {
        modes: Array<{
          mode: string;
          playersPerMatch: number;
          searching: number;
          parties: number;
          missing: number;
          longestWaitSeconds: number | null;
          accepting: number;
          playing: number;
        }>;
      };
      expect(body.modes.map((m) => m.mode)).toEqual(['5v5', '2v2']);
      const twos = body.modes.find((m) => m.mode === '2v2')!;
      expect(twos).toMatchObject({ playersPerMatch: 4 });
      expect(twos.searching).toBeGreaterThanOrEqual(2);
      expect(twos.parties).toBeGreaterThanOrEqual(1);
      expect(twos.missing).toBe(Math.max(0, 4 - twos.searching));
      expect(twos.longestWaitSeconds).toBeGreaterThanOrEqual(0);
      expect(body.modes.find((m) => m.mode === '5v5')).toMatchObject({ playersPerMatch: 10 });

      // Closed to players: nothing to read.
      expect(
        (
          await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: false } })
        ).ok()
      ).toBe(true);
      expect((await anon.get('/api/matchmaking/queue')).status()).toBe(404);
    } finally {
      await admin.put('/api/matchmaking/admin/settings', {
        data: { openToPlayers: true, modes: ['5v5'] },
      });
      for (const p of [friend, leader])
        await p.ctx.post('/api/matchmaking/party/leave', { data: {} });
      await anon.dispose();
    }
  });

  test('the party leader picks the mode; a party moves up when it outgrows it', TAGS, async () => {
    const [leader, friend, third] = await Promise.all([player(), player(), player()]);
    contexts.push(leader.ctx, friend.ctx, third.ctx);
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', {
          data: { modes: ['5v5', '2v2', '1v1'] },
        })
      ).ok()
    ).toBe(true);
    try {
      const created = await leader.ctx.post('/api/matchmaking/party', { data: { mode: '5v5' } });
      const code = ((await created.json()) as Me).party!.inviteCode;
      const toOne = await leader.ctx.put('/api/matchmaking/party/mode', { data: { mode: '1v1' } });
      expect(toOne.ok(), await toOne.text()).toBe(true);
      expect(((await toOne.json()) as Me).party!.mode).toBe('1v1');
      expect(
        (await leader.ctx.put('/api/matchmaking/party/mode', { data: { mode: 'bogus' } })).status()
      ).toBe(400);

      // A friend joining a 1v1 party takes it to 2v2; only the leader changes the mode.
      expect((await friend.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(
        true
      );
      expect((await me(friend.ctx)).party!.mode).toBe('2v2');
      expect(
        (await friend.ctx.put('/api/matchmaking/party/mode', { data: { mode: '5v5' } })).status()
      ).toBe(403);
      const tooBig = await leader.ctx.put('/api/matchmaking/party/mode', { data: { mode: '1v1' } });
      expect(tooBig.status()).toBe(409);
      expect((await tooBig.json()).code).toBe('party_too_big');

      expect((await third.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(
        true
      );
      expect((await me(leader.ctx)).party!.mode).toBe('5v5');
    } finally {
      for (const p of [friend, third, leader])
        await p.ctx.post('/api/matchmaking/party/leave', { data: {} });
      await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5'] } });
    }
  });

  /**
   * A finished matchmaking match of `mode` between fresh solo players: each player with their
   * team, the room and the match.
   */
  async function finishedMatch(mode: '5v5' | '2v2' | '1v1') {
    const n = mode === '5v5' ? 10 : mode === '2v2' ? 4 : 2;
    const players = await Promise.all(Array.from({ length: n }, () => player()));
    contexts.push(...players.map((p) => p.ctx));
    for (const p of players) {
      const res = await p.ctx.post('/api/matchmaking/queue', { data: { mode } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const lobbies = await Promise.all(players.map((p) => lobbyOf(p.ctx)));
    const lobbyId = lobbies[0].id;
    for (const p of players)
      expect(
        (await p.ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} })).ok()
      ).toBe(true);
    const room = (await (await players[0].ctx.get(`/api/matchmaking/lobbies/${lobbyId}`)).json())
      .lobby as { matchSlug: string };
    const result = await admin.post('/api/test/series-result', {
      data: {
        slug: room.matchSlug,
        result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
      },
    });
    expect(result.ok(), await result.text()).toBe(true);
    const team = (t: number) => players.filter((_, i) => lobbies[i].team === t).map((p) => p.ctx);
    return { lobbyId, slug: room.matchSlug, team1: team(1), team2: team(2) };
  }

  const vote = async (ctx: APIRequestContext, lobbyId: string, accept: boolean) => {
    const res = await ctx.post(`/api/matchmaking/lobbies/${lobbyId}/rematch`, {
      data: { accept },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()) as { status: string; lobbyId?: string };
  };

  interface RematchMe {
    room: string;
    open: boolean;
    deadline: number | null;
    offerTeam: number | null;
    team: number;
    you: string | null;
    declined: boolean;
    lobbyId: string | null;
  }
  const rematchOf = async (ctx: APIRequestContext) =>
    ((await me(ctx)) as Me & { rematch: RematchMe | null }).rematch;

  test(
    '5v5 rematch: one yes asks the other team, majorities agree, the new match vetoes its map',
    TAGS,
    async () => {
      await admin.put('/api/matchmaking/admin/settings', {
        data: { modes: ['5v5', '2v2', '1v1'] },
      });
      const { lobbyId, team1, team2 } = await finishedMatch('5v5');
      // Nobody asked yet: nothing on the other team's screen.
      expect(await rematchOf(team2[0])).toBeNull();

      expect(await vote(team1[0], lobbyId, true)).toEqual({ status: 'voting' });
      // The other team is asked at once, with 30 s to answer.
      const asked = (await rematchOf(team2[0]))!;
      expect(asked).toMatchObject({ room: lobbyId, open: true, offerTeam: 1, team: 2, you: null });
      expect(asked.deadline! - Math.floor(Date.now() / 1000)).toBeGreaterThan(20);
      expect(await rematchOf(team1[0])).toMatchObject({ you: 'yes', offerTeam: 1, team: 1 });

      // Team 1: 3 of 5 yes is a majority. Team 2: 2 yes and a no is not yet.
      await vote(team1[1], lobbyId, true);
      expect(await vote(team1[2], lobbyId, true)).toEqual({ status: 'voting' });
      await vote(team2[0], lobbyId, true);
      await vote(team2[1], lobbyId, false);
      expect(await vote(team2[2], lobbyId, true)).toEqual({ status: 'voting' });
      // A third yes on team 2: both teams agree, the rematch starts at once.
      const ready = await vote(team2[3], lobbyId, true);
      expect(ready.status).toBe('ready');
      expect(ready.lobbyId).toBeTruthy();
      expect((await me(team2[4])).lobby).toMatchObject({ id: ready.lobbyId, status: 'ready' });

      // Same teams, and 5v5 goes through the Bo1 veto vote instead of a random map.
      const next = (await (await team1[0].get(`/api/matchmaking/lobbies/${ready.lobbyId}`)).json())
        .lobby as { veto: boolean; map: string | null; matchSlug: string; matchStatus: string };
      expect(next).toMatchObject({ veto: true, map: null, matchStatus: 'pending' });
      const veto = await vetoOf(team1[0], next.matchSlug);
      expect(veto.status).not.toBe('completed');
      expect(await me(team1[4])).toMatchObject({ lobby: { team: 1 } });
      expect(await me(team2[4])).toMatchObject({ lobby: { team: 2 } });
      await admin.post('/api/test/series-result', {
        data: {
          slug: next.matchSlug,
          result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
        },
      });
    }
  );

  test('2v2 rematch: a tie within a team is a no', TAGS, async () => {
    await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '2v2', '1v1'] } });
    const { lobbyId, team1, team2 } = await finishedMatch('2v2');
    expect(await vote(team2[0], lobbyId, true)).toEqual({ status: 'voting' });
    expect(await rematchOf(team1[0])).toMatchObject({ open: true, offerTeam: 2, you: null });
    // One yes and one no on team 2: a tie, so no rematch, whatever team 1 says.
    expect(await vote(team2[1], lobbyId, false)).toEqual({ status: 'declined' });
    expect(await rematchOf(team1[0])).toMatchObject({ open: false, declined: true });
    expect(await vote(team1[0], lobbyId, true)).toEqual({ status: 'declined' });
    expect((await me(team1[0])).lobby).toBeNull();
  });

  test('2v2 rematch: when the 30 s run out the votes cast decide', TAGS, async () => {
    test.setTimeout(120_000);
    await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '2v2', '1v1'] } });
    const { lobbyId, team1, team2 } = await finishedMatch('2v2');
    await vote(team1[0], lobbyId, true);
    await vote(team1[1], lobbyId, true);
    // Team 2: one yes, the other never answers. 1 of 2 is no majority yet ...
    expect(await vote(team2[0], lobbyId, true)).toEqual({ status: 'voting' });
    // ... but when the time is up the votes cast decide: 1 yes, 0 no.
    await expect
      .poll(async () => (await me(team2[1])).lobby?.status ?? 'none', {
        timeout: 45_000,
        intervals: [2_000],
      })
      .toBe('ready');
    const next = (await me(team2[1])).lobby as NonNullable<Me['lobby']> & { matchSlug: string };
    expect(await rematchOf(team1[0])).toMatchObject({ lobbyId: next.id });
    await admin.post('/api/test/series-result', {
      data: {
        slug: next.matchSlug,
        result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
      },
    });
  });

  test('1v1 rematch: nobody answers in time, so no rematch', TAGS, async () => {
    test.setTimeout(120_000);
    await admin.put('/api/matchmaking/admin/settings', { data: { modes: ['5v5', '2v2', '1v1'] } });
    const { lobbyId, team1, team2 } = await finishedMatch('1v1');
    await vote(team1[0], lobbyId, true);
    await expect
      .poll(async () => (await rematchOf(team2[0]))?.declined ?? null, {
        timeout: 45_000,
        intervals: [2_000],
      })
      .toBe(true);
    expect((await me(team2[0])).lobby).toBeNull();
    // Too late to answer now.
    expect(await vote(team2[0], lobbyId, true)).toEqual({ status: 'declined' });
  });
});
