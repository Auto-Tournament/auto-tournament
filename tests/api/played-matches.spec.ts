import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTestTeams } from '../helpers/teams';
import { findMatchByTeams } from '../helpers/matches';

/**
 * Played matches outlive their tournament (Vikunja 1834): deleting a
 * tournament keeps its finished matches (with its name), its id is never given
 * out again, and /api/matches/played lists them next to standalone matches.
 *
 * @tag api
 */

const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

test.describe.serial('Played matches', () => {
  test('a deleted tournament keeps its played match; its id is not reused', { tag: ['@api'] }, async ({ request, playwright, baseURL }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'played');
    expect(teams).toBeTruthy();
    const [team1, team2] = teams!;

    const created = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'Gone cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = (await created.json()).tournament.id as number;
    expect((await request.post('/api/tournament/start', { headers: as(id) })).ok()).toBe(true);
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match).toBeTruthy();
    expect((await request.post('/api/test/match-state', { headers: getAuthHeader(), data: { slug: match!.slug, status: 'live' } })).ok()).toBe(true);
    expect((await request.post(`/api/matches/${match!.slug}/winner`, { headers: getAuthHeader(), data: { winner: 'team1' } })).ok()).toBe(true);
    await expect
      .poll(async () => (await (await request.get('/api/tournament', { headers: as(id) })).json()).tournament?.status, { timeout: 15000 })
      .toBe('completed');

    // Delete it from the admin UI: the played match stays, out of any tournament, with its name.
    expect((await request.delete('/api/tournament?keepPlayed=1', { headers: as(id) })).ok()).toBe(true);
    expect((await request.get(`/api/matches/${match!.slug}`, { headers: getAuthHeader() })).ok()).toBe(true);

    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/matches/played')).status()).toBe(401);
    await anon.dispose();

    const played = (await (await request.get('/api/matches/played', { headers: getAuthHeader() })).json()).matches as Array<{
      slug: string;
      kind: string;
      tournamentId: number | null;
      tournamentName: string | null;
      team1: string;
      winner: string | null;
    }>;
    expect(played.find((m) => m.slug === match!.slug)).toMatchObject({
      kind: 'tournament',
      tournamentId: null,
      tournamentName: 'Gone cup',
      team1: team1.name,
      winner: 'team1',
    });

    // The next tournament gets a new id, so the kept match's slug is not taken over.
    const next = await request.post('/api/tournaments', {
      headers: getAuthHeader(),
      data: { name: 'After cup', type: 'single_elimination', format: 'bo1', maps: ['de_mirage'], teamIds: [team1.id, team2.id] },
    });
    expect(next.ok(), await next.text()).toBe(true);
    const nextId = (await next.json()).tournament.id as number;
    expect(nextId).toBeGreaterThan(id);
    await request.delete('/api/tournament', { headers: as(nextId) });

    // No demos for it: the archive says so.
    expect((await request.get(`/api/demos/archive.tar?slugs=${match!.slug}`, { headers: getAuthHeader() })).status()).toBe(404);

    await request.delete(`/api/matches/${match!.slug}`, { headers: getAuthHeader() });
  });
});
