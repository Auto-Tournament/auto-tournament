import crypto from 'crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { INTEGRATOR, READONLY_TOKEN, bearer } from '../helpers/webhooks';
import { feedCounts } from '../../api/src/integrations/cs2/statTotals';

/**
 * GET /api/integrations/player-stats: each player's numbers summed over
 * tournaments, matches or an import's event, for an event website's stat
 * trophies (api/src/integrations/cs2/statTotals.ts).
 *
 * The matches are written straight into the stats tables
 * (POST /api/test/stats-fixture), as the game server, the series end and
 * the demo analysis would have left them:
 *
 * - tournament 1: a Bo3 (three maps, map and series lines, a kill feed for
 *   every map with a knife round, a knife kill and a team kill), an
 *   unfinished match and a bot-filled one (neither counts);
 * - tournament 2: a Bo1 whose demo wasn't analyzed (no kill feed);
 * - an import (no series line) with a map that has no result.
 *
 * @tag api
 * @tag integrations
 */

const rand = () => crypto.randomBytes(4).toString('hex');
const steamId = () => `765611990${String(crypto.randomInt(1e8)).padStart(8, '0')}`;

const A = steamId();
const B = steamId();
const B2 = steamId(); // B's teammate, only in the kill feed
const run = rand();
const X = `ps-x-${run}`;
const Y = `ps-y-${run}`;
const EVENT = `CI LAN ${run}`;
const slug = (s: string) => `ps-${s}-${run}`;

/** A map line (cs2_player_map_stats) for a player. */
function line(playerId: string, team: 'team1' | 'team2', over: Record<string, number> = {}) {
  return {
    player_id: playerId,
    team,
    rounds_played: 20,
    kills: 10,
    deaths: 5,
    assists: 2,
    damage: 1800,
    headshot_kills: 4,
    kast_rounds: 15,
    entry_kills: 2,
    clutches_won: 1,
    enemies_flashed: 3,
    friendlies_flashed: 1,
    multi_5k: 0,
    utility_damage: 50,
    demo_analyzed: 1,
    ...over,
  };
}

/** A series line (player_match_stats) for a player. */
function series(playerId: string, team: 'team1' | 'team2', won: boolean, over = {}) {
  return {
    player_id: playerId,
    team,
    won_match: won,
    rounds_played: 60,
    kills: 30,
    deaths: 15,
    assists: 6,
    headshots: 12,
    total_damage: 5400,
    utility_damage: 999,
    flash_assists: 2,
    mvps: 5,
    score: 150,
    kast: 75,
    adr: 90,
    ...over,
  };
}

const kill = (
  round: number,
  attacker: string,
  victim: string,
  weapon: string,
  attackerSide = 'CT',
  victimSide = 'T'
) => ({ round, tick: round * 1000, attacker, victim, weapon, attackerSide, victimSide });

/** A knife round (three knife kills) and a normal round. */
const KNIFE_ROUND = [
  kill(1, A, B, 'Knife'),
  kill(1, B, A, 'Knife', 'T', 'CT'),
  kill(1, A, B2, 'Knife'),
];

async function read(
  request: APIRequestContext,
  query: string,
  token = INTEGRATOR.token
): Promise<{
  tournaments: number[];
  players: Array<Record<string, unknown> & { steamId: string }>;
  updatedAt: string | null;
}> {
  const res = await request.get(`/api/integrations/player-stats?${query}`, {
    headers: bearer(token),
  });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

const of = (players: Array<{ steamId: string }>, id: string) => {
  const p = players.find((x) => x.steamId === id);
  expect(p, id).toBeTruthy();
  return p as Record<string, unknown>;
};

test.describe('Player stats summing (pure)', () => {
  test('the knife round is left out; a team kill is not a knife kill', () => {
    const counts = feedCounts([
      ...KNIFE_ROUND,
      kill(2, A, B, 'Knife'),
      kill(2, B, B2, 'Knife', 'T', 'T'),
      kill(2, A, 'bot:Joe', 'AK-47'),
    ]);
    expect(counts.get(A)).toEqual({ knifeKills: 1, teamKills: 0 });
    expect(counts.get(B)).toEqual({ knifeKills: 0, teamKills: 1 });
  });
});

test.describe.serial('Player stats API for integrators', () => {
  let t1 = 0;
  let t2 = 0;

  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const res = await request.post('/api/test/stats-fixture', {
      data: {
        tournaments: [`PS Swiss ${run}`, `PS Final ${run}`],
        players: [
          { id: A, name: 'Player A' },
          { id: B, name: 'Player B' },
        ],
        teams: [
          { id: X, name: `X ${run}`, players: [A] },
          { id: Y, name: `Y ${run}`, players: [B, B2] },
        ],
        matches: [
          {
            // A Bo3, 2-1 to X.
            slug: slug('bo3'),
            tournament: 0,
            team1: X,
            team2: Y,
            winner: 'team1',
            maps: [
              {
                winner: 'team1',
                lines: [line(A, 'team1'), line(B, 'team2', { kills: 6 })],
                kills: [...KNIFE_ROUND, kill(3, A, B, 'Knife')],
              },
              {
                winner: 'team2',
                lines: [line(A, 'team1'), line(B, 'team2', { kills: 6 })],
                kills: [kill(2, B, B2, 'AK-47', 'T', 'T')],
              },
              {
                winner: 'team1',
                lines: [line(A, 'team1', { multi_5k: 1 }), line(B, 'team2', { kills: 6 })],
                kills: [kill(2, A, B, 'AWP')],
              },
            ],
            series: [series(A, 'team1', true), series(B, 'team2', false, { mvps: 2 })],
          },
          {
            // Not finished: doesn't count.
            slug: slug('live'),
            tournament: 0,
            completed: false,
            team1: X,
            team2: Y,
            maps: [{ winner: 'team1', lines: [line(A, 'team1', { kills: 100 })] }],
          },
          {
            // Bot-filled: doesn't count.
            slug: slug('bots'),
            tournament: 0,
            team1: X,
            team2: Y,
            winner: 'team1',
            config: { num_maps: 1, bot_fill: true },
            maps: [{ winner: 'team1', lines: [line(A, 'team1', { kills: 100 })] }],
            series: [series(A, 'team1', true)],
          },
          {
            // The final: a Bo1 to Y, its demo not analyzed.
            slug: slug('final'),
            tournament: 1,
            team1: X,
            team2: Y,
            winner: 'team2',
            maps: [
              {
                winner: 'team2',
                lines: [
                  line(A, 'team1', { demo_analyzed: 0 }),
                  line(B, 'team2', { demo_analyzed: 0 }),
                ],
              },
            ],
            series: [
              series(A, 'team1', false, { utility_damage: 30, mvps: 1 }),
              series(B, 'team2', true, { utility_damage: 40, mvps: 4 }),
            ],
          },
          {
            // An import: no series line; its second map has no result.
            slug: slug('import'),
            source: 'import',
            playedIn: EVENT,
            team1: X,
            team2: Y,
            winner: 'team1',
            maps: [
              {
                winner: 'team1',
                lines: [line(A, 'team1'), line(B, 'team2')],
                kills: [kill(4, A, B, 'Knife')],
              },
              { winner: null, lines: [line(A, 'team1', { kills: 100 })] },
            ],
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    [t1, t2] = ((await res.json()) as { tournamentIds: number[] }).tournamentIds;
  });

  test.afterAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await request.post('/api/test/stats-fixture/cleanup', {
      data: {
        tournamentIds: [t1, t2],
        slugs: ['bo3', 'live', 'bots', 'final', 'import'].map(slug),
        teams: [X, Y],
        players: [A, B],
      },
    });
  });

  test('two tournaments are summed; a Bo3 is one match', async ({ request }) => {
    const body = await read(request, `tournament=${t1},${t2}`);
    expect(body.tournaments).toEqual([t1, t2]);
    expect(body.players.map((p) => p.steamId).sort()).toEqual([A, B].sort());
    expect(typeof body.updatedAt).toBe('string');
    expect(of(body.players, A)).toEqual({
      steamId: A,
      name: 'Player A',
      matchesPlayed: 2,
      matchesWon: 1,
      roundsPlayed: 80,
      kills: 40,
      deaths: 20,
      assists: 8,
      headshotKills: 16,
      totalDamage: 7200,
      // Three analyzed maps (50 each), then the final's series line.
      utilityDamage: 180,
      flashAssists: 4,
      mvps: 6,
      score: 300,
      adr: 90,
      kast: 75,
      // The final has no kill feed: not measured.
      teamKills: null,
      friendliesFlashed: 4,
      enemiesFlashed: 12,
      knifeKills: null,
      firstKills: 8,
      clutches: 4,
      multiKills5k: 1,
    });
    expect(of(body.players, B)).toMatchObject({
      matchesPlayed: 2,
      matchesWon: 1,
      kills: 28,
      mvps: 6,
    });
    // B2 is only in a kill feed: no row.
    expect(body.players.find((p) => p.steamId === B2)).toBeUndefined();
  });

  test('one tournament: the kill feed counts, the knife round does not', async ({ request }) => {
    const body = await read(request, `tournament=${t1}`, READONLY_TOKEN.token);
    expect(of(body.players, A)).toMatchObject({
      matchesPlayed: 1,
      matchesWon: 1,
      roundsPlayed: 60,
      kills: 30,
      knifeKills: 1,
      teamKills: 0,
      utilityDamage: 150,
    });
    expect(of(body.players, B)).toMatchObject({ matchesWon: 0, knifeKills: 0, teamKills: 1 });
  });

  test('an import by event or slug: only maps with a result, null for what it lacks', async ({
    request,
  }) => {
    for (const q of [
      `event=${encodeURIComponent(EVENT.toLowerCase())}`,
      `match=${slug('import')}`,
    ]) {
      const body = await read(request, q);
      expect(body.tournaments).toEqual([]);
      expect(of(body.players, A), q).toMatchObject({
        matchesPlayed: 1,
        matchesWon: 1,
        roundsPlayed: 20,
        kills: 10,
        kast: 75,
        knifeKills: 1,
        utilityDamage: 50,
        mvps: null,
        score: null,
        flashAssists: null,
      });
    }
  });

  test('match slugs and tournaments together', async ({ request }) => {
    const body = await read(request, `tournament=${t2}&match=${slug('import')}`);
    expect(of(body.players, A)).toMatchObject({ matchesPlayed: 2, kills: 20, mvps: null });
  });

  test('GET /api/matches names each match tournament', async ({ request }) => {
    const res = await request.get('/api/matches');
    expect(res.ok()).toBe(true);
    const { matches } = (await res.json()) as {
      matches: Array<{ slug: string; tournamentId: number | null }>;
    };
    const bySlug = new Map(matches.map((m) => [m.slug, m.tournamentId]));
    expect(bySlug.get(slug('bo3'))).toBe(t1);
    expect(bySlug.get(slug('final'))).toBe(t2);
    expect(bySlug.get(slug('import'))).toBeNull();
  });

  test('no token, no answer; bad parameters are refused', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get(`/api/integrations/player-stats?tournament=${t1}`)).status()).toBe(
      401
    );
    for (const q of ['', 'tournament=x', 'tournament=4,-1', 'tournament=', 'event=%20']) {
      const res = await anonymous.get(`/api/integrations/player-stats?${q}`, {
        headers: bearer(INTEGRATOR.token),
      });
      expect(res.status(), q).toBe(400);
    }
    await anonymous.dispose();
  });
});
