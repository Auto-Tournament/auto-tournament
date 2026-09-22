import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEFAULT_ADMIN_STEAM_ID, getAuthHeader, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTeam, type Team } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { getOk, normalizeForGolden, postOk, resetDatabaseForGolden } from '../helpers/golden';

/**
 * `matchLifecycle.applySeriesResult`: the one path every series end takes (the
 * game's series_end, the admin "set winner" action, later manual reports).
 *
 * - applying the same result twice changes nothing;
 * - a match in `ready` or `live` accepts a result;
 * - a result from the admin records who set it;
 * - a series finished by an admin ends up in the same state (match, bracket,
 *   player stats and ratings) as the same series finished by the game.
 *
 * Results are applied through POST /api/test/series-result (the core call,
 * any source) and the public admin/event endpoints. The spec wipes the
 * database, like the golden specs, so two runs can be compared value for value.
 *
 * @tag api
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

const TEAMS: Team[] = ['alpha', 'bravo', 'charlie', 'delta'].map((name, t) => ({
  id: `lifecycle-${name}`,
  name: `Lifecycle ${name[0].toUpperCase()}${name.slice(1)}`,
  players: [0, 1].map((p) => ({
    steamId: `7656119900000${t}${p}`.padEnd(17, '0'),
    name: `${name}-${p}`,
  })),
}));

interface MatchView {
  slug: string;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
  winner?: { id: string } | null;
}

async function getMatch(request: APIRequestContext, slug: string): Promise<MatchView & Record<string, unknown>> {
  const body = await getOk<{ match: MatchView & Record<string, unknown> }>(
    request,
    `/api/matches/${slug}`
  );
  return body.match;
}

/** A fresh database with a 4-team single-elimination Bo3, started. */
async function startTournament(request: APIRequestContext): Promise<void> {
  await resetDatabaseForGolden(request);
  expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
  for (const team of TEAMS) {
    expect(await createTeam(request, team), `create ${team.id}`).toBeTruthy();
  }
  expect(await createTestServer(request, 'lifecycle')).toBeTruthy();
  await postOk(request, '/api/tournament', {
    name: 'Match Lifecycle',
    type: 'single_elimination',
    format: 'bo3',
    maps: MAPS,
    teamIds: TEAMS.map((t) => t.id),
    settings: { seedingMethod: 'manual' },
  });
  await postOk(request, '/api/tournament/start', {});
}

/** The round-1 matches (the semi-finals), in bracket order. */
async function semiFinals(request: APIRequestContext): Promise<[string, string]> {
  const body = await getOk<{
    matches: Array<{ slug: string; round: number; matchNumber: number }>;
  }>(request, '/api/matches');
  const semis = body.matches
    .filter((m) => m.round === 1)
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((m) => m.slug);
  expect(semis, 'two semi-finals').toHaveLength(2);
  return [semis[0], semis[1]];
}

async function setStatus(request: APIRequestContext, slug: string, status: string): Promise<void> {
  await postOk(request, '/api/test/match-state', { slug, status });
}

async function applyResult(
  request: APIRequestContext,
  slug: string,
  winner: 'team1' | 'team2' | 'none',
  score: [number, number],
  meta: { source?: string; actorId?: string | null } = {}
): Promise<{ applied: boolean; reason?: string }> {
  return postOk(request, '/api/test/series-result', {
    slug,
    result: { games: [], team1Score: score[0], team2Score: score[1], winner },
    meta,
  });
}

async function sendEvent(request: APIRequestContext, slug: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/events/${slug}`, { headers: SERVER_HEADERS, data });
  expect(res.ok(), `${String(data.event)} rejected: ${await res.text()}`).toBe(true);
}

/** Two maps to team1: the series is 2-0 and waits for its series end. */
async function playTwoMapsForTeam1(request: APIRequestContext, slug: string): Promise<void> {
  const matchId = (await getMatch(request, slug)).id as number;
  await sendEvent(request, slug, {
    event: 'going_live',
    matchid: matchId,
    map_number: 0,
    map_name: 'de_mirage',
  });
  const scores: Array<[number, number]> = [
    [13, 5],
    [13, 9],
  ];
  for (const [mapNumber, [t1, t2]] of scores.entries()) {
    await sendEvent(request, slug, {
      event: 'map_result',
      matchid: matchId,
      map_number: mapNumber,
      map_name: MAPS[mapNumber],
      team1: { score: t1, series_score: mapNumber + 1 },
      team2: { score: t2, series_score: 0 },
      winner: { side: '3', team: 'team1' },
    });
  }
}

/** Everything a finished series writes, read back through the API. */
async function snapshot(request: APIRequestContext, slug: string) {
  const match = await getMatch(request, slug);
  const bracket = await getOk<{ matches?: unknown[] }>(request, '/api/tournament/bracket');
  const players: Record<string, unknown> = {};
  for (const steamId of TEAMS.flatMap((t) => t.players.map((p) => p.steamId))) {
    const summary = await getOk(request, `/api/players/${steamId}/summary`);
    const ratingHistory = await getOk<{ history: unknown }>(
      request,
      `/api/players/${steamId}/rating-history`
    );
    players[steamId] = { summary, ratingHistory: ratingHistory.history };
  }
  return normalizeForGolden(
    { match, bracket: bracket.matches, players },
    { replace: { [DEFAULT_ADMIN_STEAM_ID]: '<admin>' } }
  );
}

test.describe.serial('Series results through applySeriesResult', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test(
    'accepts ready and live matches; applying twice changes nothing',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await startTournament(request);
      const [readySlug, liveSlug] = await semiFinals(request);
      await setStatus(request, readySlug, 'ready');
      await setStatus(request, liveSlug, 'live');

      const ready = await applyResult(request, readySlug, 'team1', [2, 0]);
      expect(ready).toMatchObject({ applied: true });
      const readyMatch = await getMatch(request, readySlug);
      expect(readyMatch.status).toBe('completed');
      expect(readyMatch.winner?.id).toBe(readyMatch.team1?.id);

      const live = await applyResult(request, liveSlug, 'team2', [1, 2]);
      expect(live).toMatchObject({ applied: true });
      const liveMatch = await getMatch(request, liveSlug);
      expect(liveMatch.status).toBe('completed');
      expect(liveMatch.winner?.id).toBe(liveMatch.team2?.id);

      const before = await snapshot(request, readySlug);
      const again = await applyResult(request, readySlug, 'team2', [0, 2]);
      expect(again).toEqual({ success: true, applied: false, reason: 'already_completed' });
      expect(await snapshot(request, readySlug)).toEqual(before);
    }
  );

  test(
    'an admin result records who set it',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await startTournament(request);
      const [slug, other] = await semiFinals(request);
      await playTwoMapsForTeam1(request, slug);

      const res = await request.post(`/api/matches/${slug}/winner`, {
        headers: getAuthHeader(),
        data: { winner: 'team1' },
      });
      expect(res.ok(), await res.text()).toBe(true);

      const events = await getOk<{ data: Array<{ event_type: string; event_data: unknown }> }>(
        request,
        `/api/events/${slug}?type=series_result`
      );
      expect(events.data.map((e) => e.event_data)).toEqual([
        {
          event: 'series_result',
          source: 'admin',
          actorId: DEFAULT_ADMIN_STEAM_ID,
          winner: 'team1',
          team1_series_score: 2,
          team2_series_score: 0,
        },
      ]);

      // A result from the game itself records nothing extra.
      await setStatus(request, other, 'live');
      expect(await applyResult(request, other, 'team1', [2, 1], { source: 'integration' })).toMatchObject({
        applied: true,
      });
      const none = await getOk<{ data: unknown[] }>(request, `/api/events/${other}?type=series_result`);
      expect(none.data).toEqual([]);
    }
  );

  test(
    'a series finished by an admin leaves the same state as one finished by the game',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      // By the game: two maps, then MatchZy's series_end.
      await startTournament(request);
      let [slug] = await semiFinals(request);
      await playTwoMapsForTeam1(request, slug);
      const matchId = (await getMatch(request, slug)).id as number;
      await sendEvent(request, slug, {
        event: 'series_end',
        matchid: matchId,
        team1_series_score: 2,
        team2_series_score: 0,
        winner: { side: '3', team: 'team1' },
        time_until_restore: 10,
      });
      await expect.poll(async () => (await getMatch(request, slug)).status).toBe('completed');
      const byGame = await snapshot(request, slug);

      // By an admin: the same two maps, then POST /winner.
      await startTournament(request);
      [slug] = await semiFinals(request);
      await playTwoMapsForTeam1(request, slug);
      const res = await request.post(`/api/matches/${slug}/winner`, {
        headers: getAuthHeader(),
        data: { winner: 'team1' },
      });
      expect(res.ok(), await res.text()).toBe(true);
      const byAdmin = await snapshot(request, slug);

      expect(byAdmin).toEqual(byGame);

      // And the snapshots hold what they should: the series finished, the
      // winner moved into the final, and ratings were written.
      const snap = byAdmin as unknown as {
        match: { status: string; winner?: { id: string } };
        bracket: Array<{ round: number; team1?: { id: string } | null; team2?: { id: string } | null }>;
        players: Record<string, { ratingHistory: unknown[] }>;
      };
      expect(snap.match.status).toBe('completed');
      const final = snap.bracket.find((m) => m.round === 2);
      expect([final?.team1?.id, final?.team2?.id]).toContain(snap.match.winner?.id);
      expect(Object.values(snap.players).filter((p) => p.ratingHistory.length > 0)).toHaveLength(4);
    }
  );
});
