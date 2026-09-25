/**
 * Rating Service
 * Handles OpenSkill rating calculations and Skill Rating conversions
 */

import { rating, type Rating } from 'openskill';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { eloTemplateService } from './eloTemplateService';
import { integrationForMatch } from '../integrations/registry';
import type { StatsSchema } from '../integrations/types';
import type { DbTournamentRow } from '../types/database.types';
import { toIntegrationTournament } from '../utils/matchIntegration';
import { tournamentRowToResponse } from '../utils/tournamentRow';
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
 * Reset only ("play it again"): undo a tournament's rating changes and remove
 * that run's history, before its matches are deleted. Without the rollback
 * every reset run stacked on the last (QA 2.4.11: a player seeded at 1500 sat
 * at 2163). Deleting a tournament does NOT call this: ratings and history stay,
 * the history rows just lose their match link (ON DELETE SET NULL).
 */
export async function discardTournamentRatings(tournamentId: number): Promise<number> {
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
  await db.runAsync(
    `DELETE FROM player_rating_history
      WHERE match_slug IN (SELECT slug FROM matches WHERE tournament_id = ?)`,
    [tournamentId]
  );
  if (rollbacks.length > 0) {
    log.info(`[RATINGS] Reverted tournament ${tournamentId} ratings for ${rollbacks.length} player(s)`);
  }
  return rollbacks.length;
}

/**
 * Undo one match's rating changes and remove its history rows (3.0 phase D).
 *
 * `discardTournamentRatings` above does this for a whole run before its
 * matches are deleted; this is the same rollback for a single match that is
 * being reopened, so the replacement result can be rated from where the
 * players actually stood.
 *
 * It refuses unless this match is the **last** rated match for every player it
 * touched. The rollback restores each player to the `*_before` values this
 * match recorded, which is only their true standing when nothing has rated
 * them since; a later match would be silently undone too. The manual-report
 * reopen guard ("nothing downstream has completed") usually means that, but a
 * player may have played elsewhere, so it is checked rather than assumed.
 *
 * Returns the number of players rolled back, or `null` when it refused.
 */
export async function discardMatchRatings(matchSlug: string): Promise<number | null> {
  const rows = await db.queryAsync<RatingHistoryRow>(
    `SELECT id, player_id, match_slug, elo_before, mu_before, sigma_before, created_at
       FROM player_rating_history
      WHERE match_slug = ?`,
    [matchSlug]
  );
  if (rows.length === 0) return 0;

  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const later = await db.queryOneAsync<{ count: number | string }>(
    `SELECT COUNT(*) as count
       FROM player_rating_history
      WHERE player_id = ANY(?::text[])
        AND match_slug IS DISTINCT FROM ?
        AND created_at >= (SELECT MIN(created_at) FROM player_rating_history WHERE match_slug = ?)`,
    [playerIds, matchSlug, matchSlug]
  );
  if (later && Number(later.count) > 0) {
    log.warn(
      `[RATINGS] Refusing to discard ${matchSlug}: a player has been rated since, so the rollback would undo that too`,
      { matchSlug, players: playerIds.length }
    );
    return null;
  }

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
  await db.runAsync('DELETE FROM player_rating_history WHERE match_slug = ?', [matchSlug]);
  log.info(`[RATINGS] Reverted ${matchSlug} for ${rollbacks.length} player(s)`);
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
    // Labels are copied onto the history rows: they outlive the match when the
    // tournament is deleted.
    const match = await db.queryOneAsync<{
      tournament_id: number;
      game: string | null;
      match_label: string | null;
    }>(
      `SELECT m.tournament_id, m.game, t1.name || ' vs ' || t2.name AS match_label
         FROM matches m
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE m.slug = ?`,
      [matchSlug]
    );
    const tournament = match
      ? await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
          match.tournament_id,
        ])
      : null;
    const templateId = tournament?.elo_template_id || null;

    // Fetch player metrics for stat-based adjustments. The match's integration
    // reads them from its stored stats (`playerStatsMetrics`) and names them
    // (`statsSchema`); the template weights them by metric key.
    const playerMetrics = new Map<string, Record<string, number>>();
    let statsSchema: StatsSchema = { metrics: [] };
    if (templateId && tournament) {
      const integration = integrationForMatch({ game: match?.game });
      statsSchema = integration.statsSchema(
        toIntegrationTournament(tournamentRowToResponse(tournament))
      );
      if (integration.playerStatsMetrics) {
        const statsRecords = await db.queryAsync<Record<string, unknown> & { player_id: string }>(
          'SELECT * FROM player_match_stats WHERE match_slug = ?',
          [matchSlug]
        );
        for (const stat of statsRecords) {
          playerMetrics.set(stat.player_id, integration.playerStatsMetrics(stat));
        }
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
      const metrics = playerMetrics.get(player.id);
      let finalElo = baseElo;
      let statAdjustment = 0;
      let appliedTemplateId: string | null = null;

      if (templateId && metrics) {
        const adjustmentResult = await eloTemplateService.applyTemplate(
          templateId,
          baseElo,
          metrics,
          statsSchema
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
        match_label: match?.match_label ?? matchSlug,
        tournament_name: tournament?.name ?? null,
        game: match?.game ?? null,
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
    /** NULL when the match (and its tournament) was deleted; use match_label. */
    match_slug: string | null;
    match_label: string | null;
    tournament_name: string | null;
    /**
     * The match's game. Kept on the row, so it survives the match; for rows
     * written before the column existed it is read from the match while that
     * is still there, and is null after.
     */
    game: string | null;
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
  // One row per match: duplicate history rows (earlier bugs or retries) would
  // otherwise show as several rating changes for the same match. The newest
  // row wins. Rows of deleted tournaments have no slug and are kept as-is.
  const params: unknown[] = [playerId];
  let tournamentFilter = '';
  if (tournamentId) {
    tournamentFilter = 'AND match_slug IN (SELECT slug FROM matches WHERE tournament_id = ?)';
    params.push(tournamentId);
  }

  return await db.queryAsync(
    `SELECT latest.match_slug, latest.match_label, latest.tournament_name,
            COALESCE(latest.game, m.game) AS game,
            latest.elo_before, latest.elo_after, latest.elo_change,
            latest.mu_before, latest.mu_after, latest.sigma_before, latest.sigma_after,
            latest.base_elo_after, latest.stat_adjustment,
            latest.template_id, latest.match_result, latest.created_at
       FROM (
         SELECT DISTINCT ON (COALESCE(match_slug, 'deleted:' || id)) *
           FROM player_rating_history
          WHERE player_id = ? ${tournamentFilter}
          ORDER BY COALESCE(match_slug, 'deleted:' || id), created_at DESC, id DESC
       ) latest
       LEFT JOIN matches m ON m.slug = latest.match_slug
      ORDER BY latest.created_at DESC, latest.id DESC`,
    params
  );
}

