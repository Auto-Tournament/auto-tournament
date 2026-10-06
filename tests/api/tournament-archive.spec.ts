import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { configureWebhook } from '../helpers/setup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * A finished tournament makes way for a new one (Vikunja 1833): archived, it
 * keeps its matches and results, its public pages stay at its id, and the
 * next tournament gets the next id.
 *
 * @tag api
 */

async function currentId(request: import('@playwright/test').APIRequestContext): Promise<number> {
  return (await (await request.get('/api/tournament/current-id')).json()).id as number;
}

test.describe.serial('Tournament archive', () => {
  // Archiving moves the instance to tournament 2, whose match slugs carry a
  // prefix (t2-r1m1). Other specs in the shard expect tournament 1, so wipe
  // back to a fresh database afterwards.
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    const wiped = await request.post('/api/test/reset-database', { headers: getAuthHeader() });
    expect(wiped.ok(), await wiped.text()).toBe(true);
  });

  test('only a finished tournament is archived; it keeps its results and the next gets a new id', { tag: ['@api'] }, async ({
    request,
    playwright,
    baseURL,
  }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.post('/api/tournament/archive')).status()).toBe(401);

    const first = await currentId(request);
    expect((await request.post('/api/tournament/archive', { headers: getAuthHeader() })).status()).toBe(404);

    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'archive');
    expect(teams).toBeTruthy();
    const [team1, team2] = teams!;
    const created = await request.post('/api/tournament', {
      headers: getAuthHeader(),
      data: { name: 'Archive cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    expect((await created.json()).tournament.id).toBe(first);

    // Still being set up: not archived.
    expect((await request.post('/api/tournament/archive', { headers: getAuthHeader() })).status()).toBe(409);

    const started = await request.post('/api/tournament/start', { headers: getAuthHeader() });
    expect(started.ok(), await started.text()).toBe(true);
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    // No game server here: put the match live directly, then an admin sets the winner.
    const live = await request.post('/api/test/match-state', { headers: getAuthHeader(), data: { slug: match!.slug, status: 'live' } });
    expect(live.ok(), await live.text()).toBe(true);
    const won = await request.post(`/api/matches/${match!.slug}/winner`, { headers: getAuthHeader(), data: { winner: 'team1' } });
    expect(won.ok(), await won.text()).toBe(true);
    await expect
      .poll(async () => (await (await request.get('/api/tournament', { headers: getAuthHeader() })).json()).tournament?.status, {
        timeout: 15000,
      })
      .toBe('completed');

    const archived = await request.post('/api/tournament/archive', { headers: getAuthHeader() });
    expect(archived.ok(), await archived.text()).toBe(true);
    expect(await archived.json()).toMatchObject({ archivedId: first, currentId: first + 1 });
    expect(await currentId(request)).toBe(first + 1);

    // No current tournament now: the setup page offers Create.
    expect((await request.get('/api/tournament', { headers: getAuthHeader() })).status()).toBe(404);

    // The archived one keeps its public results and its match.
    const board = await anon.get(`/api/tournament/${first}/leaderboard`);
    expect(board.ok(), await board.text()).toBe(true);
    const boardBody = await board.json();
    expect(boardBody.tournament).toMatchObject({ id: first, name: 'Archive cup', status: 'completed' });
    expect(boardBody.tournament.archived_at).toBeGreaterThan(0);
    expect((await anon.get(`/api/tournament/${first}/bracket`)).ok()).toBe(true);
    expect((await request.get(`/api/matches/${match!.slug}`, { headers: getAuthHeader() })).ok()).toBe(true);

    // The next tournament gets the next id.
    const next = await request.post('/api/tournament', {
      headers: getAuthHeader(),
      data: { name: 'Next cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(next.ok(), await next.text()).toBe(true);
    expect((await next.json()).tournament.id).toBe(first + 1);
    expect((await anon.get(`/api/tournament/${first}/leaderboard`)).ok()).toBe(true);

    await request.delete('/api/tournament', { headers: getAuthHeader() });
    expect((await anon.get('/api/tournament/999999/leaderboard')).status()).toBe(404);
    await anon.dispose();
  });
});
