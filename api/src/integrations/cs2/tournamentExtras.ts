/**
 * CS2's numbers for a tournament's results (`tournamentPlayerExtras`): each
 * player's rating over the tournament's maps, clutches won and teammates
 * flashed, from what Ready Up servers record (cs2_player_map_stats). Players
 * with no such maps are left out.
 */

import { db } from '../../config/database';
import type { TournamentPlayerExtras } from '../types';
import { hltvRating } from './fleet/mapStats';

export async function tournamentPlayerExtras(
  tournamentId: number
): Promise<Record<string, TournamentPlayerExtras>> {
  const rows = await db.queryAsync<{
    player_id: string;
    rounds_played: string | number;
    kills: string | number;
    deaths: string | number;
    multi_1k: string | number;
    multi_2k: string | number;
    multi_3k: string | number;
    multi_4k: string | number;
    multi_5k: string | number;
    clutches_won: string | number;
    friendlies_flashed: string | number;
  }>(
    `SELECT s.player_id, SUM(s.rounds_played) AS rounds_played, SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths, SUM(s.multi_1k) AS multi_1k, SUM(s.multi_2k) AS multi_2k,
            SUM(s.multi_3k) AS multi_3k, SUM(s.multi_4k) AS multi_4k, SUM(s.multi_5k) AS multi_5k,
            SUM(s.clutches_won) AS clutches_won, SUM(s.friendlies_flashed) AS friendlies_flashed
       FROM cs2_player_map_stats s JOIN matches m ON m.slug = s.match_slug
      WHERE m.tournament_id = ?
      GROUP BY s.player_id`,
    [tournamentId]
  );
  const out: Record<string, TournamentPlayerExtras> = {};
  for (const r of rows) {
    out[r.player_id] = {
      rating: hltvRating({
        rounds_played: Number(r.rounds_played),
        kills: Number(r.kills),
        deaths: Number(r.deaths),
        multi_1k: Number(r.multi_1k),
        multi_2k: Number(r.multi_2k),
        multi_3k: Number(r.multi_3k),
        multi_4k: Number(r.multi_4k),
        multi_5k: Number(r.multi_5k),
      }),
      clutchesWon: Number(r.clutches_won),
      teamFlashes: Number(r.friendlies_flashed),
    };
  }
  return out;
}
