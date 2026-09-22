/**
 * CS2 player stats: the `statsSchema` metrics, and the mappers between them,
 * MatchZy's per-player stat records and the CS2 columns of
 * `player_match_stats`.
 *
 * The core persists `PlayerStatLine`s and rates players from their metrics;
 * it never names a CS2 column. Every mapper here keeps the exact expressions
 * the core used before (the `|| 0` fallbacks, the two-decimal ADR, the
 * rounds-played recovery), so stored rows and ratings are unchanged.
 */

import type { StatsSchema } from '../types';

/**
 * The metrics MatchZy reports, i.e. the CS2 columns of `player_match_stats`
 * (`damage` is `total_damage`). The same for every tournament today;
 * `statsSchema` is a function so a mode that records less (or more) can say
 * so later.
 *
 * `ratingWeightKey` is the key ELO templates have always stored the weight
 * under. The order is the order the stat adjustment has always summed the
 * weights in; keep it, or ratings stop being bit-identical.
 */
export const CS2_STATS_SCHEMA: StatsSchema = {
  metrics: [
    { key: 'kills', label: 'Kills', higherIsBetter: true, ratingWeightable: true },
    { key: 'deaths', label: 'Deaths', higherIsBetter: false, ratingWeightable: true },
    { key: 'assists', label: 'Assists', higherIsBetter: true, ratingWeightable: true },
    {
      key: 'flash_assists',
      label: 'Flash assists',
      higherIsBetter: true,
      ratingWeightable: true,
      ratingWeightKey: 'flashAssists',
    },
    {
      key: 'headshots',
      label: 'Headshots',
      higherIsBetter: true,
      ratingWeightable: true,
      ratingWeightKey: 'headshotKills',
    },
    { key: 'damage', label: 'Damage', higherIsBetter: true, ratingWeightable: true },
    {
      key: 'utility_damage',
      label: 'Utility damage',
      higherIsBetter: true,
      ratingWeightable: true,
      ratingWeightKey: 'utilityDamage',
    },
    { key: 'kast', label: 'KAST', higherIsBetter: true, ratingWeightable: true },
    { key: 'mvps', label: 'MVPs', higherIsBetter: true, ratingWeightable: true },
    { key: 'score', label: 'Score', higherIsBetter: true, ratingWeightable: true },
    { key: 'adr', label: 'ADR', higherIsBetter: true, ratingWeightable: true },
    { key: 'rounds_played', label: 'Rounds played', higherIsBetter: true, ratingWeightable: false },
  ],
};

/**
 * A MatchZy per-player stat record (`damage`, `headshot_kills`, `mvp`, …, in
 * snake or camel case) as metrics. ADR is damage / rounds, two decimals, as
 * stored in `player_match_stats.adr`.
 *
 * Values are passed through as MatchZy sent them (no coercion), as before.
 */
export function metricsFromMatchZyStats(raw: Record<string, unknown>): Record<string, number> {
  const stats = raw as {
    rounds_played?: number;
    roundsPlayed?: number;
    damage?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    headshot_kills?: number;
    headshotKills?: number;
    flash_assists?: number;
    flashAssists?: number;
    utility_damage?: number;
    utilityDamage?: number;
    kast?: number;
    mvp?: number;
    mvps?: number;
    score?: number;
  };
  const roundsPlayed = stats.rounds_played ?? stats.roundsPlayed ?? 0;
  const adr = roundsPlayed > 0 ? (stats.damage ?? 0) / roundsPlayed : 0;
  return {
    adr: Math.round(adr * 100) / 100, // Round to 2 decimal places
    damage: stats.damage || 0,
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    headshots: stats.headshot_kills || stats.headshotKills || 0,
    flash_assists: stats.flash_assists || stats.flashAssists || 0,
    utility_damage: stats.utility_damage || stats.utilityDamage || 0,
    kast: stats.kast || 0,
    mvps: stats.mvp || stats.mvps || 0,
    score: stats.score || 0,
    rounds_played: roundsPlayed,
  };
}

/**
 * The CS2 columns of a `player_match_stats` row. A player MatchZy reported
 * nothing for (`{}`) gets zeros everywhere.
 */
export function cs2PlayerStatsColumns(metrics: Record<string, number>): Record<string, unknown> {
  return {
    adr: metrics.adr ?? 0,
    total_damage: metrics.damage || 0,
    kills: metrics.kills || 0,
    deaths: metrics.deaths || 0,
    assists: metrics.assists || 0,
    headshots: metrics.headshots || 0,
    flash_assists: metrics.flash_assists || 0,
    utility_damage: metrics.utility_damage || 0,
    kast: metrics.kast || 0,
    mvps: metrics.mvps || 0,
    score: metrics.score || 0,
    rounds_played: metrics.rounds_played ?? 0,
  };
}

/**
 * The metrics of a stored `player_match_stats` row, as the rating stat
 * adjustment reads them.
 *
 * Rows from before `rounds_played` was stored recover it from damage / ADR.
 * `adr` here is the unrounded damage / rounds (the stored column is rounded
 * to two decimals); the adjustment has always used the unrounded value.
 */
export function cs2PlayerStatsMetrics(row: Record<string, unknown>): Record<string, number> {
  const stat = row as {
    adr: number;
    total_damage: number;
    kills: number;
    deaths: number;
    assists: number;
    headshots: number;
    flash_assists: number | null;
    utility_damage: number | null;
    kast: number | null;
    mvps: number | null;
    score: number | null;
    rounds_played: number | null;
  };
  const roundsPlayed =
    stat.rounds_played ||
    (stat.adr > 0 && stat.total_damage > 0 ? Math.round(stat.total_damage / stat.adr) : 0);
  const damage = stat.total_damage || 0;
  return {
    kills: stat.kills || 0,
    deaths: stat.deaths || 0,
    assists: stat.assists || 0,
    flash_assists: stat.flash_assists || 0,
    headshots: stat.headshots || 0,
    damage,
    utility_damage: stat.utility_damage || 0,
    kast: stat.kast || 0,
    mvps: stat.mvps || 0,
    score: stat.score || 0,
    adr: roundsPlayed > 0 ? damage / roundsPlayed : 0,
    rounds_played: roundsPlayed,
  };
}
