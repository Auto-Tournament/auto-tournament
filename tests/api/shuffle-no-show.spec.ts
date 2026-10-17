import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Shuffle no-shows (Vikunja 2167). A signed-up player who never joins their
 * round's match is marked out (shuffleTournamentService.dropShuffleNoShows):
 * the reason shows in the player list, they and the admins get a notice, and
 * "I'm back" (the join) puts them in the next draw even after sign-up closed.
 * Also: the generic create and update routes keep a shuffle's team size (the
 * MCP's tournament_create made wingman shuffles of 5).
 */

const TAGS = { tag: ['@api', '@shuffle'] };
const BASE_URL = process.env.BASE_URL || 'http://localhost:3069';
const MAPS = ['de_mirage', 'de_inferno', 'de_ancient'];

const steamIdFor = (n: number) => `7656119${String(Date.now() + n).slice(-10)}`;

interface ListedPlayer {
  steamId: string;
  left?: boolean;
  leftReason?: string;
}

async function listed(request: APIRequestContext, id: number): Promise<ListedPlayer[]> {
  const res = await request.get(`/api/tournament-signup/${id}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).players as ListedPlayer[];
}

test(
  'a no-show is marked out with a notice and comes back with the join',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const created = await request.post('/api/tournament/shuffle', {
      headers: getAuthHeader(),
      data: {
        name: `No-shows ${Date.now()}`,
        mapSequence: MAPS,
        maxRounds: 3,
        overtimeMode: 'enabled',
        teamSize: 2,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = (await created.json()).tournament.id as number;
    const scope = { ...getAuthHeader(), 'X-Tournament-Id': String(id) };

    const open = await request.put('/api/tournament', {
      headers: scope,
      data: { settings: { registrationOpen: true } },
    });
    expect(open.ok(), await open.text()).toBe(true);

    const players: Array<{ ctx: APIRequestContext; steamId: string }> = [];
    for (let i = 0; i < 4; i++) {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      const steamId = steamIdFor(i);
      expect(await signInAsPlayerViaRequest(ctx, steamId, `NoShow ${i}`)).toBe(true);
      const joined = await ctx.post(`/api/tournament-signup/${id}/join`, { data: {} });
      expect(joined.status(), await joined.text()).toBe(200);
      players.push({ ctx, steamId });
    }

    // CS2 starts only with a webhook URL set.
    const webhook = await request.put('/api/settings', {
      headers: getAuthHeader(),
      data: { webhookUrl: BASE_URL },
    });
    expect(webhook.ok(), await webhook.text()).toBe(true);
    const started = await request.post('/api/tournament/start', { headers: scope });
    expect(started.ok(), await started.text()).toBe(true);
    // Sign-up closes once it runs: a no-show still gets back in.
    const closed = await request.put('/api/tournament', {
      headers: scope,
      data: { settings: { registrationOpen: false } },
    });
    expect(closed.ok(), await closed.text()).toBe(true);

    // Round one is drawn in the background after the start.
    type RoundMatch = { slug: string; teams: Array<{ steamIds: string[] }> };
    const firstMatch = async (): Promise<RoundMatch | undefined> => {
      const round = await (await request.get(`/api/tournament/${id}/shuffle-round`)).json();
      return (round.matches as RoundMatch[] | undefined)?.[0];
    };
    await expect.poll(async () => !!(await firstMatch()), { timeout: 20_000 }).toBe(true);
    const match = (await firstMatch())!;
    const roster = match.teams.flatMap((t) => t.steamIds);
    expect(roster).toHaveLength(4);

    // Only the first one was ever on the server.
    const [present, ...absent] = roster;
    const check = await request.post('/api/test/shuffle-no-shows', {
      headers: getAuthHeader(),
      data: { slug: match.slug, seen: [present] },
    });
    expect(check.ok(), await check.text()).toBe(true);
    expect(((await check.json()).dropped as string[]).sort()).toEqual([...absent].sort());

    const after = await listed(request, id);
    for (const steamId of absent) {
      expect(after.find((p) => p.steamId === steamId)).toMatchObject({
        left: true,
        leftReason: 'no_show',
      });
    }
    expect(after.find((p) => p.steamId === present)?.left).toBe(false);

    // The admins' bell names who was marked out.
    const notices = await (
      await request.get('/api/admin-notices', { headers: getAuthHeader() })
    ).json();
    expect(
      (notices.notices as Array<{ kind: string; data: { matchSlug?: string } }>).some(
        (n) => n.kind === 'shuffle_no_show' && n.data.matchSlug === match.slug
      )
    ).toBe(true);

    // The no-show's bell says so, and "I'm back" puts them in the next draw.
    const back = players.find((p) => p.steamId === absent[0])!;
    const bell = await (await back.ctx.get('/api/social/notifications')).json();
    expect(
      (bell.items as Array<{ kind: string; data: { event?: string; tournamentId?: number } }>).some(
        (n) => n.kind === 'tournament' && n.data.event === 'no_show' && n.data.tournamentId === id
      )
    ).toBe(true);
    const rejoined = await back.ctx.post(`/api/tournament-signup/${id}/join`, { data: {} });
    expect(rejoined.status(), await rejoined.text()).toBe(200);
    const again = (await listed(request, id)).find((p) => p.steamId === back.steamId);
    expect(again?.left).toBe(false);
    expect(again?.leftReason).toBeUndefined();

    // A player who left on their own is not let back in once sign-up closed.
    const leaver = players.find((p) => p.steamId === present)!;
    expect((await leaver.ctx.delete(`/api/tournament-signup/${id}/join`)).status()).toBe(200);
    expect((await listed(request, id)).find((p) => p.steamId === present)?.leftReason).toBe('left');
    expect(
      (await leaver.ctx.post(`/api/tournament-signup/${id}/join`, { data: {} })).status()
    ).toBe(409);

    for (const p of players) await p.ctx.dispose();
  }
);

test('the generic routes keep a shuffle team size', TAGS, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const created = await request.post('/api/tournament', {
    headers: getAuthHeader(),
    data: {
      name: `Wingman shuffle ${Date.now()}`,
      type: 'shuffle',
      format: 'bo1',
      maps: MAPS,
      teamIds: [],
      teamSize: 2,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = (await created.json()).tournament.id as number;
  const scope = { ...getAuthHeader(), 'X-Tournament-Id': String(id) };
  const read = async () =>
    (await (await request.get('/api/tournament', { headers: scope })).json()).tournament as {
      teamSize?: number;
    };
  expect((await read()).teamSize).toBe(2);

  const updated = await request.put('/api/tournament', { headers: scope, data: { teamSize: 3 } });
  expect(updated.ok(), await updated.text()).toBe(true);
  expect((await read()).teamSize).toBe(3);

  // A shuffle draws teams of two or more.
  const one = await request.put('/api/tournament', { headers: scope, data: { teamSize: 1 } });
  expect(one.status()).toBe(400);
});
