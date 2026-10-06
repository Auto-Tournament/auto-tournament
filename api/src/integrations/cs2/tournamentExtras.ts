/**
 * CS2's numbers for a tournament's results (`tournamentPlayerExtras`): each
 * player's rating over the tournament's maps, clutches won and teammates
 * flashed, from what Ready Up servers record (cs2_player_map_stats). Players
 * with no such maps are left out.
 */

import { db } from '../../config/database';
import type { TournamentPlayerExtras } from '../types';
import { atRating } from './rating';

export async function tournamentPlayerExtras(
  tournamentId: number
): Promise<Record<string, TournamentPlayerExtras>> {
  const rows = await db.queryAsync<{
    player_id: string;
    rounds_played: string | number;
    kills: string | number;
    deaths: string | number;
    assists: string | number;
    damage: string | number;
    kast_rounds: string | number;
    clutches_won: string | number;
    friendlies_flashed: string | number;
  }>(
    `SELECT s.player_id, SUM(s.rounds_played) AS rounds_played, SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths, SUM(s.assists) AS assists, SUM(s.damage) AS damage,
            SUM(s.kast_rounds) AS kast_rounds,
            SUM(s.clutches_won) AS clutches_won, SUM(s.friendlies_flashed) AS friendlies_flashed
       FROM cs2_player_map_stats s JOIN matches m ON m.slug = s.match_slug
      WHERE m.tournament_id = ?
      GROUP BY s.player_id`,
    [tournamentId]
  );
  const out: Record<string, TournamentPlayerExtras> = {};
  for (const r of rows) {
    out[r.player_id] = {
      rating: atRating({
        rounds_played: Number(r.rounds_played),
        kills: Number(r.kills),
        deaths: Number(r.deaths),
        assists: Number(r.assists),
        damage: Number(r.damage),
        kast_rounds: Number(r.kast_rounds),
      }),
      clutchesWon: Number(r.clutches_won),
      teamFlashes: Number(r.friendlies_flashed),
    };
  }
  return out;
}
