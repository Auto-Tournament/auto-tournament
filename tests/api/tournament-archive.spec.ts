import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { configureWebhook } from '../helpers/setup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * A finished tournament can be archived (Vikunja 1833): it keeps its matches
 * and results and its public pages stay at its id, it is no longer featured,
 * and another tournament gets a new id. Everything here names its tournament
 * (X-Tournament-Id), so whatever else is in the database does not matter.
 *
 * @tag api
 */

const made: number[] = [];
const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

test.describe.serial('Tournament archive', () => {
  // Delete what this spec made, so the next spec's tournament gets the id
  // (and the bare match slugs) it would have had.
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    for (const id of made) await request.delete('/api/tournament', { headers: as(id) });
  });

  test('only a finished tournament is archived; it keeps its results and the next gets a new id', { tag: ['@api'] }, async ({
    request,
    playwright,
    baseURL,
  }) => {
    await signInViaRequest(request);
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.post('/api/tournament/archive')).status()).toBe(401);
    expect((await request.post('/api/tournament/archive', { headers: as(999999) })).status()).toBe(404);

    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'archive');
    expect(teams).toBeTruthy();
    const [team1, team2] = teams!;
    const created = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'Archive cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = (await created.json()).tournament.id as number;
    made.push(id);

    // Still being set up: not archived.
    expect((await request.post('/api/tournament/archive', { headers: as(id) })).status()).toBe(409);

    const started = await request.post('/api/tournament/start', { headers: as(id) });
    expect(started.ok(), await started.text()).toBe(true);
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    // No game server here: put the match live directly, then an admin sets the winner.
    const live = await request.post('/api/test/match-state', { headers: getAuthHeader(), data: { slug: match!.slug, status: 'live' } });
    expect(live.ok(), await live.text()).toBe(true);
    const won = await request.post(`/api/matches/${match!.slug}/winner`, { headers: getAuthHeader(), data: { winner: 'team1' } });
    expect(won.ok(), await won.text()).toBe(true);
    await expect
      .poll(async () => (await (await request.get('/api/tournament', { headers: as(id) })).json()).tournament?.status, { timeout: 15000 })
      .toBe('completed');

    const archived = await request.post(`/api/tournaments/${id}/archive`, { headers: getAuthHeader() });
    expect(archived.ok(), await archived.text()).toBe(true);
    expect(await archived.json()).toMatchObject({ archivedId: id });
    // Archived: no longer featured.
    expect((await (await anon.get('/api/tournament/current-id')).json()).id).not.toBe(id);

    // The archived one keeps its public results and its match.
    const board = await anon.get(`/api/tournament/${id}/leaderboard`);
    expect(board.ok(), await board.text()).toBe(true);
    const boardBody = await board.json();
    expect(boardBody.tournament).toMatchObject({ id, name: 'Archive cup', status: 'completed' });
    expect(boardBody.tournament.archived_at).toBeGreaterThan(0);
    expect((await anon.get(`/api/tournament/${id}/bracket`)).ok()).toBe(true);
    expect((await request.get(`/api/matches/${match!.slug}`, { headers: getAuthHeader() })).ok()).toBe(true);

    // Another tournament gets a new id and leaves the archived one alone.
    const next = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'Next cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(next.ok(), await next.text()).toBe(true);
    const nextId = (await next.json()).tournament.id as number;
    made.push(nextId);
    expect(nextId).toBeGreaterThan(id);
    expect((await anon.get(`/api/tournament/${id}/leaderboard`)).ok()).toBe(true);

    expect((await anon.get('/api/tournament/999999/leaderboard')).status()).toBe(404);
    await anon.dispose();
  });
});
