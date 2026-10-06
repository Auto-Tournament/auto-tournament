import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { configureWebhook } from '../helpers/setup';

/**
 * Several tournaments at once (Vikunja 1840): creating another never
 * replaces one, a request names its tournament with X-Tournament-Id, the
 * list shows drafts to admins only, and one tournament is featured.
 *
 * @tag api
 */

const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

async function list(request: APIRequestContext, headers: Record<string, string> = getAuthHeader()) {
  const res = await request.get('/api/tournaments', { headers });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { tournaments: Array<{ id: number; name: string; draft: boolean; featured: boolean; status: string }>; featuredId: number };
}

test.describe.serial('Multiple tournaments', () => {
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    const wiped = await request.post('/api/test/reset-database', { headers: getAuthHeader() });
    expect(wiped.ok(), await wiped.text()).toBe(true);
  });

  test('two tournaments side by side, each addressed by its id', { tag: ['@api'] }, async ({ request, playwright, baseURL }) => {
    await signInViaRequest(request);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'multi');
    expect(teams).toBeTruthy();
    const teamIds = teams!.map((t) => t.id);
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.post('/api/tournaments', { data: { name: 'x' } })).status()).toBe(401);

    const base = { type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds };
    const a = await request.post('/api/tournaments', { headers: getAuthHeader(), data: { ...base, name: 'Cup A' } });
    expect(a.status(), await a.text()).toBeLessThan(300);
    const idA = (await a.json()).tournament.id as number;
    const b = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'Cup B', copyFrom: idA },
    });
    expect(b.status(), await b.text()).toBeLessThan(300);
    const tb = (await b.json()).tournament;
    expect(tb.id).toBe(idA + 1);
    // Copied: format and maps; not the teams.
    expect(tb).toMatchObject({ type: 'single_elimination', format: 'bo1', maps: ['de_mirage'] });
    expect(tb.teamIds).toEqual([]);

    // Each is read by its id; neither replaced the other.
    const readA = await (await request.get('/api/tournament', { headers: as(idA) })).json();
    const readB = await (await request.get('/api/tournament', { headers: as(tb.id) })).json();
    expect(readA.tournament.name).toBe('Cup A');
    expect(readB.tournament.name).toBe('Cup B');

    // Drafts (set up, sign-up closed) are for admins.
    const adminList = await list(request);
    expect(adminList.tournaments.map((t) => t.name)).toEqual(expect.arrayContaining(['Cup A', 'Cup B']));
    const publicList = await list(anon, {});
    expect(publicList.tournaments.find((t) => t.name === 'Cup A')).toBeUndefined();

    // Featured: the newest by default, the picked one once picked.
    expect(adminList.featuredId).toBe(tb.id);
    const feature = await request.put(`/api/tournaments/${idA}/feature`, { headers: getAuthHeader() });
    expect(feature.ok(), await feature.text()).toBe(true);
    expect((await (await anon.get('/api/tournament/current-id')).json()).id).toBe(idA);
    expect((await (await request.get('/api/tournament', { headers: getAuthHeader() })).json()).tournament.name).toBe('Cup A');
    expect((await request.put('/api/tournaments/999999/feature', { headers: getAuthHeader() })).status()).toBe(404);

    // Deleting one leaves the other.
    const del = await request.delete('/api/tournament', { headers: as(tb.id) });
    expect(del.ok(), await del.text()).toBe(true);
    expect((await request.get('/api/tournament', { headers: as(idA) })).ok()).toBe(true);
    expect((await request.get('/api/tournament', { headers: as(tb.id) })).status()).toBe(404);

    await anon.dispose();
  });
});
