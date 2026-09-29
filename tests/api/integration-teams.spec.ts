import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { ADMIN_TOKEN, INTEGRATOR, OTHER_INTEGRATOR, READONLY_TOKEN, bearer } from '../helpers/webhooks';

/**
 * The teams API for integrators (/api/integrations/teams): an event website
 * pushes its teams by its own ids.
 *
 * - upsert by externalId is idempotent: the same input twice is `unchanged`;
 *   a new player list replaces the old one; the response has Auto
 *   Tournament's id;
 * - batch: each team on its own, 207 when some failed;
 * - Steam64 ids are validated; a source is the token's label, so two
 *   integrators never meet; integrator tokens reach nothing else;
 * - a roster change for a team that is playing is refused (409).
 *
 * @tag api
 * @tag integrations
 */

const run = Date.now().toString(36);
const ext = (n: number) => `ci-${run}-${n}`;
const steam = (n: number) => `765611980002${String(n).padStart(5, '0')}`;
const players = (...ns: number[]) => ns.map((n) => ({ steamId: steam(n), name: `p${n}` }));

async function put(request: APIRequestContext, externalId: string, data: unknown, token = INTEGRATOR.token) {
  const res = await request.put(`/api/integrations/teams/${externalId}`, { headers: bearer(token), data });
  return { status: res.status(), body: await res.json() };
}

test.describe.serial('Teams API for integrators', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('upsert is idempotent, the roster is replaced, GET by externalId', async ({ request }) => {
    const created = await put(request, ext(1), { name: 'CI Ninjas', tag: 'NIN', players: players(1, 2, 3) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ success: true, source: INTEGRATOR.label, externalId: ext(1), result: 'created' });
    const id = created.body.id as string;
    expect(id).toMatch(/^ci-ninjas/);

    const same = await put(request, ext(1), { name: 'CI Ninjas', tag: 'NIN', players: players(3, 2, 1) });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ result: 'unchanged', id });
    expect(same.body.team.updatedAt).toBe(created.body.team.updatedAt);

    const replaced = await put(request, ext(1), { name: 'CI Ninjas', tag: 'NIN', players: players(4, 5) });
    expect(replaced.body).toMatchObject({ result: 'updated', id });
    expect(replaced.body.team.players.map((p: { steamId: string }) => p.steamId)).toEqual([steam(4), steam(5)]);

    // The admin view of the team agrees.
    const team = await (await request.get(`/api/teams/${id}`)).json();
    expect(team.team.players.map((p: { steamId: string }) => p.steamId)).toEqual([steam(4), steam(5)]);

    const got = await request.get(`/api/integrations/teams/${ext(1)}`, { headers: bearer(INTEGRATOR.token) });
    expect(await got.json()).toMatchObject({ team: { id, externalId: ext(1), name: 'CI Ninjas', tag: 'NIN' } });
    const list = await (await request.get('/api/integrations/teams', { headers: bearer(INTEGRATOR.token) })).json();
    expect(list.teams.map((t: { externalId: string }) => t.externalId)).toContain(ext(1));

    const missing = await request.get(`/api/integrations/teams/${ext(999)}`, { headers: bearer(INTEGRATOR.token) });
    expect(missing.status()).toBe(404);
  });

  test('validation: Steam64 ids, names, a body id that disagrees with the path', async ({ request }) => {
    const bad = await put(request, ext(2), { name: 'Bad', players: [{ steamId: '12345', name: 'x' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid');
    expect(bad.body.error).toContain('Steam64');
    expect((await put(request, ext(2), { name: '', players: players(1) })).status).toBe(400);
    expect((await put(request, ext(2), { name: 'X', players: [] })).status).toBe(400);
    expect((await put(request, ext(2), { externalId: 'other', name: 'X', players: players(1) })).status).toBe(400);
    expect((await put(request, ext(2), { name: 'X', players: players(1, 1) })).status).toBe(400);
  });

  test('batch: each on its own, 207 with per-team results', async ({ request }) => {
    const res = await request.post('/api/integrations/teams/batch', {
      headers: bearer(INTEGRATOR.token),
      data: {
        teams: [
          { externalId: ext(10), name: 'CI Batch A', players: players(10, 11) },
          { externalId: ext(11), name: 'CI Batch B', players: [{ steamId: 'nope', name: 'x' }] },
          { externalId: ext(10), name: 'CI Batch A again', players: players(10) },
          { externalId: ext(1), name: 'CI Ninjas', tag: 'NIN', players: players(4, 5) },
        ],
      },
    });
    expect(res.status()).toBe(207);
    const body = await res.json();
    expect(body.stats).toEqual({ total: 4, created: 1, updated: 0, unchanged: 1, failed: 2 });
    expect(body.results[0]).toMatchObject({ ok: true, result: 'created', externalId: ext(10) });
    expect(body.results[1]).toMatchObject({ ok: false, code: 'invalid', externalId: ext(11) });
    expect(body.results[2]).toMatchObject({ ok: false, code: 'invalid' });
    expect(body.results[3]).toMatchObject({ ok: true, result: 'unchanged' });

    const again = await request.post('/api/integrations/teams/batch', {
      headers: bearer(INTEGRATOR.token),
      data: { teams: [{ externalId: ext(10), name: 'CI Batch A', players: players(11, 10) }] },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).stats).toMatchObject({ unchanged: 1, failed: 0 });
  });

  test('sources: per token label; integrator tokens reach nothing else', async ({ request }) => {
    const mine = await put(request, ext(20), { name: 'CI Shared Id', players: players(20) });
    const theirs = await put(request, ext(20), { name: 'CI Shared Id', players: players(20) }, OTHER_INTEGRATOR.token);
    expect(mine.body.result).toBe('created');
    expect(theirs.body.result).toBe('created');
    expect(theirs.body.id).not.toBe(mine.body.id);

    // Not another source, not the admin API.
    const spoof = await request.get(`/api/integrations/teams/${ext(20)}?source=${OTHER_INTEGRATOR.label}`, {
      headers: bearer(INTEGRATOR.token),
    });
    expect(spoof.status()).toBe(403);
    expect((await request.get('/api/teams', { headers: bearer(INTEGRATOR.token) })).status()).toBe(403);
    expect((await request.get('/api/webhooks', { headers: bearer(INTEGRATOR.token) })).status()).toBe(403);

    // A read-only token reads, never writes.
    expect(
      (await request.get(`/api/integrations/teams?source=${INTEGRATOR.label}`, { headers: bearer(READONLY_TOKEN.token) })).status()
    ).toBe(200);
    expect((await put(request, ext(21), { name: 'X', players: players(21) }, READONLY_TOKEN.token)).status).toBe(403);

    // An admin token or session acts for a source it names.
    const asAdmin = await request.get(`/api/integrations/teams/${ext(20)}?source=${INTEGRATOR.label}`, {
      headers: bearer(ADMIN_TOKEN.token),
    });
    expect((await asAdmin.json()).team.id).toBe(mine.body.id);
    expect((await request.get(`/api/integrations/teams/${ext(20)}`)).status()).toBe(400);
    const session = await request.get(`/api/integrations/teams/${ext(20)}?source=${OTHER_INTEGRATOR.label}`);
    expect((await session.json()).team.id).toBe(theirs.body.id);

    // A wrong token is a 401, not a fall-through to the session.
    expect((await request.get('/api/integrations/teams', { headers: bearer('not-a-real-token-0123456789') })).status()).toBe(401);
  });

  test('a team that is playing keeps its roster; its name can change', async ({ request, baseURL }) => {
    // Creating a CS2 match needs a webhook URL. Set it here rather than
    // relying on an earlier spec in the same shard to have done so.
    const settings = await request.put('/api/settings', {
      data: { webhookUrl: baseURL ?? 'http://localhost:3069' },
    });
    expect(settings.ok(), await settings.text()).toBe(true);
    const a = await put(request, ext(30), { name: 'CI Live A', players: players(30, 31) });
    const b = await put(request, ext(31), { name: 'CI Live B', players: players(32, 33) });
    const slug = `ci-teams-live-${run}`;
    await request.delete(`/api/matches/${slug}`);
    const created = await request.post('/api/matches', {
      data: {
        slug,
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          team1: { id: a.body.id, name: 'CI Live A', players: [{ steamid: steam(30), name: 'p30' }] },
          team2: { id: b.body.id, name: 'CI Live B', players: [{ steamid: steam(32), name: 'p32' }] },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    expect((await request.post('/api/test/match-state', { data: { slug, status: 'live' } })).ok()).toBe(true);

    const refused = await put(request, ext(30), { name: 'CI Live A', players: players(30, 34) });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'team_in_live_match' });
    expect(refused.body.error).toContain(slug);
    const renamed = await put(request, ext(30), { name: 'CI Live A Renamed', players: players(31, 30) });
    expect(renamed.body).toMatchObject({ result: 'updated' });

    expect((await request.post('/api/test/match-state', { data: { slug, status: 'completed' } })).ok()).toBe(true);
    const after = await put(request, ext(30), { name: 'CI Live A Renamed', players: players(30, 34) });
    expect(after.body).toMatchObject({ result: 'updated' });
    await request.delete(`/api/matches/${slug}`);
  });
});
