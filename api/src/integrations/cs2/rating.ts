/**
 * The Auto Tournament rating for CS2: one number per player over any set of
 * maps, 1.00 for an average player.
 *
 * Built like the community's reconstruction of HLTV's Rating 2.0 (HLTV never
 * published it; awpy's fit, MIT): kills, deaths and assists per round, damage
 * per round and KAST, with "impact" from kills and assists per round. It is
 * our own number, not HLTV's, and is named that way in the UI.
 */

export interface RatingTotals {
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  kast_rounds: number;
}

/** Sums for `atRating` over cs2_player_map_stats rows. */
export const RATING_SUMS = `SUM(rounds_played) AS rounds_played, SUM(kills) AS kills, SUM(deaths) AS deaths,
  SUM(assists) AS assists, SUM(damage) AS damage, SUM(kast_rounds) AS kast_rounds`;

export function atRating(t: RatingTotals): number | null {
  const rounds = Number(t.rounds_played);
  if (!rounds) return null;
  const kpr = Number(t.kills) / rounds;
  const dpr = Number(t.deaths) / rounds;
  const apr = Number(t.assists) / rounds;
  const adr = Number(t.damage) / rounds;
  const kast = (Number(t.kast_rounds) / rounds) * 100;
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  const rating =
    0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
  return Math.round(Math.max(0, rating) * 100) / 100;
}
