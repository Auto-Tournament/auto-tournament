/**
 * Pure Skill Rating math (no I/O), shared by ratingService and tests.
 */

import { rating, rate, ordinal, type Rating } from 'openskill';

// Conversion constants - closer to OpenSkill docs and classic Elo:
// - One OpenSkill "sigma" ≈ 200 rating points
// - Fresh player ordinal ≈ 0 maps to 1500 Skill Rating
export const ELO_OFFSET = 1500;
export const ELO_SCALE = 200;
export const DEFAULT_SIGMA = 8.333;

// Guard rails for display ELO to avoid absurd values (e.g. huge negatives).
// These only affect the stored/displayed "Skill Rating", not the underlying
// OpenSkill mu/sigma values.
export const MIN_DISPLAY_ELO = 0;
export const MAX_DISPLAY_ELO = 5000;

/**
 * Convert admin's "Skill Rating" input to OpenSkill rating
 * @param elo - Admin-facing Skill Rating number
 * @param matchCount - Number of matches played (for sigma adjustment)
 */
export function eloToOpenSkill(elo: number, matchCount: number = 0): Rating {
  // Map display ELO -> OpenSkill by inverting the ordinal mapping:
  //   ordinal(rating) = mu - 3 * sigma
  //   displayElo      = ordinal * ELO_SCALE + ELO_OFFSET
  // This keeps 1500 Skill Rating aligned with the OpenSkill default
  // (mu ≈ 25, sigma ≈ 8.333 ⇒ ordinal ≈ 0 ⇒ 1500).

  // Sigma decreases with experience
  // New: 8.33, After 10 matches: 6.0, After 30: 4.0, Min: 2.0
  const sigma = Math.max(2.0, DEFAULT_SIGMA - Math.min(matchCount * 0.2, 6.33));

  const targetOrdinal = (elo - ELO_OFFSET) / ELO_SCALE;
  const mu = targetOrdinal + 3 * sigma;

  return rating({ mu, sigma });
}

/** Convert OpenSkill rating to display ELO via ordinal (mu - 3*sigma), clamped. */
export function openSkillToDisplayElo(value: Rating): number {
  const raw = Math.round(ordinal(value) * ELO_SCALE + ELO_OFFSET);
  if (!Number.isFinite(raw)) {
    return ELO_OFFSET;
  }
  return Math.min(MAX_DISPLAY_ELO, Math.max(MIN_DISPLAY_ELO, raw));
}

export interface PlayerSkill {
  mu: number;
  sigma: number;
}

/**
 * Result component of a rating update: new OpenSkill ratings for both teams
 * (same order as given). Stat-based template adjustments are applied on top.
 */
export function computeTeamRatingUpdate(
  team1: PlayerSkill[],
  team2: PlayerSkill[],
  team1Won: boolean
): [Rating[], Rating[]] {
  const teams = [team1.map((p) => rating(p)), team2.map((p) => rating(p))];
  const ranks = team1Won ? [1, 2] : [2, 1]; // Lower rank = better (win)
  const [newTeam1, newTeam2] = rate(teams, { rank: ranks });
  return [newTeam1, newTeam2];
}

export interface RatingHistoryRow {
  player_id: string;
  match_slug: string;
  elo_before: number;
  mu_before: number;
  sigma_before: number;
  created_at: number;
  id: number;
}

export interface RatingRollback {
  playerId: string;
  elo: number;
  mu: number;
  sigma: number;
  /** Rated matches being undone (distinct match slugs). */
  matches: number;
}

/**
 * Ratings to restore when a tournament's matches (and, by cascade, their
 * rating history) are deleted: each player's rating before their first rated
 * match of that tournament. Without this, reset runs left ratings raised or
 * lowered with no history to explain them.
 */
export function ratingRollbacks(rows: RatingHistoryRow[]): RatingRollback[] {
  const byPlayer = new Map<string, { first: RatingHistoryRow; slugs: Set<string> }>();
  for (const row of rows) {
    const entry = byPlayer.get(row.player_id);
    if (!entry) {
      byPlayer.set(row.player_id, { first: row, slugs: new Set([row.match_slug]) });
      continue;
    }
    entry.slugs.add(row.match_slug);
    const earlier =
      row.created_at < entry.first.created_at ||
      (row.created_at === entry.first.created_at && row.id < entry.first.id);
    if (earlier) entry.first = row;
  }
  return Array.from(byPlayer.entries()).map(([playerId, { first, slugs }]) => ({
    playerId,
    elo: first.elo_before,
    mu: first.mu_before,
    sigma: first.sigma_before,
    matches: slugs.size,
  }));
}
