import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Plugin `postgame` between maps must not end a series.
 *
 * Reproduced on real CS2 servers (MatchZy Enhanced 1.4.24): in a single
 * elimination BO3, every Round 1 match went `completed` the moment map 1
 * ended. Winner stayed null, the final never got its teams, and MAT then
 * dropped the rest of the series the server kept playing:
 *
 *   [MatchReport] Reconciled match status from plugin phase
 *     {"matchSlug":"r1m1","phase":"postgame","previousStatus":"live","newStatus":"completed"}
 *   [WEBHOOK] Event received: map_result (r1m1)
 *   [WARN] Ignoring round_started for already completed match
 *
 * The plugin reports `postgame` after every map, not just the last, and its
 * report POST lands before that map's map_result. The phase reconciler mapped
 * `postgame` straight to `completed`, skipping the series_end path that sets
 * the winner and advances the bracket.
 *
 * Payloads below are the shapes the plugin actually sends (nested team blocks,
 * `winner: { side, team }`, numeric matchid).
 *
 * @tag api
 * @tag matchzy
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  id: number;
  slug: string;
  round: number;
  status: string;
  team1?: { id: string; name: string };
  team2?: { id: string; name: string };
  winner?: { id: string };
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

/** The report MatchZy Enhanced POSTs when a map has just ended. */
async function postgameReport(
  request: APIRequestContext,
  slug: string,
  map: { name: string; index: number; total: number },
  score: { team1: number; team2: number },
  series: { team1: number; team2: number }
) {
  const res = await request.post('/api/test/match-report', {
    headers: getAuthHeader(),
    data: {
      slug,
      report: {
        match: {
          phase: 'postgame',
          map: { name: map.name, index: map.index, number: map.index + 1, total: map.total, round: 0 },
          score: { team1: score.team1, team2: score.team2, series },
        },
      },
    },
  });
  expect(res.ok(), `postgame report rejected: ${await res.text()}`).toBe(true);
}

async function postEvent(request: APIRequestContext, slug: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/events/${slug}`, { headers: SERVER_HEADERS, data });
  expect(res.ok(), `${String(data.event)} rejected: ${await res.text()}`).toBe(true);
}

/** map_result exactly as the plugin sends it. */
function mapResultPayload(
  match: ListedMatch,
  mapNumber: number,
  score: { team1: number; team2: number },
  series: { team1: number; team2: number },
  winner: 'team1' | 'team2'
) {
  return {
    event: 'map_result',
    matchid: match.id,
    map_number: mapNumber,
    winner: { side: winner === 'team1' ? '3' : '2', team: winner },
    team1: {
      series_score: series.team1,
      score: score.team1,
      score_ct: 0,
      score_t: 0,
      players: [],
      id: match.team1!.id,
      name: match.team1!.name,
    },
    team2: {
      series_score: series.team2,
      score: score.team2,
      score_ct: 0,
      score_t: 0,
      players: [],
      id: match.team2!.id,
      name: match.team2!.name,
    },
  };
}

function seriesEndPayload(
  match: ListedMatch,
  series: { team1: number; team2: number },
  winner: 'team1' | 'team2'
) {
  return {
    event: 'series_end',
    matchid: match.id,
    team1_series_score: series.team1,
    team2_series_score: series.team2,
    winner: { side: winner === 'team1' ? '3' : '2', team: winner },
    time_until_restore: 0,
  };
}

function finalHasTeam(final: ListedMatch, teamId: string): boolean {
  return final.team1?.id === teamId || final.team2?.id === teamId;
}

test.describe.serial('Plugin postgame between maps', () => {
  test(
    'BO3: postgame after map 1 keeps the series live; series_end finishes it and advances the winner',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo3',
        maps: MAPS,
        teamCount: 4,
        serverCount: 1,
        prefix: 'postgame-bo3',
      });
      expect(setup).toBeTruthy();

      const all = await listMatches(request);
      const match = all.find((m) => m.round === 1 && m.team1 && m.team2);
      const final = all.find((m) => m.round === 2);
      expect(match, 'a round 1 match with both teams').toBeTruthy();
      expect(final, 'the final').toBeTruthy();
      const slug = match!.slug;

      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: setup!.servers[0].id },
      });
      expect(state.ok()).toBe(true);

      // Map 1 ends 9-13. The report arrives first, then map_result.
      await postgameReport(request, slug, { name: 'de_mirage', index: 0, total: 3 }, { team1: 9, team2: 13 }, { team1: 0, team2: 1 });

      // The bug: this was already 'completed' here, before map_result arrived.
      expect((await matchBySlug(request, slug)).status).toBe('live');

      await postEvent(request, slug, mapResultPayload(match!, 0, { team1: 9, team2: 13 }, { team1: 0, team2: 1 }, 'team2'));

      const afterMap1 = await matchBySlug(request, slug);
      expect(afterMap1.status, 'a BO3 at 0-1 is not over').toBe('live');
      expect(afterMap1.winner).toBeFalsy();
      const finalAfterMap1 = await matchBySlug(request, final!.slug);
      expect(finalHasTeam(finalAfterMap1, match!.team1!.id)).toBe(false);
      expect(finalHasTeam(finalAfterMap1, match!.team2!.id)).toBe(false);

      // Map 2 is played and tracked (was "Ignoring round_started").
      await postEvent(request, slug, {
        event: 'round_started',
        matchid: match!.id,
        map_number: 1,
        round_number: 1,
        team1_score: 0,
        team2_score: 0,
      });
      expect((await matchBySlug(request, slug)).status).toBe('live');

      await postgameReport(request, slug, { name: 'de_inferno', index: 1, total: 3 }, { team1: 13, team2: 7 }, { team1: 1, team2: 1 });
      await postEvent(request, slug, mapResultPayload(match!, 1, { team1: 13, team2: 7 }, { team1: 1, team2: 1 }, 'team1'));
      expect((await matchBySlug(request, slug)).status).toBe('live');

      // Map 3 decides it.
      await postgameReport(request, slug, { name: 'de_ancient', index: 2, total: 3 }, { team1: 11, team2: 13 }, { team1: 1, team2: 2 });
      await postEvent(request, slug, mapResultPayload(match!, 2, { team1: 11, team2: 13 }, { team1: 1, team2: 2 }, 'team2'));
      await postEvent(request, slug, seriesEndPayload(match!, { team1: 1, team2: 2 }, 'team2'));

      await expect
        .poll(async () => (await matchBySlug(request, slug)).winner?.id, {
          message: 'series_end should set the winner',
          timeout: 15000,
        })
        .toBe(match!.team2!.id);
      expect((await matchBySlug(request, slug)).status).toBe('completed');

      await expect
        .poll(async () => finalHasTeam(await matchBySlug(request, final!.slug), match!.team2!.id), {
          message: 'the winner should advance into the final',
          timeout: 15000,
        })
        .toBe(true);

      // CONTROL: a genuinely finished match still ignores stray play events
      // and a trailing postgame report.
      await postEvent(request, slug, {
        event: 'round_started',
        matchid: match!.id,
        map_number: 2,
        round_number: 1,
      });
      await postgameReport(request, slug, { name: 'de_ancient', index: 2, total: 3 }, { team1: 11, team2: 13 }, { team1: 1, team2: 2 });
      expect((await matchBySlug(request, slug)).status).toBe('completed');
    }
  );

  test(
    'recovery: a match left completed with no series result still takes its later events',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo3',
        maps: MAPS,
        teamCount: 4,
        serverCount: 1,
        prefix: 'postgame-recover',
      });
      expect(setup).toBeTruthy();

      const all = await listMatches(request);
      const match = all.find((m) => m.round === 1 && m.team1 && m.team2);
      const final = all.find((m) => m.round === 2);
      expect(match).toBeTruthy();
      expect(final).toBeTruthy();
      const slug = match!.slug;

      // The state the old reconciler left rows in: completed, no winner, no
      // completed_at, while the server is still playing the series.
      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'completed', serverId: setup!.servers[0].id },
      });
      expect(state.ok()).toBe(true);

      await postEvent(request, slug, {
        event: 'round_started',
        matchid: match!.id,
        map_number: 1,
        round_number: 1,
        team1_score: 0,
        team2_score: 0,
      });
      expect((await matchBySlug(request, slug)).status, 'play events re-open it').toBe('live');

      await postEvent(request, slug, mapResultPayload(match!, 1, { team1: 13, team2: 4 }, { team1: 2, team2: 0 }, 'team1'));
      await postEvent(request, slug, seriesEndPayload(match!, { team1: 2, team2: 0 }, 'team1'));

      await expect
        .poll(async () => (await matchBySlug(request, slug)).winner?.id, { timeout: 15000 })
        .toBe(match!.team1!.id);
      expect((await matchBySlug(request, slug)).status).toBe('completed');
      await expect
        .poll(async () => finalHasTeam(await matchBySlug(request, final!.slug), match!.team1!.id), {
          timeout: 15000,
        })
        .toBe(true);
    }
  );

  test(
    'BO1: postgame + map_result + series_end completes normally',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'postgame-bo1',
      });
      expect(setup).toBeTruthy();

      const match = (await listMatches(request)).find((m) => m.team1 && m.team2);
      expect(match).toBeTruthy();
      const slug = match!.slug;

      const state = await request.post('/api/test/match-state', {
        headers: getAuthHeader(),
        data: { slug, status: 'live', serverId: setup!.servers[0].id },
      });
      expect(state.ok()).toBe(true);

      await postgameReport(request, slug, { name: 'de_mirage', index: 0, total: 1 }, { team1: 9, team2: 13 }, { team1: 0, team2: 1 });
      expect((await matchBySlug(request, slug)).status, 'the report alone does not finish it').toBe('live');

      await postEvent(request, slug, mapResultPayload(match!, 0, { team1: 9, team2: 13 }, { team1: 0, team2: 1 }, 'team2'));
      await postEvent(request, slug, seriesEndPayload(match!, { team1: 0, team2: 1 }, 'team2'));

      await expect
        .poll(async () => (await matchBySlug(request, slug)).winner?.id, { timeout: 15000 })
        .toBe(match!.team2!.id);
      expect((await matchBySlug(request, slug)).status).toBe('completed');
    }
  );
});
