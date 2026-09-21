import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEFAULT_ADMIN_STEAM_ID, getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTeam, type Team } from '../helpers/teams';
import { createServer, deleteServer, FAKE_SERVER_HOST } from '../helpers/servers';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getCSMajorBO3Actions } from '../helpers/veto';
import { expectGolden, getOk, normalizeForGolden, resetDatabaseForGolden } from '../helpers/golden';

/**
 * Golden replay of a full MatchZy BO3 event sequence.
 *
 * Characterization test: it plays tests/fixtures/matchzy-bo3-sequence.json (a
 * captured Bo3 - series_start, going_live/round_end/halftime/side_swap/
 * map_result per map, series_end) against a real match created through veto,
 * then records what the app shows afterwards through its own API. It is the
 * safety net for moving CS2 event handling behind the game-module interface:
 * the served config and the post-match state must stay identical through that
 * refactor.
 *
 * Two goldens:
 * - `event-replay-config.json` — the config MatchZy would load, served right
 *   after veto (before any event is posted). This is the same served-config
 *   shape as golden-match-config.spec.ts, but for a match that then actually
 *   gets played out.
 * - `event-replay-result.json` — match + map results (GET /api/matches/:slug),
 *   plus each of the 10 players' summary and rating history, all read back
 *   through the public API (never straight from Postgres) after the replay
 *   completes.
 *
 * Update the goldens (then review the diff and explain it in the PR):
 *
 *   UPDATE_GOLDEN=1 yarn test:manual tests/api/event-replay-golden.spec.ts
 *
 * Determinism:
 * - the spec resets the database first (see resetDatabaseForGolden), so
 *   settings, the admin list and auto-increment ids do not depend on earlier
 *   specs on the shard;
 * - teams, the server and the veto sequence are fixed (getCSMajorBO3Actions
 *   with the fixture's teams always removes/picks the same maps in the same
 *   order: de_ancient, de_anubis, de_nuke — matching the fixture's `maps`);
 * - the numeric `matchid` the fixture's events carry as `{{matchid}}` is
 *   substituted with the real matches-row id, then written as `<matchid>`;
 * - the rest goes through normalizeForGolden (tests/helpers/golden.ts).
 *
 * @tag api
 * @tag golden
 */

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/matchzy-bo3-sequence.json');

interface FixtureTeam {
  id: string;
  name: string;
  players: Array<{ steamId: string; name: string }>;
}

interface Fixture {
  teams: { team1: FixtureTeam; team2: FixtureTeam };
  maps: string[];
  events: unknown[];
}

/** The 7-map pool `getCSMajorBO3Actions` vetoes down to the fixture's 3 maps. */
const VETO_MAP_POOL = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
];

const SERVER_ID = 'golden-replay-server';
const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

const COMMON_REPLACE = {
  [DEFAULT_ADMIN_STEAM_ID]: '<test-admin-steam-id>',
};

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
}

/** Deep-replace every `"{{matchid}}"` string with the real numeric matchid. */
function withMatchId(node: unknown, matchId: number): unknown {
  if (node === '{{matchid}}') return matchId;
  if (Array.isArray(node)) return node.map((item) => withMatchId(item, matchId));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = withMatchId(value, matchId);
    }
    return out;
  }
  return node;
}

interface MatchListRow {
  id: number;
  slug: string;
}

async function fetchServedConfig(request: APIRequestContext, match: MatchListRow) {
  // No auth header: the plugin fetches this URL anonymously.
  const res = await request.get(`/api/matches/${match.slug}.json`);
  expect(res.ok(), `config for ${match.slug}: ${res.status()} ${await res.text()}`).toBe(true);
  const config = (await res.json()) as Record<string, unknown> & { matchid?: number };
  expect(config.matchid, `${match.slug}: matchid is the matches row id`).toBe(match.id);
  return { ...config, matchid: '<matchid>' as unknown as number };
}

test.describe.serial('Golden MatchZy BO3 event replay', () => {
  const fixture = loadFixture();
  let team1: Team;
  let team2: Team;
  let matchSlug: string;
  let matchId: number;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await resetDatabaseForGolden(request);

      // Manual matches (and tournament start) refuse to run without a webhook URL.
      const webhookSet = await request.put('/api/settings', {
        headers: getAuthHeader(),
        data: { webhookUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069' },
      });
      expect(webhookSet.ok()).toBe(true);

      const createdTeam1 = await createTeam(request, fixture.teams.team1);
      const createdTeam2 = await createTeam(request, fixture.teams.team2);
      expect(createdTeam1, 'team1 should be created').toBeTruthy();
      expect(createdTeam2, 'team2 should be created').toBeTruthy();
      team1 = createdTeam1!;
      team2 = createdTeam2!;

      const server = await createServer(request, {
        id: SERVER_ID,
        name: 'Golden Replay Server',
        host: FAKE_SERVER_HOST,
        port: 27099,
        password: 'testpassword123',
        enabled: true,
      });
      expect(server, 'server should be created').toBeTruthy();

      const tournament = await createAndStartTournament(request, {
        name: 'Golden Replay Tournament',
        type: 'single_elimination',
        format: 'bo3',
        maps: VETO_MAP_POOL,
        teamIds: [team1.id, team2.id],
        settings: { seedingMethod: 'manual' },
      });
      expect(tournament, 'tournament should be created and started').toBeTruthy();

      let match: MatchListRow | null = null;
      await expect
        .poll(
          async () => {
            match = (await findMatchByTeams(request, team1.id, team2.id)) as MatchListRow | null;
            return match !== null;
          },
          {
            message: 'match to be created after tournament start',
            timeout: 10_000,
            intervals: [250, 500],
          }
        )
        .toBe(true);
      expect(match).toBeTruthy();
      matchSlug = match!.slug;
      matchId = match!.id;
    } finally {
      await request.dispose();
    }
  });

  test.beforeEach(async ({ request }) => {
    // The reset in beforeAll ran on another context; sign this one in.
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ playwright }) => {
    // ensureServers() (tests/helpers/tournamentSetup.ts) reuses any enabled
    // server on FAKE_SERVER_HOST it finds, from any spec. Left enabled, this
    // one gets adopted by later specs that expect a fresh server (and its
    // in-memory turnover-tracker state, e.g. seriesEndedAt from this replay,
    // leaks with it) — see tests/api/server-turnover.spec.ts.
    const request = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      expect(await signInViaRequest(request)).toBe(true);
      await deleteServer(request, SERVER_ID);
    } finally {
      await request.dispose();
    }
  });

  test(
    'veto, served config and full replay through the API',
    { tag: ['@api', '@golden'] },
    async ({ request }) => {
      // 1. Run the CS Major BO3 veto. With this fixture's two teams it always
      //    removes/picks de_mirage, de_inferno, de_ancient, de_anubis, de_dust2,
      //    de_vertigo, leaving de_nuke — i.e. exactly the fixture's three maps
      //    in the fixture's order (de_ancient, de_anubis, de_nuke).
      const vetoActions = getCSMajorBO3Actions(team1, team2);
      const vetoResult = await executeVetoActions(request, matchSlug, vetoActions);
      expect(vetoResult, 'veto should complete').toBeTruthy();

      // 2. Snapshot the served config right after veto, before any event lands.
      const configAfterVeto = await fetchServedConfig(request, { id: matchId, slug: matchSlug });
      expectGolden(
        'event-replay-config',
        normalizeForGolden(configAfterVeto, { replace: COMMON_REPLACE })
      );

      // 3. Replay the fixture's events against the real match.
      const events = withMatchId(fixture.events, matchId) as Array<Record<string, unknown>>;
      for (const event of events) {
        const res = await request.post(`/api/events?server_id=${SERVER_ID}`, {
          headers: SERVER_HEADERS,
          data: event,
        });
        expect(res.ok(), `${String(event.event)} rejected: ${await res.text()}`).toBe(true);

        // enrichMatchWithScores (api/src/utils/matchEnrichment.ts) reads the
        // *latest* round_end/series_end row from match_events, ordered by
        // received_at — a column with one-second resolution. A real MatchZy
        // server paces these minutes apart; this replay fires them back to
        // back, and two round_end (or the final round_end and series_end)
        // landing in the same wall-clock second makes that ORDER BY tie and
        // resolve arbitrarily, occasionally reporting a stale series score.
        // A short pause after each of those two event types keeps every one
        // of them in its own second so the query is never ambiguous.
        if (event.event === 'round_end' || event.event === 'series_end') {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      }

      // 4. Wait for the series to be recorded as completed with its final
      //    score. Processing the last event is not synchronous with the HTTP
      //    response above, so poll for the actual final state (known from the
      //    fixture: Alpha 2-1 Bravo, 3 map results) rather than a proxy like
      //    `status` alone, so nothing is snapshotted mid-write.
      await expect
        .poll(
          async () => {
            const match = await getOk<{
              match: {
                status: string;
                mapResults?: unknown[];
                team1SeriesScore?: number;
                team2SeriesScore?: number;
              };
            }>(request, `/api/matches/${matchSlug}`);
            return {
              status: match.match.status,
              mapResultCount: match.match.mapResults?.length ?? 0,
              team1SeriesScore: match.match.team1SeriesScore,
              team2SeriesScore: match.match.team2SeriesScore,
            };
          },
          {
            message: 'match should settle at status=completed, 3 map results, series score 2-1',
            timeout: 15_000,
            intervals: [250, 500],
          }
        )
        .toEqual({
          status: 'completed',
          mapResultCount: 3,
          team1SeriesScore: 2,
          team2SeriesScore: 1,
        });

      const allSteamIds = [...team1.players, ...team2.players].map((p) => p.steamId).sort();
      await expect
        .poll(
          async () => {
            const history = await getOk<{ history: unknown[] }>(
              request,
              `/api/players/${allSteamIds[0]}/rating-history`
            );
            return history.history.length;
          },
          {
            message: 'rating history should exist for a player after the series',
            timeout: 15_000,
            intervals: [250, 500],
          }
        )
        .toBeGreaterThan(0);

      // 5. Snapshot the post-replay state entirely through the public API.
      const matchAfter = await getOk<{
        match: { id: number; config?: { matchid?: number } } & Record<string, unknown>;
      }>(request, `/api/matches/${matchSlug}`);
      expect(matchAfter.match.id, 'matches row id should still be the match created above').toBe(
        matchId
      );
      if (matchAfter.match.config) {
        expect(matchAfter.match.config.matchid, 'served config matchid should match too').toBe(
          matchId
        );
      }

      const players: Record<string, { summary: unknown; ratingHistory: unknown }> = {};
      for (const steamId of allSteamIds) {
        const summary = await getOk(request, `/api/players/${steamId}/summary`);
        const ratingHistory = await getOk<{ history: unknown }>(
          request,
          `/api/players/${steamId}/rating-history`
        );
        players[steamId] = { summary, ratingHistory: ratingHistory.history };
      }

      const matchForGolden = {
        ...matchAfter.match,
        id: '<matchid>',
        ...(matchAfter.match.config
          ? { config: { ...matchAfter.match.config, matchid: '<matchid>' } }
          : {}),
      };

      expectGolden(
        'event-replay-result',
        normalizeForGolden({ match: matchForGolden, players }, { replace: COMMON_REPLACE })
      );
    }
  );
});
