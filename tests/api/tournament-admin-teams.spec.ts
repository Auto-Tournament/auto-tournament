import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';

/**
 * Teams in a tournament with sign-up open (Vikunja 1865): players per team
 * set by the organizer, teams that sign themselves up next to teams an admin
 * adds by hand, and an admin taking a team out (its sign-up goes with it).
 *
 * @tag api
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };
const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

async function player(name: string): Promise<{ ctx: APIRequestContext; id: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const id = `7656119${digits(10)}`;
  expect(await signInAsPlayerViaRequest(ctx, id, name)).toBe(true);
  return { ctx, id };
}

test.describe.serial('Tournament teams: sign-up and admin-added', () => {
  const contexts: APIRequestContext[] = [];
  const made: number[] = [];
  const adminTeams: string[] = [];
  let tid = 0;
  let selfTeam = '';
  let captain: { ctx: APIRequestContext; id: string };

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    for (const id of made) await request.delete('/api/tournament', { headers: as(id) });
    for (const id of adminTeams) await request.delete(`/api/teams/${id}`, { headers: getAuthHeader() });
    await Promise.all(contexts.map((c) => c.dispose()));
  });

  test('a tournament with sign-up open takes players per team, and needs no teams yet', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const created = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: {
        name: 'Duo cup',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage'],
        teamIds: [],
        teamSize: 2,
        settings: { registrationOpen: true },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const body = await created.json();
    tid = body.tournament.id;
    made.push(tid);
    expect(body.tournament.teamSize).toBe(2);

    const bad = await request.put('/api/tournament', { headers: as(tid), data: { teamSize: 11 } });
    expect(bad.status()).toBe(400);
  });

  test('a team signs itself up with players-per-team starters', TAGS, async () => {
    captain = await player('Cap');
    const mate = await player('Mate');
    contexts.push(captain.ctx, mate.ctx);
    const team = await captain.ctx.post('/api/team-directory/mine', { data: { name: `Duo ${digits(4)}`, tag: 'DUO' } });
    expect(team.ok(), await team.text()).toBe(true);
    selfTeam = (await team.json()).team.id;
    const invite = await captain.ctx.post(`/api/team-directory/${selfTeam}/invite`, { data: {} });
    const code = (await invite.json()).inviteCode as string;
    expect((await mate.ctx.post(`/api/team-directory/invite/${code}`, { data: {} })).ok()).toBe(true);
    const manage = await (await captain.ctx.get(`/api/team-directory/${selfTeam}/manage`)).json();
    const uid = manage.requests[0].uid as string;
    expect((await captain.ctx.post(`/api/team-directory/${selfTeam}/requests/${uid}/accept`, { data: {} })).ok()).toBe(true);

    const one = await captain.ctx.post(`/api/tournament-signup/${tid}/register`, {
      data: { teamId: selfTeam, starters: [captain.id], subs: [], acceptRules: true },
    });
    expect(one.status()).toBe(400);
    expect((await one.json()).code).toBe('starter_count');
    const two = await captain.ctx.post(`/api/tournament-signup/${tid}/register`, {
      data: { teamId: selfTeam, starters: [captain.id, mate.id], subs: [], acceptRules: true },
    });
    expect(two.ok(), await two.text()).toBe(true);
  });

  test('an admin adds a team by hand next to it, and takes teams out', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const id = `admin-duo-${digits(6)}`;
    const made = await request.post('/api/teams', {
      headers: getAuthHeader(),
      data: { id, name: `Admin duo ${id.slice(-4)}`, players: [{ steamId: `7656119${digits(10)}`, name: 'A' }, { steamId: `7656119${digits(10)}`, name: 'B' }] },
    });
    expect(made.ok(), await made.text()).toBe(true);
    adminTeams.push(id);

    expect((await request.post(`/api/tournaments/${tid}/teams`, { headers: getAuthHeader(), data: {} })).status()).toBe(400);
    expect((await request.post(`/api/tournaments/${tid}/teams`, { headers: getAuthHeader(), data: { teamId: 'no-such-team' } })).status()).toBe(404);
    const added = await request.post(`/api/tournaments/${tid}/teams`, { headers: getAuthHeader(), data: { teamId: id } });
    expect(added.ok(), await added.text()).toBe(true);
    expect((await added.json()).teamIds).toEqual([selfTeam, id]);
    // Adding it again changes nothing.
    expect((await (await request.post(`/api/tournaments/${tid}/teams`, { headers: getAuthHeader(), data: { teamId: id } })).json()).teamIds).toEqual([selfTeam, id]);

    const list = async () =>
      ((await (await request.get(`/api/tournament-signup/${tid}`)).json()).registrations as Array<{ teamId: string; registeredAt: number }>).map(
        (r) => [r.teamId, r.registeredAt > 0]
      );
    expect(await list()).toEqual([
      [selfTeam, true],
      [id, false],
    ]);

    // Taking the signed-up team out drops its sign-up too.
    const removed = await request.delete(`/api/tournaments/${tid}/teams/${selfTeam}`, { headers: getAuthHeader() });
    expect(removed.ok(), await removed.text()).toBe(true);
    expect(await list()).toEqual([[id, false]]);
    const mine = await (await captain.ctx.get(`/api/tournament-signup/${tid}/me`)).json();
    expect(JSON.stringify(mine)).not.toContain('"registered":true');

    // Players cannot do it.
    expect((await captain.ctx.post(`/api/tournaments/${tid}/teams`, { data: { teamId: selfTeam } })).status()).toBe(403);
  });

  test('a team list replaced with PUT also drops the sign-ups of teams it leaves out', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const again = await captain.ctx.post(`/api/tournament-signup/${tid}/register`, {
      data: { teamId: selfTeam, starters: (await (await captain.ctx.get(`/api/team-directory/${selfTeam}/manage`)).json()).members.map((m: { steamId: string }) => m.steamId), subs: [], acceptRules: true },
    });
    expect(again.ok(), await again.text()).toBe(true);
    const put = await request.put('/api/tournament', { headers: as(tid), data: { teamIds: [adminTeams[0]] } });
    expect(put.ok(), await put.text()).toBe(true);
    const regs = (await (await request.get(`/api/tournament-signup/${tid}`)).json()).registrations as Array<{ teamId: string }>;
    expect(regs.map((r) => r.teamId)).toEqual([adminTeams[0]]);
  });
});
