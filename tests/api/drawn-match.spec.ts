import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext, configureWebhook } from '../helpers/setup';
import { createTestTeams } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * A drawn deciding map with overtime disabled must finish the series.
 *
 * With overtime off, MatchZy can let regulation end level and then simply
 * restore the server after a delay, without ever emitting `series_end`. MAT
 * used to sit on that: the match stayed `live`, and the server reset wiped the
 * live stats out from under it — reported as "the match just stays on status
 * live, and after around 2min all stats on the website get reset and the
 * server goes back to warmup".
 *
 * `handleMapResult` covers this with a five-term condition (not finished, final
 * map, level scores, overtime disabled, segments allow draws). Nothing pinned
 * it, so any one of those terms could quietly stop being true.
 *
 * Deliberately a BO3 gone to a level decider, not a BO1. A BO1 completes
 * through a separate "the only map_result is definitive" path, so a BO1 test
 * passes with the draw handling removed entirely — it proves nothing.
 *
 * @tag api
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

/** Create and start a BO1 tournament with overtime explicitly disabled. */
async function startTournamentWithoutOvertime(
  request: APIRequestContext,
  teams: Team[],
  overtimeSegments?: number
) {
  await request.delete('/api/tournament');
  const created = await request.post('/api/tournament', {
    data: {
      name: `Draw Test ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamIds: teams.map((t) => t.id),
      overtimeMode: 'disabled',
      ...(overtimeSegments === undefined ? {} : { overtimeSegments }),
    },
  });
  expect(created.ok(), `tournament create failed: ${await created.text()}`).toBe(true);

  // Bracket generation is async; the helper waits before starting too.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const started = await request.post('/api/tournament/start', { data: {} });
  expect(started.ok(), `tournament start failed: ${await started.text()}`).toBe(true);
}

test.describe.serial('Drawn match with overtime disabled', () => {
  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const teams = await createTestTeams(request, 'draw');
    expect(teams).toBeTruthy();
    [team1, team2] = teams!;
    expect(await createTestServer(request, 'draw')).toBeTruthy();
  });

  test(
    'a level decider completes the series instead of leaving it live',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await startTournamentWithoutOvertime(request, [team1, team2]);

      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.slug).toBeTruthy();
      const slug = match!.slug;

      const mapResult = async (
        mapNumber: number,
        mapName: string,
        t1: number,
        t2: number,
        winner: string
      ) => {
        const res = await request.post(`/api/events/${slug}`, {
          headers: HEADERS,
          data: {
            event: 'map_result',
            matchid: slug,
            map_number: mapNumber,
            map_name: mapName,
            team1_score: t1,
            team2_score: t2,
            winner: { team: winner },
          },
        });
        expect(res.ok(), `map_result ${mapNumber} rejected: ${await res.text()}`).toBe(true);
      };

      // One map each, so the series is level and unfinished going into map 3.
      await mapResult(0, 'de_mirage', 13, 8, 'team1');
      await mapResult(1, 'de_inferno', 7, 13, 'team2');

      // The decider ends level with no winner, and no series_end follows.
      await mapResult(2, 'de_ancient', 15, 15, 'none');

      // Left on 'live', the server reset two minutes later takes the stats with
      // it — which is what users actually saw.
      await expect
        .poll(
          async () => {
            const found = await findMatchByTeams(request, team1.id, team2.id);
            return found?.status;
          },
          { timeout: 15000, message: 'a drawn decider should complete the series' }
        )
        .toBe('completed');
    }
  );
});
