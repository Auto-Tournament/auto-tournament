/**
 * Rating Service
 * Handles OpenSkill rating calculations and Skill Rating conversions
 */

import { rating, type Rating } from 'openskill';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloTemplateService } from './eloTemplateService';
import type { PlayerStatLine } from './matchLiveStatsService';
import { settingsService } from './settingsService';
import {
  MAX_DISPLAY_ELO,
  MIN_DISPLAY_ELO,
  computeTeamRatingUpdate,
  eloToOpenSkill,
  openSkillToDisplayElo,
  ratingRollbacks,
  type RatingHistoryRow,
} from '../utils/ratingMath';

export { eloToOpenSkill, openSkillToDisplayElo };

/**
 * Undo a tournament's rating changes before its matches are deleted. The
 * history rows cascade away with the matches; the players' ratings did not,
 * so every reset run stacked on the last (QA 2.4.11: a player seeded at 1500
 * sat at 2163 with no history).
 */
export async function revertTournamentRatings(tournamentId: number): Promise<number> {
  const rows = await db.queryAsync<RatingHistoryRow>(
    `SELECT prh.id, prh.player_id, prh.match_slug, prh.elo_before, prh.mu_before,
            prh.sigma_before, prh.created_at
       FROM player_rating_history prh
       JOIN matches m ON m.slug = prh.match_slug
      WHERE m.tournament_id = ?`,
    [tournamentId]
  );
  const rollbacks = ratingRollbacks(rows);
  const now = Math.floor(Date.now() / 1000);
  for (const rb of rollbacks) {
    await db.runAsync(
      `UPDATE players
          SET current_elo = ?, openskill_mu = ?, openskill_sigma = ?,
              match_count = GREATEST(0, match_count - ?), updated_at = ?
        WHERE id = ?`,
      [rb.elo, rb.mu, rb.sigma, rb.matches, now, rb.playerId]
    );
  }
  if (rollbacks.length > 0) {
    log.info(`[RATINGS] Reverted tournament ${tournamentId} ratings for ${rollbacks.length} player(s)`);
  }
  return rollbacks.length;
}

/**
 * Update player ratings after a match
 * @param team1Players - Array of player IDs in team 1
 * @param team2Players - Array of player IDs in team 2
 * @param team1Won - Whether team 1 won the match
 * @param matchSlug - Match slug for history tracking
 */
export async function updatePlayerRatings(
  team1Players: string[],
  team2Players: string[],
  team1Won: boolean,
  matchSlug: string
): Promise<void> {
  try {
    // Optional global kill‑switch so admins can run tournaments with full
    // stats but keep their existing Excel/ratings system as the authority.
    const ratingsEnabled = await settingsService.areRatingsEnabled();
    if (!ratingsEnabled) {
      log.info('[RATINGS] Ratings update skipped because ratings_enabled=false', { matchSlug });
      return;
    }
    // Fetch all players with their current ratings
    const allPlayerIds = [...team1Players, ...team2Players];
    const players = await Promise.all(
      allPlayerIds.map(async (playerId) => {
        const player = await db.queryOneAsync<{
          id: string;
          current_elo: number;
          openskill_mu: number;
          openskill_sigma: number;
          match_count: number;
        }>(
          'SELECT id, current_elo, openskill_mu, openskill_sigma, match_count FROM players WHERE id = ?',
          [playerId]
        );
        if (!player) {
          throw new Error(`Player not found: ${playerId}`);
        }
        return player;
      })
    );

    // Separate into teams
    const team1PlayerData = players.filter((p) => team1Players.includes(p.id));
    const team2PlayerData = players.filter((p) => team2Players.includes(p.id));

    // Update using OpenSkill
    const toSkill = (p: { openskill_mu: number; openskill_sigma: number }) => ({
      mu: p.openskill_mu,
      sigma: p.openskill_sigma,
    });
    const [newTeam1Ratings, newTeam2Ratings] = computeTeamRatingUpdate(
      team1PlayerData.map(toSkill),
      team2PlayerData.map(toSkill),
      team1Won
    );

    // Get tournament's template ID (if any)
    const match = await db.queryOneAsync<{ tournament_id: number }>(
      'SELECT tournament_id FROM matches WHERE slug = ?',
      [matchSlug]
    );
    const tournament = match
      ? await db.queryOneAsync<{ elo_template_id: string | null }>(
          'SELECT elo_template_id FROM tournament WHERE id = ?',
          [match.tournament_id]
        )
      : null;
    const templateId = tournament?.elo_template_id || null;

    // Fetch player stats for stat-based adjustments
    const playerStatsMap = new Map<string, PlayerStatLine>();
    if (templateId) {
      const statsRecords = await db.queryAsync<{
        player_id: string;
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
      }>(
        'SELECT player_id, adr, total_damage, kills, deaths, assists, headshots, flash_assists, utility_damage, kast, mvps, score, rounds_played FROM player_match_stats WHERE match_slug = ?',
        [matchSlug]
      );

      for (const stat of statsRecords) {
        const roundsPlayed = stat.rounds_played || (stat.adr > 0 && stat.total_damage > 0 ? Math.round(stat.total_damage / stat.adr) : 0);
        playerStatsMap.set(stat.player_id, {
          steamId: stat.player_id,
          name: '', // Not needed for calculation
          kills: stat.kills || 0,
          deaths: stat.deaths || 0,
          assists: stat.assists || 0,
          flashAssists: stat.flash_assists || 0,
          headshotKills: stat.headshots || 0,
          damage: stat.total_damage || 0,
          utilityDamage: stat.utility_damage || 0,
          kast: stat.kast || 0,
          mvps: stat.mvps || 0,
          score: stat.score || 0,
          roundsPlayed: roundsPlayed,
        });
      }
    }

    // Combine all players and new ratings
    const allPlayers = [...team1PlayerData, ...team2PlayerData];
    const allNewRatings = [...newTeam1Ratings, ...newTeam2Ratings];

    // Update all players in database
    for (let i = 0; i < allPlayers.length; i++) {
      const player = allPlayers[i];
      const newRating = allNewRatings[i];

      // Convert back to "ELO" for storage/display (base ELO from OpenSkill),
      // then apply stat-based adjustments with additional guard rails.
      const baseElo = openSkillToDisplayElo(newRating);

      // Apply stat-based adjustments if template is enabled
      const playerStats = playerStatsMap.get(player.id);
      let finalElo = baseElo;
      let statAdjustment = 0;
      let appliedTemplateId: string | null = null;

      if (templateId && playerStats) {
        const adjustmentResult = await eloTemplateService.applyTemplate(
          templateId,
          baseElo,
          playerStats
        );
        statAdjustment = adjustmentResult.adjustment;
        appliedTemplateId = adjustmentResult.templateId;

        // Clamp stat-based adjustments to a sane per‑match window so a single
        // outlier game cannot completely destroy a player's rating.
        const MAX_ABSOLUTE_ADJUSTMENT = 400; // ~2 divisions worth in one match
        if (Number.isFinite(statAdjustment)) {
          if (statAdjustment > MAX_ABSOLUTE_ADJUSTMENT) {
            statAdjustment = MAX_ABSOLUTE_ADJUSTMENT;
          } else if (statAdjustment < -MAX_ABSOLUTE_ADJUSTMENT) {
            statAdjustment = -MAX_ABSOLUTE_ADJUSTMENT;
          }
        } else {
          statAdjustment = 0;
        }

        finalElo = baseElo + statAdjustment;
      }

      // Final clamp on ELO after adjustments.
      if (!Number.isFinite(finalElo)) {
        finalElo = baseElo;
      }
      if (finalElo < MIN_DISPLAY_ELO) {
        finalElo = MIN_DISPLAY_ELO;
      } else if (finalElo > MAX_DISPLAY_ELO) {
        finalElo = MAX_DISPLAY_ELO;
      }

      // Store old values for history
      const oldElo = player.current_elo;
      const oldMu = player.openskill_mu;
      const oldSigma = player.openskill_sigma;

      // Update player with final ELO (base + adjustments)
      await db.updateAsync(
        'players',
        {
          current_elo: finalElo,
          openskill_mu: newRating.mu,
          openskill_sigma: newRating.sigma,
          match_count: player.match_count + 1,
          updated_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [player.id]
      );

      // Record rating history
      const matchResult = team1Players.includes(player.id)
        ? team1Won
          ? 'win'
          : 'loss'
        : team1Won
          ? 'loss'
          : 'win';

      await db.insertAsync('player_rating_history', {
        player_id: player.id,
        match_slug: matchSlug,
        elo_before: oldElo,
        elo_after: finalElo,
        elo_change: finalElo - oldElo,
        mu_before: oldMu,
        mu_after: newRating.mu,
        sigma_before: oldSigma,
        sigma_after: newRating.sigma,
        base_elo_after: baseElo,
        stat_adjustment: statAdjustment,
        template_id: appliedTemplateId,
        match_result: matchResult,
        created_at: Math.floor(Date.now() / 1000),
      });

      log.debug(`Updated rating for player ${player.id}`, {
        oldElo,
        baseElo,
        statAdjustment,
        finalElo,
        eloChange: finalElo - oldElo,
        matchResult,
        templateId: appliedTemplateId,
      });
    }

    log.success(`Updated ratings for ${allPlayers.length} players after match ${matchSlug}`);
  } catch (error) {
    log.error('Error updating player ratings', { error, matchSlug });
    throw error;
  }
}

/**
 * Get player's current rating
 * @param playerId - Player Steam ID
 * @returns OpenSkill Rating object
 */
export async function getPlayerRating(playerId: string): Promise<Rating | null> {
  const player = await db.queryOneAsync<{
    openskill_mu: number;
    openskill_sigma: number;
  }>('SELECT openskill_mu, openskill_sigma FROM players WHERE id = ?', [playerId]);

  if (!player) {
    return null;
  }

  return rating({ mu: player.openskill_mu, sigma: player.openskill_sigma });
}

/**
 * Get player's display ELO (converted from OpenSkill)
 * @param playerId - Player Steam ID
 * @returns Display ELO number
 */
export async function getDisplayElo(playerId: string): Promise<number | null> {
  const rating = await getPlayerRating(playerId);
  if (!rating) {
    return null;
  }
  return openSkillToDisplayElo(rating);
}

/**
 * Get player's rating history
 * @param playerId - Player Steam ID
 * @param tournamentId - Optional tournament ID to filter by
 * @returns Array of rating history entries
 */
export async function getRatingHistory(
  playerId: string,
  tournamentId?: number
): Promise<
  Array<{
    match_slug: string;
    elo_before: number;
    elo_after: number;
    elo_change: number;
    mu_before: number;
    mu_after: number;
    sigma_before: number;
    sigma_after: number;
    base_elo_after: number | null;
    stat_adjustment: number | null;
    template_id: string | null;
    match_result: string;
    created_at: number;
  }>
> {
  // Deduplicate by match_slug so that transient or historical duplicate history
  // rows (e.g. from earlier bugs or retries) do not show up as multiple rating
  // changes for the same match in the UI. We keep the most recent entry per
  // (player_id, match_slug), optionally scoped to a single tournament.
  let query = `
    SELECT 
      prh.match_slug,
      prh.elo_before,
      prh.elo_after,
      prh.elo_change,
      prh.mu_before,
      prh.mu_after,
      prh.sigma_before,
      prh.sigma_after,
      prh.base_elo_after,
      prh.stat_adjustment,
      prh.template_id,
      prh.match_result,
      prh.created_at
    FROM player_rating_history prh
    JOIN (
      SELECT match_slug, MAX(created_at) AS max_created_at
    FROM player_rating_history
    WHERE player_id = ?
  `;

  const params: unknown[] = [playerId];

  if (tournamentId) {
    query += `
        AND match_slug IN (
      SELECT slug FROM matches WHERE tournament_id = ?
        )
    `;
    params.push(tournamentId);
  }

  query += `
      GROUP BY match_slug
    ) latest
      ON prh.match_slug = latest.match_slug
     AND prh.created_at = latest.max_created_at
    WHERE prh.player_id = ?
    ORDER BY prh.created_at DESC
  `;

  params.push(playerId);

  return await db.queryAsync(query, params);
}

