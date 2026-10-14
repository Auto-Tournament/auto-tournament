import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTeam, type Team } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { getOk, postOk, resetDatabaseForGolden } from '../helpers/golden';

/**
 * Creating a tournament (POST /api/tournament) where a finished one is: the
 * finished one stays, with its played match, and the new one gets the next
 * id, so its slugs (t<id>-r1m1) never meet the old ones'. It used to replace
 * it: the played matches went, and the new t6-r1m2 showed the old one's demo
 * analyses.
 *
 * @tag api
 * @tag regression
 */

const TEAMS: Team[] = ['alpha', 'bravo'].map((name, t) => ({
  id: `keepfinished-${name}`,
  name: `Keep ${name}`,
  players: [0].map((p) => ({
    steamId: `7656119900001${t}${p}`.padEnd(17, '0'),
    name: `${name}-${p}`,
  })),
}));

const BODY = {
  type: 'single_elimination',
  format: 'bo1',
  maps: ['de_mirage', 'de_inferno', 'de_nuke'],
  teamIds: TEAMS.map((t) => t.id),
  settings: { seedingMethod: 'manual' },
};

test(
  'a new tournament does not replace a finished one',
  { tag: ['@api', '@regression'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetDatabaseForGolden(request);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    for (const team of TEAMS) expect(await createTeam(request, team)).toBeTruthy();
    expect(await createTestServer(request, 'keepfinished')).toBeTruthy();

    const first = await postOk<{ tournament: { id: number } }>(request, '/api/tournament', {
      name: 'First',
      ...BODY,
    });
    await postOk(request, '/api/tournament/start', {});
    const listed = await getOk<{ matches: Array<{ slug: string }> }>(request, '/api/matches');
    expect(listed.matches).toHaveLength(1);
    const slug = listed.matches[0].slug;
    await postOk(request, '/api/test/match-state', { slug, status: 'live' });
    await postOk(request, '/api/test/series-result', {
      slug,
      result: { games: [], team1Score: 1, team2Score: 0, winner: 'team1' },
      meta: {},
    });
    await expect
      .poll(
        async () =>
          (await getOk<{ tournament: { status: string } }>(request, '/api/tournament')).tournament
            .status
      )
      .toBe('completed');

    const second = await postOk<{ tournament: { id: number } }>(request, '/api/tournament', {
      name: 'Second',
      ...BODY,
    });
    expect(second.tournament.id).toBe(first.tournament.id + 1);
    // Its match is its own: a new slug, not the finished one's.
    const now = await getOk<{ matches: Array<{ slug: string }> }>(request, '/api/matches');
    expect(now.matches.map((m) => m.slug)).toContain(`t${second.tournament.id}-r1m1`);
    // The finished one's match is still there, played.
    const old = await getOk<{ match: { status: string } }>(request, `/api/matches/${slug}`);
    expect(old.match.status).toBe('completed');
  }
);

test(
  "a played tournament's id is not given out again after it is deleted",
  { tag: ['@api', '@regression'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    for (const team of TEAMS) await createTeam(request, team);
    const first = await postOk<{ tournament: { id: number } }>(request, '/api/tournament', {
      name: 'To delete',
      ...BODY,
    });
    await postOk(request, '/api/tournament/start', {});
    const listed = await getOk<{ matches: Array<{ slug: string; tournamentId?: number }> }>(
      request,
      '/api/matches'
    );
    const own = listed.matches.find((m) => m.slug.endsWith('r1m1') && m.slug !== 'r1m1');
    expect(own, JSON.stringify(listed.matches)).toBeTruthy();
    await postOk(request, '/api/test/match-state', { slug: own!.slug, status: 'live' });
    const del = await request.delete('/api/tournament', { headers: getAuthHeader() });
    expect(del.ok(), await del.text()).toBe(true);
    const next = await postOk<{ tournament: { id: number } }>(request, '/api/tournament', {
      name: 'After it',
      ...BODY,
    });
    expect(next.tournament.id).toBeGreaterThan(first.tournament.id);
  }
);

// The finished tournaments these leave would show in later specs' match lists.
test.afterAll(async ({ request }) => {
  await resetDatabaseForGolden(request);
});
