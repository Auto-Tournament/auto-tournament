import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  sendReadyUpEvents,
  roundEnd as readyUpRoundEnd,
  mapResult as readyUpMapResult,
  seriesEnd as readyUpSeriesEnd,
  type ReadyUpEvent,
} from '../helpers/readyUp';

/**
 * Score fields on matches, and the tournament champion.
 *
 * The match list used to overlay "series score if it is positive, otherwise the
 * current map's rounds" **per side**, so a live BO3 could report "23 vs 1" —
 * team 1's rounds against team 2's maps won — and the admin Matches page showed
 * exactly that. Every field now means one thing for both sides:
 *
 *   team1SeriesScore / team2SeriesScore  maps won
 *   team1MapScore   / team2MapScore      rounds on the map being played
 *                                        (the last map once completed)
 *   team1Score      / team2Score         headline: rounds while in progress,
 *                                        maps won once completed
 *
 * The tournament API also had no champion at all once everything finished.
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
  'de_vertigo',
  'de_nuke',
];

type ListedMatch = {
  id: number;
  slug: string;
  round: number;
  status: string;
  team1?: { id: string; name: string };
  team2?: { id: string; name: string };
  winner?: { id: string };
  team1Score?: number;
  team2Score?: number;
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  team1MapScore?: number | null;
  team2MapScore?: number | null;
};

async function listMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok(), `listing matches failed: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return body.matches ?? [];
}

async function matchBySlug(request: APIRequestContext, slug: string): Promise<ListedMatch> {
  const found = (await listMatches(request)).find((m) => m.slug === slug);
  expect(found, `match ${slug} should be listed`).toBeTruthy();
  return found!;
}

async function postEvent(request: APIRequestContext, slug: string, event: ReadyUpEvent) {
  await sendReadyUpEvents(request, slug, [event]);
}

/** Ready Up's round_end; `mapNumber` is the platform's (0-based). */
function roundEnd(_match: ListedMatch, mapNumber: number, team1: number, team2: number) {
  return readyUpRoundEnd(mapNumber + 1, team1 + team2, team1, team2);
}

function mapResult(
  _match: ListedMatch,
  mapNumber: number,
  score: { team1: number; team2: number },
  series: { team1: number; team2: number },
  winner: 'team1' | 'team2'
) {
  return readyUpMapResult({
    mapNumber: mapNumber + 1,
    team1: score.team1,
    team2: score.team2,
    series: [series.team1, series.team2],
    winner,
  });
}

test.describe.serial('Match score fields', () => {
  test(
    'a live BO3 reports map rounds and maps won separately, never mixed',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo3',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'score-fields',
      });
      expect(setup).toBeTruthy();

      const match = (await listMatches(request)).find((m) => m.round === 1 && m.team1 && m.team2);
      expect(match, 'a round 1 match with both teams').toBeTruthy();
      const slug = match!.slug;

      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: setup!.servers[0].id },
      });
      expect(state.ok()).toBe(true);

      // Map 1 in progress at 8-5.
      await postEvent(request, slug, roundEnd(match!, 0, 8, 5));

      const duringMap1 = await matchBySlug(request, slug);
      expect(duringMap1.team1MapScore).toBe(8);
      expect(duringMap1.team2MapScore).toBe(5);
      expect(duringMap1.team1SeriesScore).toBe(0);
      expect(duringMap1.team2SeriesScore).toBe(0);
      // The headline score is the current map for both sides.
      expect(duringMap1.team1Score).toBe(8);
      expect(duringMap1.team2Score).toBe(5);

      // Map 1 goes to team 2. The next map has not started, so it has no score.
      await postEvent(
        request,
        slug,
        mapResult(match!, 0, { team1: 8, team2: 13 }, { team1: 0, team2: 1 }, 'team2')
      );

      await expect
        .poll(async () => (await matchBySlug(request, slug)).team2SeriesScore, {
          message: 'map 1 should count as a map won',
          timeout: 15000,
        })
        .toBe(1);

      const betweenMaps = await matchBySlug(request, slug);
      expect(betweenMaps.team1SeriesScore).toBe(0);
      expect(betweenMaps.team1MapScore, 'warmup on the next map has no score').toBe(0);
      expect(betweenMaps.team2MapScore).toBe(0);

      // Map 2 under way: 3-2 on the map, still 0-1 on maps. This is the exact
      // shape that used to render as "3 vs 1".
      await postEvent(request, slug, roundEnd(match!, 1, 3, 2));

      const duringMap2 = await matchBySlug(request, slug);
      expect(duringMap2.team1MapScore).toBe(3);
      expect(duringMap2.team2MapScore).toBe(2);
      expect(duringMap2.team1SeriesScore).toBe(0);
      expect(duringMap2.team2SeriesScore).toBe(1);
      expect(duringMap2.team1Score).toBe(duringMap2.team1MapScore);
      expect(duringMap2.team2Score).toBe(duringMap2.team2MapScore);
    }
  );

  test(
    'a completed tournament reports its champion',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'champion',
      });
      expect(setup).toBeTruthy();

      const match = (await listMatches(request)).find((m) => m.round === 1 && m.team1 && m.team2);
      expect(match).toBeTruthy();
      const slug = match!.slug;
      const winnerTeamId = match!.team2!.id;

      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: setup!.servers[0].id },
      });
      expect(state.ok()).toBe(true);

      await postEvent(
        request,
        slug,
        mapResult(match!, 0, { team1: 7, team2: 13 }, { team1: 0, team2: 1 }, 'team2')
      );
      await postEvent(request, slug, readyUpSeriesEnd({ winner: 'team2', team1: 0, team2: 1 }));

      await expect
        .poll(
          async () => {
            const res = await request.get('/api/tournament', { headers: getAuthHeader() });
            if (!res.ok()) return null;
            const body = (await res.json()) as {
              tournament?: { status?: string; winner?: { id: string } | null };
            };
            return body.tournament?.status === 'completed'
              ? (body.tournament?.winner?.id ?? null)
              : null;
          },
          { message: 'the tournament should name its champion', timeout: 20000 }
        )
        .toBe(winnerTeamId);

      // The completed match reports maps won as its headline score.
      const completed = await matchBySlug(request, slug);
      expect(completed.status).toBe('completed');
      expect(completed.team1SeriesScore).toBe(0);
      expect(completed.team2SeriesScore).toBe(1);
      // ...and keeps the rounds of its last map, instead of dropping them.
      expect(completed.team1MapScore).toBe(7);
      expect(completed.team2MapScore).toBe(13);
    }
  );
});
