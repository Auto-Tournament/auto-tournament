/**
 * Rating Service
 * Handles OpenSkill rating calculations and ELO conversions
 */

import { rating, rate, ordinal, type Rating } from 'openskill';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloTemplateService } from './eloTemplateService';
import type { PlayerStatLine } from './matchLiveStatsService';

// Conversion constants (Option 3: Direct Mapping from integration doc)
const ELO_OFFSET = 500;
const ELO_SCALE = 100;
const DEFAULT_SIGMA = 8.333;

/**
 * Convert admin's "ELO" input to OpenSkill rating
 * @param elo - Admin-facing ELO number (default: 3000)
 * @param matchCount - Number of matches played (for sigma adjustment)
 * @returns OpenSkill Rating object
 */
export function eloToOpenSkill(elo: number, matchCount: number = 0): Rating {
  // Direct mapping: 3000 ELO = 25 mu (OpenSkill default)
  const mu = (elo - ELO_OFFSET) / ELO_SCALE;

  // Sigma decreases with experience
  // New: 8.33, After 10 matches: 6.0, After 30: 4.0, Min: 2.0
  const sigma = Math.max(2.0, DEFAULT_SIGMA - Math.min(matchCount * 0.2, 6.33));

  return rating({ mu, sigma });
}

/**
 * Convert OpenSkill rating back to "ELO" for display
 * Uses ordinal() which returns mu - 3*sigma (conservative estimate)
 * @param rating - OpenSkill Rating object
 * @returns Display ELO number
 */
export function openSkillToDisplayElo(rating: Rating): number {
  const ordinalValue = ordinal(rating);
  return Math.round(ordinalValue * ELO_SCALE + ELO_OFFSET);
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

    // Convert to OpenSkill ratings
    const team1Ratings = team1PlayerData.map((p) =>
      rating({ mu: p.openskill_mu, sigma: p.openskill_sigma })
    );
    const team2Ratings = team2PlayerData.map((p) =>
      rating({ mu: p.openskill_mu, sigma: p.openskill_sigma })
    );

    // Update using OpenSkill
    const teams = [team1Ratings, team2Ratings];
    const ranks = team1Won ? [1, 2] : [2, 1]; // Lower rank = better (win)
    const [newTeam1Ratings, newTeam2Ratings] = rate(teams, { rank: ranks });

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

      // Convert back to "ELO" for storage/display (base ELO from OpenSkill)
      const baseElo = openSkillToDisplayElo(newRating);

      // Apply stat-based adjustments if template is enabled
      const playerStats = playerStatsMap.get(player.id);
      let finalElo = baseElo;
      let statAdjustment = 0;
      let appliedTemplateId: string | null = null;

      if (templateId && playerStats) {
        const adjustmentResult = await eloTemplateService.applyTemplate(templateId, baseElo, playerStats);
        statAdjustment = adjustmentResult.adjustment;
        appliedTemplateId = adjustmentResult.templateId;
        finalElo = baseElo + statAdjustment;
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
    match_result: string;
    created_at: number;
  }>
> {
  let query = `
    SELECT 
      match_slug,
      elo_before,
      elo_after,
      elo_change,
      mu_before,
      mu_after,
      sigma_before,
      sigma_after,
      match_result,
      created_at
    FROM player_rating_history
    WHERE player_id = ?
  `;
  const params: unknown[] = [playerId];

  if (tournamentId) {
    query += ` AND match_slug IN (
      SELECT slug FROM matches WHERE tournament_id = ?
    )`;
    params.push(tournamentId);
  }

  query += ' ORDER BY created_at DESC';

  return await db.queryAsync(query, params);
}

