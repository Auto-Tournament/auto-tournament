/**
 * GET /api/game/cs2/players/:playerId/profile
 *
 * The CS2 numbers on a player's profile (`playerProfileView`): the player's
 * totals over every CS2 match the platform recorded, the same totals for
 * everyone (the "site average" the profile compares against), and how the
 * player's team did on each map they played.
 *
 * `detail` is what only Ready Up servers send (cs2_player_map_stats):
 * rounds per side, openings, clutches, flashes on teammates and the rating,
 * for the player and for everyone. Null for a player with none of those maps.
 *
 * Public, like the rest of the profile: these are the numbers the
 * leaderboards already show, summed.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { atRating } from '../rating';

const router = Router();

interface TotalsRow {
  matches: number | string | null;
  kills: number | string | null;
  deaths: number | string | null;
  assists: number | string | null;
  headshots: number | string | null;
  total_damage: number | string | null;
  rounds_played: number | string | null;
  flash_assists: number | string | null;
  utility_damage: number | string | null;
  mvps: number | string | null;
  kast: number | string | null;
}

interface MapRow {
  map_name: string;
  played: number | string;
  won: number | string;
  rounds_won: number | string | null;
  rounds_lost: number | string | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? (n as number) : 0;
};

function totals(row: TotalsRow | undefined) {
  return {
    matches: num(row?.matches),
    kills: num(row?.kills),
    deaths: num(row?.deaths),
    assists: num(row?.assists),
    headshots: num(row?.headshots),
    totalDamage: num(row?.total_damage),
    roundsPlayed: num(row?.rounds_played),
    flashAssists: num(row?.flash_assists),
    utilityDamage: num(row?.utility_damage),
    mvps: num(row?.mvps),
    // Average of the per-match KAST (0-100), null when none was recorded.
    kast: row?.kast === null || row?.kast === undefined ? null : num(row.kast),
  };
}

// Only CS2 matches: a manually reported game has no kills to sum.
const CS2_MATCH = `(m.game IS NULL OR m.game = 'cs2')`;

const TOTALS_SELECT = `
  SELECT
    COUNT(DISTINCT pms.match_slug) AS matches,
    SUM(pms.kills) AS kills,
    SUM(pms.deaths) AS deaths,
    SUM(pms.assists) AS assists,
    SUM(pms.headshots) AS headshots,
    SUM(pms.total_damage) AS total_damage,
    SUM(pms.rounds_played) AS rounds_played,
    SUM(pms.flash_assists) AS flash_assists,
    SUM(pms.utility_damage) AS utility_damage,
    SUM(pms.mvps) AS mvps,
    AVG(pms.kast) AS kast
  FROM player_match_stats pms
  JOIN matches m ON pms.match_slug = m.slug
`;

interface DetailRow {
  maps: number | string | null;
  rounds_played: number | string | null;
  kills: number | string | null;
  deaths: number | string | null;
  entry_kills: number | string | null;
  entry_deaths: number | string | null;
  trade_kills: number | string | null;
  clutches_won: number | string | null;
  enemies_flashed: number | string | null;
  friendlies_flashed: number | string | null;
  multi_1k: number | string | null;
  multi_2k: number | string | null;
  multi_3k: number | string | null;
  multi_4k: number | string | null;
  multi_5k: number | string | null;
  ct_rounds: number | string | null;
  ct_rounds_won: number | string | null;
  t_rounds: number | string | null;
  t_rounds_won: number | string | null;
  assists: number | string | null;
  damage: number | string | null;
  kast_rounds: number | string | null;
  time_to_damage_sum: number | string | null;
  time_to_damage_samples: number | string | null;
  demo_rounds: number | string | null;
  money_spent: number | string | null;
  shots: number | string | null;
  hits: number | string | null;
  spray_shots: number | string | null;
  spray_hits: number | string | null;
  crosshair_angle_sum: number | string | null;
  crosshair_samples: number | string | null;
}

const DETAIL_SELECT = `
  SELECT COUNT(*) AS maps,
    SUM(rounds_played) AS rounds_played, SUM(kills) AS kills, SUM(deaths) AS deaths,
    SUM(entry_kills) AS entry_kills, SUM(entry_deaths) AS entry_deaths,
    SUM(trade_kills) AS trade_kills, SUM(clutches_won) AS clutches_won,
    SUM(enemies_flashed) AS enemies_flashed, SUM(friendlies_flashed) AS friendlies_flashed,
    SUM(multi_1k) AS multi_1k, SUM(multi_2k) AS multi_2k, SUM(multi_3k) AS multi_3k,
    SUM(multi_4k) AS multi_4k, SUM(multi_5k) AS multi_5k,
    SUM(ct_rounds) AS ct_rounds, SUM(ct_rounds_won) AS ct_rounds_won,
    SUM(t_rounds) AS t_rounds, SUM(t_rounds_won) AS t_rounds_won,
    SUM(CASE WHEN demo_analyzed = 1 THEN rounds_played ELSE 0 END) AS demo_rounds,
    SUM(money_spent) AS money_spent, SUM(shots) AS shots, SUM(hits) AS hits,
    SUM(spray_shots) AS spray_shots, SUM(spray_hits) AS spray_hits,
    SUM(crosshair_angle_sum) AS crosshair_angle_sum, SUM(crosshair_samples) AS crosshair_samples,
    SUM(assists) AS assists, SUM(damage) AS damage, SUM(kast_rounds) AS kast_rounds,
    SUM(time_to_damage_sum) AS time_to_damage_sum, SUM(time_to_damage_samples) AS time_to_damage_samples
  FROM cs2_player_map_stats
`;

function detail(row: DetailRow | undefined) {
  if (!row || !num(row.maps) || !num(row.rounds_played)) return null;
  const t = {
    rounds_played: num(row.rounds_played),
    kills: num(row.kills),
    deaths: num(row.deaths),
    multi_1k: num(row.multi_1k),
    multi_2k: num(row.multi_2k),
    multi_3k: num(row.multi_3k),
    multi_4k: num(row.multi_4k),
    multi_5k: num(row.multi_5k),
  };
  return {
    maps: num(row.maps),
    roundsPlayed: t.rounds_played,
    rating: atRating({
      ...t,
      assists: num(row.assists),
      damage: num(row.damage),
      kast_rounds: num(row.kast_rounds),
    }),
    kast: Math.round((num(row.kast_rounds) / t.rounds_played) * 100),
    openingKills: num(row.entry_kills),
    openingDeaths: num(row.entry_deaths),
    tradeKills: num(row.trade_kills),
    clutchesWon: num(row.clutches_won),
    enemiesFlashed: num(row.enemies_flashed),
    friendliesFlashed: num(row.friendlies_flashed),
    multiKills: [t.multi_2k, t.multi_3k, t.multi_4k, t.multi_5k],
    ct: { rounds: num(row.ct_rounds), won: num(row.ct_rounds_won) },
    t: { rounds: num(row.t_rounds), won: num(row.t_rounds_won) },
    // From the demo (the worker): null until a demo of theirs was read.
    aim: num(row.demo_rounds)
      ? {
          accuracy: num(row.shots) ? num(row.hits) / num(row.shots) : null,
          sprayAccuracy: num(row.spray_shots) ? num(row.spray_hits) / num(row.spray_shots) : null,
          crosshairDegrees: num(row.crosshair_samples)
            ? Math.round((num(row.crosshair_angle_sum) / num(row.crosshair_samples)) * 10) / 10
            : null,
          moneyPerRound: Math.round(num(row.money_spent) / num(row.demo_rounds)),
          timeToDamageMs: num(row.time_to_damage_samples)
            ? Math.round(num(row.time_to_damage_sum) / num(row.time_to_damage_samples))
            : null,
        }
      : null,
  };
}

router.get('/players/:playerId/profile', async (req: Request, res: Response) => {
  const { playerId } = req.params;
  try {
    const player = await db.queryOneAsync<TotalsRow>(
      `${TOTALS_SELECT} WHERE pms.player_id = ? AND ${CS2_MATCH}`,
      [playerId]
    );
    const everyone = await db.queryOneAsync<TotalsRow>(`${TOTALS_SELECT} WHERE ${CS2_MATCH}`);

    // Each map the player's team played: won when the map's winner is the
    // player's side of that match, rounds from the side's own score.
    const maps = await db.queryAsync<MapRow>(
      `SELECT
         mmr.map_name,
         COUNT(*) AS played,
         SUM(CASE WHEN mmr.winner_team = pms.team THEN 1 ELSE 0 END) AS won,
         SUM(CASE WHEN pms.team = 'team1' THEN mmr.team1_score ELSE mmr.team2_score END) AS rounds_won,
         SUM(CASE WHEN pms.team = 'team1' THEN mmr.team2_score ELSE mmr.team1_score END) AS rounds_lost
       FROM player_match_stats pms
       JOIN matches m ON pms.match_slug = m.slug
       JOIN match_map_results mmr ON mmr.match_slug = pms.match_slug
       WHERE pms.player_id = ? AND ${CS2_MATCH}
         AND mmr.map_name IS NOT NULL AND mmr.map_name <> ''
         AND mmr.winner_team IS NOT NULL
       GROUP BY mmr.map_name
       ORDER BY played DESC, mmr.map_name`,
      [playerId]
    );

    const playerDetail = await db.queryOneAsync<DetailRow>(`${DETAIL_SELECT} WHERE player_id = ?`, [
      playerId,
    ]);
    const everyoneDetail = await db.queryOneAsync<DetailRow>(DETAIL_SELECT);

    return res.json({
      success: true,
      player: totals(player),
      everyone: totals(everyone),
      detail: { player: detail(playerDetail), everyone: detail(everyoneDetail) },
      maps: maps.map((row) => ({
        map: row.map_name,
        played: num(row.played),
        won: num(row.won),
        roundsWon: num(row.rounds_won),
        roundsLost: num(row.rounds_lost),
      })),
    });
  } catch (error) {
    log.error('[Cs2Profile] Failed to read the profile stats', { error, playerId });
    return res.status(500).json({ success: false, error: 'Failed to read the profile stats' });
  }
});

export default router;
