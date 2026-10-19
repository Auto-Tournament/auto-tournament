import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';

/**
 * GET /api/game/cs2/players/:id/profile counts an imported match: its maps
 * have demo analysis (cs2_player_map_stats) and no live stats
 * (player_match_stats), and the profile's totals and map record use them.
 *
 * @tag api
 * @tag stats
 */

test(
  'an imported match counts on the profile',
  { tag: ['@api', '@stats'] },
  async ({ request }) => {
    const stamp = `${Date.now()}`.slice(-9);
    const slug = `import-test${stamp}`;
    const player = `7656119${stamp}07`.slice(0, 17);
    await db.runAsync('INSERT INTO players (id, name) VALUES (?, ?)', [player, 'Imported pro']);
    await db.runAsync(
      `INSERT INTO matches (slug, round, match_number, config, status, game, completed_at)
     VALUES (?, 0, 0, '{}', 'completed', 'cs2', EXTRACT(EPOCH FROM NOW())::INTEGER)`,
      [slug]
    );
    // Two maps, the player's team (team2) won the first.
    for (const [map, name, t1, t2, winner] of [
      [0, 'de_mirage', 9, 13, 'team2'],
      [1, 'de_nuke', 13, 4, 'team1'],
    ] as const) {
      await db.runAsync(
        `INSERT INTO match_map_results (match_slug, map_number, map_name, team1_score, team2_score, winner_team)
       VALUES (?, ?, ?, ?, ?, ?)`,
        [slug, map, name, t1, t2, winner]
      );
      await db.runAsync(
        `INSERT INTO cs2_player_map_stats
         (match_slug, map_number, player_id, map_name, team, rounds_played, kills, deaths, damage, headshot_kills, kast_rounds)
       VALUES (?, ?, ?, ?, 'team2', 20, 20, 10, 2000, 10, 15)`,
        [slug, map, player, name]
      );
    }
    try {
      const res = await request.get(`/api/game/cs2/players/${player}/profile`);
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as {
        player: {
          matches: number;
          kills: number;
          deaths: number;
          headshots: number;
          totalDamage: number;
          roundsPlayed: number;
          kast: number | null;
        };
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
      expect(body.maps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ map: 'de_mirage', played: 1, won: 1 }),
          expect.objectContaining({ map: 'de_nuke', played: 1, won: 0 }),
        ])
      );
    } finally {
      await db.runAsync('DELETE FROM cs2_player_map_stats WHERE match_slug = ?', [slug]);
      await db.runAsync('DELETE FROM matches WHERE slug = ?', [slug]);
      await db.runAsync('DELETE FROM players WHERE id = ?', [player]);
    }
  }
);
