import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The core runs a whole tournament without CS2 (3.0 phase C, PR 14).
 *
 * The test-only fake integration (api/src/integrations/fake) has no servers,
 * no veto, no live events and no stats: `allocate` assigns at once, and
 * results arrive as `NormalizedEvent[]` on
 * `POST /api/test/integration/fake/:slug/events`, straight into the core's
 * `matchLifecycle.ingest`. No MatchZy event, RCON call or server row is on the
 * path. The tournament is created, started, allocated, reported and
 * progressed through the bracket by the core alone.
 *
 * Needs the API to register the fake integration: CI sets
 * MAT_TEST_INTEGRATION=1 next to ENABLE_TEST_ENDPOINTS, and
 * `scripts/test-e2e-sharded.sh` runs NODE_ENV=test.
 *
 * @tag api
 */

const FAKE = '/api/test/integration/fake';

type ListedMatch = {
  slug: string;
  game: string;
  round: number;
  status: string;
  serverId?: string | null;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
  winner?: { id: string } | null;
};

type Side = 'team1' | 'team2';

let seq = 0;
const eventId = (slug: string, what: string) => `${slug}:${what}:${++seq}`;

async function createTeams(request: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const id = `${prefix}-${stamp}-${t}`;
    const players = Array.from({ length: 2 }, (_, p) => ({
      // Distinct 17-digit ids per team and run.
      steamId: `76561199${stamp}${t}${p}`,
      name: `${prefix} ${t}.${p}`,
    }));
    const res = await request.post('/api/teams', { data: { id, name: `${prefix} ${stamp} ${t}`, players } });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    ids.push(id);
  }
  return ids;
}

async function listMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches');
  expect(res.ok(), `listing matches: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).filter((m) => m.round >= 1);
}

async function tournament(request: APIRequestContext) {
  const res = await request.get('/api/tournament');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as {
    tournament?: { status?: string; game?: string; winner?: { id: string } | null };
  }).tournament;
}

async function createFakeTournament(
  request: APIRequestContext,
  data: { name: string; type: string; format: string; teamIds: string[] }
) {
  const res = await request.post(`${FAKE}/tournament`, { data });
  expect(
    res.status(),
    `the fake integration should be registered (MAT_TEST_INTEGRATION=1): ${await res.text()}`
  ).toBe(200);
  const body = (await res.json()) as { tournament: { game: string; status: string } };
  expect(body.tournament.game).toBe('fake');
  expect(body.tournament.status).toBe('setup');
}

async function start(request: APIRequestContext) {
  const res = await request.post('/api/tournament/start', { data: {} });
  expect(res.ok(), `starting: ${await res.text()}`).toBe(true);
}

async function postEvents(request: APIRequestContext, slug: string, events: unknown[]) {
  const res = await request.post(`${FAKE}/${slug}/events`, { data: events });
  expect(res.status(), `events for ${slug}: ${await res.text()}`).toBe(200);
}

/** Play a series to a `winner` sweep: one map.result per map, then series.ended. */
async function playSeries(request: APIRequestContext, match: ListedMatch, games: number, winner: Side) {
  const slug = match.slug;
  const events: unknown[] = [
    { type: 'series.started', slug, eventId: eventId(slug, 'start'), seriesLength: games },
  ];
  const wins = Math.ceil(games / 2);
  for (let map = 0; map < wins; map++) {
    const series = map + 1;
    events.push({
      type: 'map.result',
      slug,
      eventId: eventId(slug, `map${map}`),
      mapNumber: map,
      team1Score: winner === 'team1' ? 13 : 7,
      team2Score: winner === 'team2' ? 13 : 7,
      winner,
      seriesScore: { team1: winner === 'team1' ? series : 0, team2: winner === 'team2' ? series : 0 },
    });
  }
  events.push({
    type: 'series.ended',
    slug,
    eventId: eventId(slug, 'end'),
    team1SeriesScore: winner === 'team1' ? wins : 0,
    team2SeriesScore: winner === 'team2' ? wins : 0,
    winner,
  });
  await postEvents(request, slug, events);
}

/** Wait until the round's playable matches are all loaded, and return them. */
async function waitForLoadedRound(request: APIRequestContext, round: number, count: number) {
  let loaded: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        loaded = (await listMatches(request)).filter(
          (m) => m.round === round && m.team1 && m.team2 && m.status === 'loaded'
        );
        return loaded.length;
      },
      { message: `round ${round} should be allocated`, timeout: 20_000 }
    )
    .toBe(count);
  return loaded;
}

async function waitForCompletion(request: APIRequestContext) {
  await expect
    .poll(async () => (await tournament(request))?.status, {
      message: 'the tournament should complete',
      timeout: 20_000,
    })
    .toBe('completed');
  return tournament(request);
}

test.describe.serial('Fake integration: a tournament without CS2', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    // The fake game has no servers, so it needs no webhook URL to start
    // (`tournament-start-webhook.spec.ts` proves that). This only puts the
    // suite's default back, and turns simulation off.
    await request.put('/api/settings', { data: { webhookUrl: 'http://localhost:3069', simulateMatches: false } });
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test(
    'single elimination BO3: create, start, allocate, report, progress, finish',
    { tag: ['@api'] },
    async ({ request }) => {
      const teamIds = await createTeams(request, 'fake-se', 4);
      await createFakeTournament(request, {
        name: 'Fake single elim',
        type: 'single_elimination',
        format: 'bo3',
        teamIds,
      });

      // Every match belongs to the fake game; with no veto, round 1 is ready
      // straight away (a CS2 BO3 would wait for the veto).
      const created = await listMatches(request);
      expect(created).toHaveLength(3);
      expect(created.every((m) => m.game === 'fake')).toBe(true);
      expect(created.filter((m) => m.round === 1).map((m) => m.status)).toEqual(['ready', 'ready']);

      await start(request);

      // Allocation: assigned at once, no server involved.
      const round1 = await waitForLoadedRound(request, 1, 2);
      expect(round1.every((m) => !m.serverId)).toBe(true);
      expect((await tournament(request))?.status).toBe('in_progress');

      await playSeries(request, round1[0], 3, 'team1');
      await playSeries(request, round1[1], 3, 'team2');
      const winners = [round1[0].team1!.id, round1[1].team2!.id];

      // Bracket progression: both winners meet in the final, which the core
      // readies and allocates by itself.
      const [final] = await waitForLoadedRound(request, 2, 1);
      expect([final.team1!.id, final.team2!.id].sort()).toEqual([...winners].sort());

      // Reporting the same result again changes nothing.
      await playSeries(request, round1[0], 3, 'team1');

      await playSeries(request, final, 3, 'team2');
      const done = await waitForCompletion(request);
      expect(done?.game).toBe('fake');
      expect(done?.winner?.id).toBe(final.team2!.id);

      const matches = await listMatches(request);
      expect(matches.every((m) => m.status === 'completed')).toBe(true);
      const r1m1 = matches.find((m) => m.slug === round1[0].slug)!;
      expect(r1m1.winner?.id).toBe(round1[0].team1!.id);

      // Map results went through the core too: two maps for the final.
      const detail = await request.get(`/api/matches/${final.slug}`);
      expect(detail.ok()).toBe(true);
      const body = (await detail.json()) as { match?: { mapResults?: unknown[] } };
      expect(body.match?.mapResults).toHaveLength(2);
    }
  );

  test('swiss BO1: rounds are paired and allocated until a champion', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'fake-sw', 4);
    await createFakeTournament(request, { name: 'Fake swiss', type: 'swiss', format: 'bo1', teamIds });
    await start(request);

    for (const round of [1, 2]) {
      const matches = await waitForLoadedRound(request, round, 2);
      expect(matches.every((m) => m.game === 'fake')).toBe(true);
      for (const match of matches) {
        await playSeries(request, match, 1, match.team1!.id < match.team2!.id ? 'team1' : 'team2');
      }
    }

    const done = await waitForCompletion(request);
    expect(done?.winner?.id).toBeTruthy();
  });

  /**
   * Round robin used to stall on a game with no veto (the gap PR #295 left
   * open). The generator knows every pairing up front and holds everything
   * past round 1 as `pending` for the map veto; CS2 opens those rounds by
   * vetoing them, and a game without a pre-match phase had nothing that did.
   * Round 1 played out and rounds 2 and 3 stayed `pending` for ever.
   *
   * Now the finished round opens the next one, the way Swiss pairs its next
   * round and the elimination brackets ready the match a winner advances into.
   */
  test('round robin: each finished round opens the next one, up to a champion', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'fake-rr', 4);
    await createFakeTournament(request, {
      name: 'Fake round robin',
      type: 'round_robin',
      format: 'bo1',
      teamIds,
    });

    // 4 teams: 3 rounds of 2, every pairing seeded from the start. Round 1 is
    // ready without a veto; the later rounds wait their turn.
    const created = await listMatches(request);
    expect(created).toHaveLength(6);
    expect(created.filter((m) => m.round === 1).map((m) => m.status)).toEqual(['ready', 'ready']);
    expect(created.filter((m) => m.round > 1).every((m) => m.status === 'pending')).toBe(true);
    expect(created.filter((m) => m.round > 1).every((m) => m.team1 && m.team2)).toBe(true);

    await start(request);

    const round1 = await waitForLoadedRound(request, 1, 2);

    // Half a round is not a round: the next one stays shut.
    await playSeries(request, round1[0], 1, 'team1');
    expect(
      (await listMatches(request)).filter((m) => m.round === 2).every((m) => m.status === 'pending'),
      'round 2 waits for the whole of round 1'
    ).toBe(true);
    await playSeries(request, round1[1], 1, 'team1');

    // Rounds 2 and 3 open on their own, one at a time.
    for (const round of [2, 3]) {
      const matches = await waitForLoadedRound(request, round, 2);
      expect(matches.every((m) => !m.serverId)).toBe(true);
      const later = (await listMatches(request)).filter((m) => m.round > round);
      expect(later.every((m) => m.status === 'pending'), `round ${round + 1} is not open yet`).toBe(true);
      for (const match of matches) await playSeries(request, match, 1, 'team1');
    }

    const done = await waitForCompletion(request);
    expect(done?.winner?.id, 'a round robin ends with a champion').toBeTruthy();
    expect((await listMatches(request)).every((m) => m.status === 'completed')).toBe(true);

    // The standings are the core's, computed over all 6 completed matches.
    const bracket = await request.get('/api/tournament/bracket');
    expect(bracket.ok()).toBe(true);
    const standings = ((await bracket.json()) as {
      roundRobinStandings?: Array<{ teamId: string; wins: number; losses: number }>;
    }).roundRobinStandings;
    expect(standings).toHaveLength(4);
    expect(standings!.reduce((sum, s) => sum + s.wins, 0)).toBe(6);
  });

  test('the event route checks its input and only drives the fake game', { tag: ['@api'] }, async ({ request }) => {
    expect((await request.post(`${FAKE}/r1m1/events`, { data: { type: 'map.result' } })).status()).toBe(400);
    expect(
      (await request.post(`${FAKE}/r1m1/events`, { data: [{ type: 'map_result', slug: 'r1m1', eventId: 'x' }] })).status()
    ).toBe(400);
    expect(
      (await request.post(`${FAKE}/r1m1/events`, { data: [{ type: 'series.ended', slug: 'other', eventId: 'x' }] })).status()
    ).toBe(400);
    expect(
      (await request.post(`${FAKE}/no-such-match/events`, {
        data: [{ type: 'phase.changed', slug: 'no-such-match', eventId: 'x', phase: 'warmup' }],
      })).status()
    ).toBe(404);

    // A CS2 match is refused, whatever the events say.
    const [a, b] = await createTeams(request, 'fake-cs2', 2);
    const created = await request.post('/api/tournament', {
      data: {
        name: 'CS2 tournament',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_nuke'],
        teamIds: [a, b],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const cs2Match = (await listMatches(request))[0];
    expect(cs2Match.game).toBe('cs2');
    const refused = await request.post(`${FAKE}/${cs2Match.slug}/events`, {
      data: [{ type: 'series.ended', slug: cs2Match.slug, eventId: 'x', team1SeriesScore: 1, team2SeriesScore: 0, winner: 'team1' }],
    });
    expect(refused.status()).toBe(409);
  });

  /**
   * The public create route takes a `game` from 3.0 phase D (PR D9), but only
   * one this instance has a catalogue row for. The fake module deliberately
   * has none (`catalog: null`), which makes it the one game name that is
   * guaranteed to be unknown however many modules are installed — so this is
   * also the check that `runsAnyCatalogGame` does not quietly accept a typo.
   *
   * Before D9 the route ignored `game` entirely and made a CS2 tournament
   * whatever was asked for; silently running the wrong game is the worse of
   * the two answers, so it is a 400 now.
   */
  test('the public create route refuses a game this instance does not have', { tag: ['@api'] }, async ({ request }) => {
    const [a, b] = await createTeams(request, 'fake-pub', 2);
    const refused = await request.post('/api/tournament', {
      data: {
        name: 'Asks for fake',
        type: 'single_elimination',
        format: 'bo1',
        game: 'fake',
        maps: ['de_mirage', 'de_inferno', 'de_nuke'],
        teamIds: [a, b],
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain('fake');

    // With no `game` at all it is a CS2 tournament, as it has always been.
    const res = await request.post('/api/tournament', {
      data: {
        name: 'Asks for nothing',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno', 'de_nuke'],
        teamIds: [a, b],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    expect(((await res.json()) as { tournament: { game: string } }).tournament.game).toBe('cs2');
    // CS2 BO1 round 1 waits for the veto, as before.
    expect((await listMatches(request)).map((m) => [m.game, m.status])).toEqual([['cs2', 'pending']]);
  });
});
