import { test, expect, type APIRequestContext } from '@playwright/test';
import { configureWebhook } from '../helpers/setup';
import { createTestTeams } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { findMatchByTeams } from '../helpers/matches';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import type { Team } from '../helpers/teams';
import { decideExhaustedSeries, isSeriesOutOfMaps } from '../../api/src/utils/exhaustedSeries';

/**
 * A Bo3 that has played all its maps must end, even without series_end.
 *
 * QA (MAT 2.4.8, 8-team double elimination, Bo3 grand final, no draws): map 0
 * was recorded as a draw (plugin bug), maps 1 and 2 went one each, and the
 * plugin crashed without sending series_end. The grand final stayed live at
 * 1-1 on "map index 3", map 0 had winnerTeam 'none', and the tournament never
 * got a champion.
 *
 * MAT now decides a series that is out of maps: maps won, then total rounds,
 * then map-0 damage; if still level the match waits for an admin, who sets the
 * winner with POST /api/matches/:slug/winner.
 *
 * @tag api
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

test.describe('Exhausted series decision (unit)', () => {
  const map = (
    mapNumber: number,
    team1Score: number,
    team2Score: number,
    winnerTeam: 'team1' | 'team2' | 'none'
  ) => ({ mapNumber, team1Score, team2Score, winnerTeam });

  test('out of maps only once every map in the maplist has a result', () => {
    expect(isSeriesOutOfMaps([map(0, 12, 12, 'none'), map(1, 13, 9, 'team1')], 3)).toBe(false);
    expect(
      isSeriesOutOfMaps([map(0, 12, 12, 'none'), map(1, 13, 9, 'team1'), map(2, 7, 13, 'team2')], 3)
    ).toBe(true);
  });

  test('maps won decide first, then rounds, then map-0 damage, else an admin', () => {
    expect(
      decideExhaustedSeries([map(0, 13, 5, 'team1'), map(1, 5, 13, 'team2'), map(2, 13, 11, 'team1')])
        .winner
    ).toBe('team1');

    // The QA grand final: draw, then one map each. team2 has more rounds.
    const qa = decideExhaustedSeries([
      map(0, 12, 12, 'none'),
      map(1, 13, 9, 'team1'),
      map(2, 7, 13, 'team2'),
    ]);
    expect(qa).toMatchObject({ winner: 'team2', decidedBy: 'rounds', team1Rounds: 32, team2Rounds: 34 });

    const levelRounds = [map(0, 12, 12, 'none'), map(1, 13, 11, 'team1'), map(2, 11, 13, 'team2')];
    expect(decideExhaustedSeries(levelRounds, { team1: 2400, team2: 2650 })).toMatchObject({
      winner: 'team2',
      decidedBy: 'map0_damage',
    });
    expect(decideExhaustedSeries(levelRounds, null)).toMatchObject({ winner: null, decidedBy: 'admin' });
  });
});

async function startBo3(request: APIRequestContext, teams: Team[]) {
  await request.delete('/api/tournament');
  const created = await request.post('/api/tournament', {
    data: {
      name: `Exhausted Series ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamIds: teams.map((t) => t.id),
      overtimeMode: 'disabled',
    },
  });
  expect(created.ok(), `tournament create failed: ${await created.text()}`).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const started = await request.post('/api/tournament/start', { data: {} });
  expect(started.ok(), `tournament start failed: ${await started.text()}`).toBe(true);
}

/** A map_result shaped like MatchZy's: nested team scores and a winner object. */
async function sendMapResult(
  request: APIRequestContext,
  slug: string,
  mapNumber: number,
  score: [number, number],
  series: [number, number],
  winner: 'team1' | 'team2' | 'none'
) {
  const res = await request.post(`/api/events/${slug}`, {
    headers: HEADERS,
    data: {
      event: 'map_result',
      matchid: slug,
      map_number: mapNumber,
      map_name: MAPS[mapNumber],
      team1: { id: 'team1', name: 'Team One', series_score: series[0], score: score[0] },
      team2: { id: 'team2', name: 'Team Two', series_score: series[1], score: score[1] },
      winner: { side: winner === 'none' ? 'none' : 'ct', team: winner },
    },
  });
  expect(res.ok(), `map_result ${mapNumber} rejected: ${await res.text()}`).toBe(true);
}

async function getMatch(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  const body = await res.json();
  return (body.match ?? body) as {
    status: string;
    mapNumber?: number;
    team1?: { id: string };
    team2?: { id: string };
    winner?: { id: string };
  };
}

test.describe.serial('Series out of maps without series_end', () => {
  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'exhausted');
    expect(teams).toBeTruthy();
    [team1, team2] = teams!;
    expect(await createTestServer(request, 'exhausted')).toBeTruthy();
  });

  test(
    'draw on map 0, then 1-1: MAT finishes the series on rounds',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await startBo3(request, [team1, team2]);
      const slug = (await findMatchByTeams(request, team1.id, team2.id))!.slug;

      await sendMapResult(request, slug, 0, [12, 12], [0, 0], 'none');
      await sendMapResult(request, slug, 1, [13, 9], [1, 0], 'team1');
      await sendMapResult(request, slug, 2, [7, 13], [1, 1], 'team2');

      await expect
        .poll(async () => (await getMatch(request, slug)).status, {
          timeout: 15000,
          message: 'a series with every map played must not stay live',
        })
        .toBe('completed');

      const match = await getMatch(request, slug);
      // team2 won on rounds, 34-32.
      expect(match.winner?.id).toBe(match.team2?.id);
      // Last played map, never an index past the maplist.
      expect(match.mapNumber).toBe(2);
    }
  );

  test(
    'level on maps and rounds: waits for an admin, who sets the winner',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await startBo3(request, [team1, team2]);
      const slug = (await findMatchByTeams(request, team1.id, team2.id))!.slug;

      await sendMapResult(request, slug, 0, [12, 12], [0, 0], 'none');
      await sendMapResult(request, slug, 1, [13, 11], [1, 0], 'team1');
      await sendMapResult(request, slug, 2, [11, 13], [1, 1], 'team2');

      await expect
        .poll(async () => (await getMatch(request, slug)).status, { timeout: 15000 })
        .toBe('needs_decision');
      expect((await getMatch(request, slug)).mapNumber).toBe(2);

      const bad = await request.post(`/api/matches/${slug}/winner`, {
        headers: getAuthHeader(),
        data: { winner: 'both' },
      });
      expect(bad.status()).toBe(400);

      const set = await request.post(`/api/matches/${slug}/winner`, {
        headers: getAuthHeader(),
        data: { winner: 'team1' },
      });
      expect(set.ok(), await set.text()).toBe(true);

      const match = await getMatch(request, slug);
      expect(match.status).toBe('completed');
      expect(match.winner?.id).toBe(match.team1?.id);

      const again = await request.post(`/api/matches/${slug}/winner`, {
        headers: getAuthHeader(),
        data: { winner: 'team2' },
      });
      expect(again.status()).toBe(409);
    }
  );
});
