import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { findMatchByTeams } from '../helpers/matches';

/**
 * A match's CS2 runtime rows (live state, fleet assignment, failovers, round
 * backups and restores) follow the match row, so a deleted match leaves none
 * for a reused slug to inherit.
 *
 * @tag api
 */

const as = (id: number) => ({ ...getAuthHeader(), 'X-Tournament-Id': String(id) });

const RUNTIME_TABLES = [
  'cs2_match_live_state',
  'cs2_fleet_assignments',
  'cs2_fleet_failovers',
  'cs2_match_round_backups',
  'cs2_match_round_backup_parts',
  'cs2_match_round_restores',
];

async function runtimeRows(
  request: APIRequestContext,
  slug: string,
  seed = false
): Promise<Record<string, number>> {
  const res = await request.post('/api/test/cs2-tables/match-runtime', {
    headers: getAuthHeader(),
    data: { slug, seed },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).counts;
}

async function startedTournament(request: APIRequestContext, name: string) {
  expect(await signInViaRequest(request)).toBe(true);
  const teams = await createTestTeams(request, name);
  expect(teams).toBeTruthy();
  const [team1, team2] = teams!;
  const created = await request.post('/api/tournaments', {
    headers: getAuthHeader(),
    data: {
      name,
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage'],
      teamIds: [team1.id, team2.id],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = (await created.json()).tournament.id as number;
  expect((await request.post('/api/tournament/start', { headers: as(id) })).ok()).toBe(true);
  const match = await findMatchByTeams(request, team1.id, team2.id);
  expect(match).toBeTruthy();
  return { id, slug: match!.slug };
}

test.describe.serial('CS2 match delete cascade', () => {
  test('deleting a match removes its CS2 runtime rows', { tag: ['@api'] }, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const slug = `cascade-${Date.now()}`;
    const created = await request.post('/api/matches', {
      headers: getAuthHeader(),
      data: {
        slug,
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          players_per_team: 1,
          map_sides: ['team1_ct'],
          team1: {
            name: 'Cascade Alpha',
            players: [{ steamid: '76561198000000001', name: 'alice' }],
          },
          team2: {
            name: 'Cascade Bravo',
            players: [{ steamid: '76561198000000002', name: 'bob' }],
          },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const seeded = await runtimeRows(request, slug, true);
    for (const table of RUNTIME_TABLES) expect(seeded[table], table).toBe(1);
    expect((await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() })).ok()).toBe(
      true
    );
    const after = await runtimeRows(request, slug);
    for (const table of RUNTIME_TABLES) expect(after[table], table).toBe(0);
  });

  test(
    'a reset tournament starts its matches without old live state',
    { tag: ['@api'] },
    async ({ request }) => {
      const { id, slug } = await startedTournament(request, 'cascade-reset');
      await runtimeRows(request, slug, true);
      const reset = await request.post('/api/tournament/reset', { headers: as(id) });
      expect(reset.ok(), await reset.text()).toBe(true);
      const after = await runtimeRows(request, slug);
      for (const table of RUNTIME_TABLES) expect(after[table], table).toBe(0);
      await request.delete('/api/tournament', { headers: as(id) });
    }
  );

  test('kept played matches keep their live state', { tag: ['@api'] }, async ({ request }) => {
    const { id, slug } = await startedTournament(request, 'cascade-keep');
    expect(
      (
        await request.post('/api/test/match-state', {
          headers: getAuthHeader(),
          data: { slug, status: 'live' },
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await request.post(`/api/matches/${slug}/winner`, {
          headers: getAuthHeader(),
          data: { winner: 'team1' },
        })
      ).ok()
    ).toBe(true);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/tournament', { headers: as(id) })).json()).tournament
            ?.status,
        { timeout: 15000 }
      )
      .toBe('completed');
    await runtimeRows(request, slug, true);
    expect((await request.delete('/api/tournament?keepPlayed=1', { headers: as(id) })).ok()).toBe(
      true
    );
    const after = await runtimeRows(request, slug);
    for (const table of RUNTIME_TABLES) expect(after[table], table).toBe(1);
    await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
  });

  test('the cascade keys exist', { tag: ['@api'] }, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const res = await request.post('/api/test/cs2-tables/match-runtime', {
      headers: getAuthHeader(),
      data: { slug: 'none' },
    });
    const keys = (await res.json()).foreignKeys as Array<{ conname: string; def: string }>;
    for (const table of RUNTIME_TABLES) {
      const fk = keys.find((k) => k.conname === `${table}_match_slug_fkey`);
      expect(fk, table).toBeTruthy();
      expect(fk!.def).toContain('REFERENCES matches(slug) ON DELETE CASCADE');
    }
  });
});
