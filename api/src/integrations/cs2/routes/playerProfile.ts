/**
 * GET /api/game/cs2/players/:playerId/profile
 *
 * The CS2 numbers on a player's profile (`playerProfileView`): the player's
 * totals over every CS2 match the platform recorded, the same totals for
 * everyone (the "site average" the profile compares against), and how the
 * player's team did on each map they played.
 *
 * Public, like the rest of the profile: these are the numbers the
 * leaderboards already show, summed.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

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

    return res.json({
      success: true,
      player: totals(player),
      everyone: totals(everyone),
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
