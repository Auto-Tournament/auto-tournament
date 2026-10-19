import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * GET /api/game/cs2/players/:id/profile counts an imported match: its maps
 * have demo analysis (cs2_player_map_stats) and no live stats
 * (player_match_stats), and the profile's totals and map record use them.
 *
 * @tag api
 * @tag stats
 */

const run = `${Date.now()}`.slice(-8);
const PLAYER = `76561199${run}7`.padEnd(17, '0');
const OTHER = `76561199${run}8`.padEnd(17, '0');
const SLUG = `import-profile-${run}`;
const TEAMS = [`profimp-x-${run}`, `profimp-y-${run}`];

const line = (team: 'team1' | 'team2', player: string) => ({
  player_id: player,
  team,
  rounds_played: 20,
  kills: 20,
  deaths: 10,
  damage: 2000,
  headshot_kills: 10,
  kast_rounds: 15,
});

test.afterAll(async ({ request }) => {
  await request.post('/api/test/stats-fixture/cleanup', {
    data: { slugs: [SLUG], teams: TEAMS, players: [PLAYER, OTHER] },
  });
});

test(
  'an imported match counts on the profile',
  { tag: ['@api', '@stats'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const seeded = await request.post('/api/test/stats-fixture', {
      data: {
        players: [
          { id: PLAYER, name: 'Imported pro' },
          { id: OTHER, name: 'Opponent' },
        ],
        teams: [
          { id: TEAMS[0], name: `X ${run}`, players: [OTHER] },
          { id: TEAMS[1], name: `Y ${run}`, players: [PLAYER] },
        ],
        matches: [
          {
            // Imported: demo stats per map, no live stats. The player's team (team2) won map 1.
            slug: SLUG,
            source: 'import',
            team1: TEAMS[0],
            team2: TEAMS[1],
            winner: 'team1',
            maps: [
              { winner: 'team2', lines: [line('team2', PLAYER), line('team1', OTHER)] },
              { winner: 'team1', lines: [line('team2', PLAYER), line('team1', OTHER)] },
            ],
          },
        ],
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);

    const res = await request.get(`/api/game/cs2/players/${PLAYER}/profile`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      player: Record<string, number | null>;
      maps: Array<{ map: string; played: number; won: number }>;
    };
    expect(body.player).toMatchObject({
      matches: 1,
      kills: 40,
      deaths: 20,
      headshots: 20,
      totalDamage: 4000,
      roundsPlayed: 40,
      kast: 75,
    });
    // The fixture names every map de_mirage: two played, one won.
    expect(body.maps).toEqual([expect.objectContaining({ map: 'de_mirage', played: 2, won: 1 })]);
  }
);
