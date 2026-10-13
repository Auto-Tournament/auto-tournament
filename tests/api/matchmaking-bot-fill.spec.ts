import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import {
  findBotFillGroup,
  findGroup,
  splitBotFill,
  type QueuedParty,
} from '../../api/src/services/matchmaking/rules';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Matchmaking bot fill: a small group (two friends wanting to try wingman)
 * searches with bots in the empty seats. The game is unrated: no rating, XP or
 * skin drops.
 *
 * @tag api
 * @tag matchmaking
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@matchmaking'] };

function party(id: string, size: number, queuedAt: number, botFill = true): QueuedParty {
  return {
    entryId: `e-${id}`,
    partyId: `p-${id}`,
    players: Array.from({ length: size }, (_, i) => `${id}-${i}`),
    queuedAt,
    botFill,
  };
}

const sizes = (teams: [QueuedParty[], QueuedParty[]]) =>
  teams.map((t) => t.reduce((n, p) => n + p.players.length, 0));

test.describe('bot fill rules (pure)', () => {
  test('only parties that asked for bots, oldest first, while they fit', TAGS, () => {
    expect(findBotFillGroup([party('a', 2, 1, false)], 2)).toBeNull();
    const group = findBotFillGroup(
      [party('a', 1, 1), party('b', 2, 2, false), party('c', 2, 3), party('d', 1, 4)],
      2
    )!;
    // a (1) + c (2) = 3 of 4 seats; d (1) still fits.
    expect(group.map((p) => p.partyId)).toEqual(['p-a', 'p-c', 'p-d']);
    // A full match is never replaced by bots: findGroup finds this one first.
    expect(findGroup([party('x', 2, 1), party('y', 2, 2)], 2)).not.toBeNull();
  });

  test('a party stays whole; one party plays together against bots', TAGS, () => {
    expect(sizes(splitBotFill([party('a', 2, 1)], 2)!)).toEqual([2, 0]);
    expect(sizes(splitBotFill([party('a', 1, 1), party('b', 1, 2)], 2)!)).toEqual([1, 1]);
    expect(sizes(splitBotFill([party('a', 3, 1), party('b', 1, 2), party('c', 1, 3)], 5)!)).toEqual(
      [3, 2]
    );
    expect(splitBotFill([party('a', 2, 1), party('b', 2, 2), party('c', 1, 3)], 2)).toBeNull();
  });
});

function digits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

interface Me {
  party: { inviteCode: string } | null;
  queue: { mode: string; botFill?: boolean } | null;
  lobby: { id: string; status: string; total: number } | null;
  rating: { games: number } | null;
}

async function player(): Promise<{ ctx: APIRequestContext; id: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, `bf-${id.slice(-4)}`, { games: ['cs2'] })).toBe(
    true
  );
  return { ctx, id };
}

async function me(ctx: APIRequestContext): Promise<Me> {
  const res = await ctx.get('/api/matchmaking/me');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Me;
}

test.describe.serial('matchmaking with bots', () => {
  let admin: APIRequestContext;
  const contexts: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInViaRequest(admin)).toBe(true);
    expect(
      (
        await admin.put('/api/matchmaking/admin/settings', {
          data: { openToPlayers: true, modes: ['5v5', '2v2', '1v1'] },
        })
      ).ok()
    ).toBe(true);
  });

  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.delete('/api/matchmaking/queue', { data: {} }).catch(() => undefined);
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
    await admin.dispose();
  });

  test('1v1 cannot be filled with bots', TAGS, async () => {
    const solo = await player();
    contexts.push(solo.ctx);
    const res = await solo.ctx.post('/api/matchmaking/queue', {
      data: { mode: '1v1', botFill: true },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('bot_fill_mode');
  });

  // 5v5: a fresh test stack has Active Duty maps but may lack the wingman pool.
  test('two friends play against bots, unrated', TAGS, async () => {
    const [leader, friend] = await Promise.all([player(), player()]);
    contexts.push(leader.ctx, friend.ctx);
    const created = await leader.ctx.post('/api/matchmaking/party', { data: { mode: '5v5' } });
    expect(created.ok(), await created.text()).toBe(true);
    const code = ((await created.json()) as Me).party!.inviteCode;
    expect((await friend.ctx.post('/api/matchmaking/party/join', { data: { code } })).ok()).toBe(
      true
    );

    const search = await leader.ctx.post('/api/matchmaking/queue', {
      data: { mode: '5v5', botFill: true },
    });
    expect(search.ok(), await search.text()).toBe(true);

    // No one else is needed: the loop forms the lobby for the two of them.
    let lobby: Me['lobby'] = null;
    await expect
      .poll(async () => (lobby = (await me(leader.ctx)).lobby)?.status ?? 'none', {
        timeout: 15_000,
      })
      .toBe('accepting');
    expect(lobby!.total).toBe(2);

    for (const p of [leader, friend]) {
      const res = await p.ctx.post(`/api/matchmaking/lobbies/${lobby!.id}/accept`, { data: {} });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const room = (await (await leader.ctx.get(`/api/matchmaking/lobbies/${lobby!.id}`)).json())
      .lobby as { matchSlug: string };
    expect(room.matchSlug).toMatch(/^mm-/);

    // The match carries bot_fill; the empty side is the bots.
    const match = (await (await admin.get(`/api/matches/${room.matchSlug}`)).json()).match as {
      config: {
        bot_fill?: boolean;
        team1: { name: string; players: Record<string, string> };
        team2: { name: string; players: Record<string, string> };
      };
    };
    expect(match.config.bot_fill).toBe(true);
    const rosters = [match.config.team1, match.config.team2];
    expect(rosters.map((t) => Object.keys(t.players).length).sort()).toEqual([0, 2]);
    expect(rosters.find((t) => Object.keys(t.players).length === 0)!.name).toBe('Bots');

    // The result closes the lobby but rates nobody and pays no XP.
    const end = {
      slug: room.matchSlug,
      result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
    };
    expect((await admin.post('/api/test/series-result', { data: end })).ok()).toBe(true);
    await expect.poll(async () => (await me(leader.ctx)).lobby).toBeNull();
    expect((await me(leader.ctx)).rating).toBeNull();
    const result = await leader.ctx.get(`/api/matchmaking/matches/${room.matchSlug}/result`);
    expect(result.ok(), await result.text()).toBe(true);
    const body = (await result.json()).result as {
      xp: unknown[];
      rating: unknown;
      progress: { totalXp: number };
    };
    expect(body.xp).toEqual([]);
    expect(body.rating).toBeNull();
    expect(body.progress.totalXp).toBe(0);
  });
});
