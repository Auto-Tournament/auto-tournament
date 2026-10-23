import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEFAULT_ADMIN_STEAM_ID, getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTeam, type Team } from '../helpers/teams';
import { deleteServer } from '../helpers/servers';
import { createReadyUpServer, sendReadyUpEvents, type ReadyUpEvent } from '../helpers/readyUp';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import { executeVetoActions, getCSMajorBO3Actions } from '../helpers/veto';
import { expectGolden, getOk, normalizeForGolden, resetDatabaseForGolden } from '../helpers/golden';

/**
 * Golden replay of a full Ready Up BO3 event sequence.
 *
 * Characterization test: it plays tests/fixtures/readyup-bo3-sequence.json (a
 * Bo3 as Ready Up sends it: per map the phase going live, round ends,
 * halftime and map_result with the player stats, then series_end) against a
 * real match created through veto, through the same `processInbound` a
 * connected server's messages take, then records what the app shows afterwards
 * through its own API.
 *
 * Two goldens:
 * - `event-replay-config.json` — the `match.assign` config Ready Up would get
 *   right after veto (before any event), without its per-assignment password.
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

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/readyup-bo3-sequence.json');

interface FixtureTeam {
  id: string;
  name: string;
  players: Array<{ steamId: string; name: string }>;
}

interface Fixture {
  teams: { team1: FixtureTeam; team2: FixtureTeam };
  maps: string[];
  events: ReadyUpEvent[];
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

const COMMON_REPLACE = {
  [DEFAULT_ADMIN_STEAM_ID]: '<test-admin-steam-id>',
};

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
}

interface MatchListRow {
  id: number;
  slug: string;
}

/** The `match.assign` config Ready Up would get for the match now (no password). */
async function fetchAssignConfig(request: APIRequestContext, match: MatchListRow) {
  const res = await request.get(`/api/test/fleet/assign-config/${match.slug}`, {
    headers: getAuthHeader(),
  });
  expect(res.ok(), `config for ${match.slug}: ${res.status()} ${await res.text()}`).toBe(true);
  const { config } = (await res.json()) as { config: Record<string, unknown> };
  // The match's database id changes with every run.
  return typeof config.id === 'number' ? { ...config, id: '<match-db-id>' } : config;
}

test.describe.serial('Golden Ready Up BO3 event replay', () => {
  const fixture = loadFixture();
  let team1: Team;
  let team2: Team;
  let matchSlug: string;
  let serverId: string;
  let fleetId: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await resetDatabaseForGolden(request);

      const createdTeam1 = await createTeam(request, fixture.teams.team1);
      const createdTeam2 = await createTeam(request, fixture.teams.team2);
      expect(createdTeam1, 'team1 should be created').toBeTruthy();
      expect(createdTeam2, 'team2 should be created').toBeTruthy();
      team1 = createdTeam1!;
      team2 = createdTeam2!;

      const server = await createReadyUpServer(request, 'golden-replay');
      serverId = server.id;
      fleetId = server.fleetId;

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
    } finally {
      await request.dispose();
    }
  });

  test.beforeEach(async ({ request }) => {
    // The reset in beforeAll ran on another context; sign this one in.
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      expect(await signInViaRequest(request)).toBe(true);
      if (serverId) await deleteServer(request, serverId);
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

      // 2. Snapshot the config Ready Up would be assigned right after veto,
      //    before any event lands.
      const configAfterVeto = await fetchAssignConfig(request, { id: 0, slug: matchSlug });
      expectGolden(
        'event-replay-config',
        normalizeForGolden(configAfterVeto, { replace: COMMON_REPLACE })
      );

      // 3. Replay the fixture's events against the real match, as they come
      //    from Ready Up on the fleet link.
      await sendReadyUpEvents(request, matchSlug, fixture.events, fleetId);

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
