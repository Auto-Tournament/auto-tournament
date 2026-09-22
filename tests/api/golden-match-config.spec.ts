import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, DEFAULT_ADMIN_STEAM_ID, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import {
  expectGolden,
  getOk,
  normalizeForGolden,
  postOk,
  resetDatabaseForGolden,
} from '../helpers/golden';

/**
 * Golden MatchZy match configs, one file per format.
 *
 * Characterization test: it records the JSON that GET /api/matches/:slug.json
 * serves today (the URL the MatchZy plugin loads a match from) and fails when
 * any of it changes. It is the safety net for moving config building out of
 * the bracket generators and behind the CS2 game module; the served config
 * must stay identical through that refactor.
 *
 * Update the goldens (then review the diff and explain it in the PR):
 *
 *   UPDATE_GOLDEN=1 yarn test:manual tests/api/golden-match-config.spec.ts
 *
 * Goldens: tests/fixtures/golden/match-config-<format>.json
 *
 * Determinism:
 * - the spec resets the database first, so settings (cvars), the admin list
 *   and ids do not depend on earlier specs on the shard;
 * - teams, players and slugs use fixed ids; Swiss uses manual seeding (no
 *   shuffle);
 * - `matchid` is the matches row id; it is checked against the row and then
 *   written as `<matchid>`;
 * - shuffle teams are generated: their ids, names and the balanced rosters are
 *   replaced by placeholders and sorted player lists, and the random starting
 *   side is checked to be one of the two valid values and then written as
 *   `<random-side>`;
 * - the rest goes through normalizeForGolden (tests/helpers/golden.ts).
 *
 * This spec does not play any match, so it says nothing about round robin
 * completion (being changed separately).
 *
 * @tag api
 * @tag golden
 */

const MAPS = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_vertigo'];

/** 17-digit Steam64-shaped ids so the config builder treats them as Steam IDs. */
const steamId = (team: number, player: number) =>
  `7656119900000${String(team).padStart(2, '0')}${String(player).padStart(2, '0')}`;

const TEAMS = Array.from({ length: 4 }, (_, i) => ({
  id: `golden-team-${i + 1}`,
  name: `Golden Team ${i + 1}`,
  // One team has a tag; the others get the tag the builder derives from the name.
  ...(i === 0 ? { tag: 'GLD1' } : {}),
  players: Array.from({ length: 5 }, (_, p) => ({
    steamId: steamId(i + 1, p + 1),
    name: `Golden ${i + 1}.${p + 1}`,
  })),
}));

interface MatchListRow {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  bracket?: string;
}

type Config = Record<string, unknown> & {
  matchid?: number;
  map_sides?: string[];
  team1?: { id?: string; name?: string; tag?: string; players?: Record<string, string> };
  team2?: { id?: string; name?: string; tag?: string; players?: Record<string, string> };
};

/** Placeholders shared by every format. */
const COMMON_REPLACE = {
  [DEFAULT_ADMIN_STEAM_ID]: '<test-admin-steam-id>',
};

/**
 * A cookie-less context, as the game server is: the config is fetched with the
 * header MAT puts on the load command, not an admin session.
 */
let serverContext: APIRequestContext;

async function fetchServedConfig(match: MatchListRow): Promise<Config> {
  const res = await serverContext.get(`/api/matches/${match.slug}.json`, {
    headers: { 'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123' },
  });
  expect(res.ok(), `config for ${match.slug}: ${res.status()} ${await res.text()}`).toBe(true);
  const config = (await res.json()) as Config;
  expect(config.matchid, `${match.slug}: matchid is the matches row id`).toBe(match.id);
  return { ...config, matchid: '<matchid>' as unknown as number };
}

async function tournamentMatches(request: APIRequestContext): Promise<MatchListRow[]> {
  const body = await getOk<{ matches: MatchListRow[] }>(request, '/api/matches');
  return body.matches
    .filter((m) => m.round > 0)
    .sort((a, b) => a.round - b.round || a.matchNumber - b.matchNumber || a.slug.localeCompare(b.slug));
}

async function createTournament(
  request: APIRequestContext,
  input: Record<string, unknown>
): Promise<void> {
  await request.delete('/api/tournament', { headers: getAuthHeader() });
  await postOk(request, '/api/tournament', input);
}

/** Snapshot every bracket match's served config for the current tournament. */
async function snapshotTournament(request: APIRequestContext, name: string): Promise<void> {
  const matches = await tournamentMatches(request);
  expect(matches.length, `${name}: tournament should have matches`).toBeGreaterThan(0);

  const snapshot = [];
  for (const match of matches) {
    snapshot.push({
      slug: match.slug,
      round: match.round,
      matchNumber: match.matchNumber,
      bracket: match.bracket ?? null,
      config: await fetchServedConfig(match),
    });
  }
  expectGolden(`match-config-${name}`, normalizeForGolden(snapshot, { replace: COMMON_REPLACE }));
}

test.describe.serial('Golden MatchZy match configs', () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await resetDatabaseForGolden(request);
      // Manual matches refuse to be created without a webhook URL.
      expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
      for (const team of TEAMS) {
        await postOk(request, '/api/teams', team);
      }
    } finally {
      await request.dispose();
    }
    serverContext = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
  });

  test.afterAll(async () => {
    await serverContext?.dispose();
  });

  test.beforeEach(async ({ request }) => {
    // The reset in beforeAll ran on another context; sign this one in.
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('single elimination (Bo3, 4 teams)', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await createTournament(request, {
      name: 'Golden Single Elimination',
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamIds: TEAMS.map((t) => t.id),
      settings: { seedingMethod: 'manual' },
    });
    await snapshotTournament(request, 'single-elimination');
  });

  test('double elimination (Bo1, 4 teams)', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await createTournament(request, {
      name: 'Golden Double Elimination',
      type: 'double_elimination',
      format: 'bo1',
      maps: MAPS,
      teamIds: TEAMS.map((t) => t.id),
      settings: { seedingMethod: 'manual' },
    });
    await snapshotTournament(request, 'double-elimination');
  });

  test('round robin (Bo1, 4 teams)', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await createTournament(request, {
      name: 'Golden Round Robin',
      type: 'round_robin',
      format: 'bo1',
      maps: MAPS,
      teamIds: TEAMS.map((t) => t.id),
      maxRounds: 12,
      overtimeMode: 'disabled',
      settings: { seedingMethod: 'manual' },
    });
    await snapshotTournament(request, 'round-robin');
  });

  test('swiss (Bo1, 4 teams, manual seeding)', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await createTournament(request, {
      name: 'Golden Swiss',
      type: 'swiss',
      format: 'bo1',
      maps: MAPS,
      teamIds: TEAMS.map((t) => t.id),
      // 'random' would shuffle round-1 pairings (Math.random); manual keeps seed order.
      settings: { seedingMethod: 'manual' },
    });
    await snapshotTournament(request, 'swiss');
  });

  test('shuffle (round 1, 10 players)', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await request.delete('/api/tournament', { headers: getAuthHeader() });

    const players = Array.from({ length: 10 }, (_, i) => ({
      id: steamId(50, i + 1),
      name: `Shuffle Player ${i + 1}`,
      // Distinct ratings so team balancing has one best answer.
      elo: 1000 + i * 100,
    }));
    await postOk(request, '/api/players/bulk-import', players);

    await postOk(request, '/api/tournament/shuffle', {
      name: 'Golden Shuffle',
      mapSequence: ['de_mirage', 'de_inferno', 'de_ancient'],
      maxRounds: 16,
      overtimeMode: 'disabled',
      teamSize: 5,
    });
    await postOk(request, '/api/tournament/1/register-players', {
      playerIds: players.map((p) => p.id),
    });
    await postOk(request, '/api/tournament/1/generate-round', { roundNumber: 1 });

    const matches = await tournamentMatches(request);
    expect(matches.length).toBe(1);

    const snapshot = [];
    for (const match of matches) {
      const config = await fetchServedConfig(match);

      // Random per match (Math.random in the shuffle config builder).
      expect(config.map_sides).toHaveLength(1);
      expect(['team1_ct', 'team2_ct']).toContain(config.map_sides![0]);
      config.map_sides = ['<random-side>'];

      // Generated teams: ids and names embed a generated suffix, and which
      // player lands on which side is up to the balancer. Record the union
      // of both rosters (sorted) plus each side's size.
      const rosterIds = [config.team1, config.team2].map((team) =>
        Object.keys(team?.players ?? {}).sort()
      );
      const replace: Record<string, string> = { ...COMMON_REPLACE };
      for (const [side, team] of [
        ['team1', config.team1],
        ['team2', config.team2],
      ] as const) {
        if (team?.id) replace[team.id] = `<shuffle-${side}-id>`;
        if (team?.name) replace[team.name] = `<shuffle-${side}-name>`;
        if (team?.tag) replace[team.tag] = `<shuffle-${side}-tag>`;
      }
      const normalizedConfig = normalizeForGolden(
        {
          ...config,
          team1: { ...config.team1, players: `<${rosterIds[0].length} players>` },
          team2: { ...config.team2, players: `<${rosterIds[1].length} players>` },
        },
        { replace }
      );

      snapshot.push({
        slug: match.slug,
        round: match.round,
        matchNumber: match.matchNumber,
        config: normalizedConfig,
        allPlayers: [...rosterIds[0], ...rosterIds[1]].sort(),
      });
    }

    expectGolden('match-config-shuffle', snapshot);
  });

  test('standalone (manual) match', { tag: ['@api', '@golden'] }, async ({ request }) => {
    await request.delete('/api/tournament', { headers: getAuthHeader() });

    const slug = 'golden-manual-match';
    await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });

    // The payload the "Create manual match" modal posts
    // (client/src/components/modals/useCreateManualMatchModal.ts): an existing
    // team against an ad-hoc roster, Bo3 without veto, fixed sides.
    const [team1] = TEAMS;
    const created = await postOk<{ match: { id: number; slug: string } }>(request, '/api/matches', {
      slug,
      config: {
        vetoDisabled: true,
        maplist: ['de_mirage', 'de_inferno', 'de_nuke'],
        num_maps: 3,
        players_per_team: 5,
        expected_players_total: 10,
        expected_players_team1: 5,
        expected_players_team2: 5,
        team1: {
          id: team1.id,
          name: team1.name,
          tag: team1.tag,
          players: team1.players.map((p) => ({ steamid: p.steamId, name: p.name })),
        },
        team2: {
          name: 'Ad-hoc Mix',
          players: Array.from({ length: 5 }, (_, i) => ({
            steamid: steamId(60, i + 1),
            name: `Mix ${i + 1}`,
          })),
        },
        map_sides: ['team1_ct', 'team2_ct', 'knife'],
        cvars: {
          mp_maxrounds: 24,
          matchzy_knife_enabled_default: 1,
          mp_overtime_enable: 1,
          mp_overtime_maxrounds: 6,
        },
      },
    });

    try {
      const config = await fetchServedConfig({
        id: created.match.id,
        slug,
        round: 0,
        matchNumber: 0,
      });
      expectGolden('match-config-manual', normalizeForGolden({ slug, config }, { replace: COMMON_REPLACE }));
    } finally {
      await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
    }
  });
});
