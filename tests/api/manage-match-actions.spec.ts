import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTeam, type Team } from '../helpers/teams';
import { getOk, postOk, resetDatabaseForGolden } from '../helpers/golden';
import { createTestServer } from '../helpers/servers';
import { goingLive, mapResult, sendReadyUpEvents } from '../helpers/readyUp';

/**
 * The admin match page's actions that are not Ready Up commands (the
 * ActionDialogs board):
 *
 * - correcting one map's result: rounds, winner and a reason; the series
 *   score follows; refused when it would hand a finished series to the other
 *   team;
 * - the server picker: every Ready Up server with its health;
 * - putting a match on a picked server only when it waits for one.
 *
 * @tag api
 * @tag regression
 */

const MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_train',
  'de_nuke',
];

const TEAMS: Team[] = ['north', 'south', 'east', 'west'].map((name, t) => ({
  id: `manage-${name}`,
  name: `Manage ${name[0].toUpperCase()}${name.slice(1)}`,
  players: [0, 1].map((p) => ({
    steamId: `7656119911000${t}${p}`.padEnd(17, '0'),
    name: `${name}-${p}`,
  })),
}));

async function firstMatch(request: APIRequestContext): Promise<string> {
  const body = await getOk<{
    matches: Array<{ slug: string; round: number; matchNumber: number }>;
  }>(request, '/api/matches');
  const round1 = body.matches
    .filter((m) => m.round === 1)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  expect(round1.length).toBeGreaterThan(0);
  return round1[0].slug;
}

test.describe.serial('admin match page actions', () => {
  let slug = '';

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetDatabaseForGolden(request);
    expect(await signInViaRequest(request)).toBe(true);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    for (const team of TEAMS) {
      expect(await createTeam(request, team), `create ${team.id}`).toBeTruthy();
    }
    expect(await createTestServer(request, 'manage-actions')).toBeTruthy();
    await postOk(request, '/api/tournament', {
      name: 'Manage Actions',
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamIds: TEAMS.map((t) => t.id),
      settings: { seedingMethod: 'manual' },
    });
    await postOk(request, '/api/tournament/start', {});
    slug = await firstMatch(request);
  });

  test('a map result is corrected, logged, and the series score follows', async ({ request }) => {
    // Map 1 to team2, map 2 to team1: 1-1, the series still running.
    await postOk(request, '/api/test/match-state', { slug, status: 'live' });
    await sendReadyUpEvents(request, slug, [
      goingLive(1),
      mapResult({
        mapNumber: 1,
        mapName: MAPS[0],
        team1: 9,
        team2: 13,
        series: [0, 1],
        winner: 'team2',
      }),
      goingLive(2),
      mapResult({
        mapNumber: 2,
        mapName: MAPS[1],
        team1: 13,
        team2: 11,
        series: [1, 1],
        winner: 'team1',
      }),
    ]);

    const headers = getAuthHeader();
    const url = `/api/matches/${slug}/maps/1/result`;

    // A reason is required, and the scores must be numbers.
    expect(
      (
        await request.post(url, {
          headers,
          data: { team1Score: 13, team2Score: 4, winner: 'team1' },
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await request.post(url, {
          headers,
          data: { team1Score: -1, team2Score: 4, winner: 'team1', reason: 'x' },
        })
      ).status()
    ).toBe(400);
    // A map that has not been played has nothing to correct.
    expect(
      (
        await request.post(`/api/matches/${slug}/maps/3/result`, {
          headers,
          data: { team1Score: 13, team2Score: 4, winner: 'team1', reason: 'x' },
        })
      ).status()
    ).toBe(404);

    const res = await request.post(url, {
      headers,
      data: { team1Score: 13, team2Score: 4, winner: 'team1', reason: 'played on a backup' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { series: { before: number[]; after: number[] } };
    expect(body.series.before).toEqual([1, 1]);
    expect(body.series.after).toEqual([2, 0]);

    const match = await getOk<{
      match: { maps?: unknown; mapResults?: Array<Record<string, unknown>> };
    }>(request, `/api/matches/${slug}`);
    expect(JSON.stringify(match)).toContain('13');

    const events = await getOk<{ events?: Array<{ event_type?: string; event_data?: unknown }> }>(
      request,
      `/api/events/${slug}`
    );
    const logged = JSON.stringify(events);
    expect(logged).toContain('correct_map_result');
    expect(logged).toContain('played on a backup');
  });

  test('a finished series cannot be handed to the other team by a correction', async ({
    request,
  }) => {
    // Team1 takes the series 2-0 (map 2 to team1 too).
    await postOk(request, '/api/test/series-result', {
      slug,
      result: {
        games: [
          { gameNumber: 1, mapName: MAPS[0], team1Score: 13, team2Score: 4, winner: 'team1' },
          { gameNumber: 2, mapName: MAPS[1], team1Score: 13, team2Score: 11, winner: 'team1' },
        ],
        team1Score: 2,
        team2Score: 0,
        winner: 'team1',
      },
    });
    const headers = getAuthHeader();
    // Flipping one map leaves it 1-1: no longer team1's series.
    const flip = await request.post(`/api/matches/${slug}/maps/2/result`, {
      headers,
      data: { team1Score: 11, team2Score: 13, winner: 'team2', reason: 'test' },
    });
    expect(flip.status()).toBe(409);
    // Rounds only, same winner: fine.
    const rounds = await request.post(`/api/matches/${slug}/maps/2/result`, {
      headers,
      data: { team1Score: 13, team2Score: 10, winner: 'team1', reason: 'scoreboard typo' },
    });
    expect(rounds.status(), await rounds.text()).toBe(200);
  });

  test('the server picker and putting a match on a server', async ({ request }) => {
    const headers = getAuthHeader();
    const list = await request.get(`/api/game/cs2/matches/${slug}/manage/servers`, { headers });
    expect(list.status()).toBe(200);
    expect(Array.isArray(((await list.json()) as { servers: unknown[] }).servers)).toBe(true);

    expect(
      (
        await request.get('/api/game/cs2/matches/no-such-match/manage/servers', { headers })
      ).status()
    ).toBe(404);

    // The match is finished: it does not wait for a server.
    const allocate = await request.post(`/api/game/cs2/matches/${slug}/manage/allocate`, {
      headers,
      data: { serverId: 'any' },
    });
    expect(allocate.status()).toBe(409);
    expect(
      (
        await request.post(`/api/game/cs2/matches/${slug}/manage/allocate`, { headers, data: {} })
      ).status()
    ).toBe(400);
  });
});
