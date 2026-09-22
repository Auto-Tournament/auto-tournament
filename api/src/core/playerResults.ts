/**
 * What a finished series writes per player: `player_match_stats` rows and,
 * for decisive results, rating changes. Called by the match lifecycle
 * (`./matchLifecycle`) once a series result has been applied.
 *
 * Player stats come from the match's integration (`seriesPlayerStats`) as
 * stat lines; each rostered player's line is written with the integration's
 * columns (`playerStatsColumns`) next to the core ones. A game without player
 * stats still gets one row per rostered player, carrying only `won_match`, so
 * match history and standings work the same for it.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { updatePlayerRatings } from '../services/ratingService';
import { teamService } from '../services/teamService';
import { describeMatch } from '../utils/matchIntegration';
import { integrationForMatch } from '../integrations/registry';
import type { GameIntegration, PlayerStatLine, ReportedStatLine } from '../integrations/types';
import type { DbMatchRow } from '../types/database.types';
import type { Player } from '../types/team.types';

/**
 * Update player ratings for matches (all tournament types with players)
 */
export async function updateRatingsForMatch(
  match: DbMatchRow,
  winnerId: string,
  matchSlug: string
): Promise<void> {
  try {
    // Idempotency guard: if ratings have already been recorded for this match,
    // skip re-applying them. Some MatchZy setups can emit duplicate
    // series_end/finalization events for the same match, and we only ever want
    // to apply rating changes once per matchSlug.
    const existingHistory = await db.queryOneAsync<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM player_rating_history WHERE match_slug = ?',
      [matchSlug]
    );
    if (existingHistory && Number(existingHistory.count) > 0) {
      log.warn('Skipping duplicate rating update for match; history already exists', {
        matchSlug,
      });
      return;
    }

    if (!match.team1_id || !match.team2_id) {
      log.warn('Cannot update ratings: missing team IDs', { matchSlug });
      return;
    }

    // Get teams and extract player Steam IDs
    const team1 = await teamService.getTeamById(match.team1_id);
    const team2 = await teamService.getTeamById(match.team2_id);

    if (!team1 || !team2) {
      log.warn('Cannot update ratings: teams not found', {
        matchSlug,
        team1_id: match.team1_id,
        team2_id: match.team2_id,
      });
      return;
    }

    const team1PlayerIds = team1.players.map((p: Player) => p.steamId);
    const team2PlayerIds = team2.players.map((p: Player) => p.steamId);

    if (team1PlayerIds.length === 0 || team2PlayerIds.length === 0) {
      log.warn('Cannot update ratings: teams have no players', { matchSlug });
      return;
    }

    // Determine which team won
    const team1Won = match.team1_id === winnerId;

    // Update ratings using OpenSkill
    await updatePlayerRatings(team1PlayerIds, team2PlayerIds, team1Won, matchSlug);

    log.success(`Updated ratings for match ${matchSlug}`);
  } catch (error) {
    log.error('Error updating ratings for match', { error, matchSlug });
    // Don't throw - rating update failure shouldn't break match completion
  }
}

/** The integration's stat lines for the series, or none when it records none. */
async function seriesStatsFor(
  integration: GameIntegration,
  matchSlug: string
): Promise<ReportedStatLine[]> {
  if (!integration.capabilities.playerStats || !integration.seriesPlayerStats) {
    return [];
  }
  return integration.seriesPlayerStats(matchSlug);
}

/**
 * Core helper to persist player_match_stats rows for a given set of players.
 * Used by both bracket/tournament matches (team service) and manual matches
 * (players taken from the stored match config).
 */
async function persistPlayerMatchStats(options: {
  match: DbMatchRow;
  matchSlug: string;
  team1Players: Array<{ steamId: string }>;
  team2Players: Array<{ steamId: string }>;
  /**
   * Match result from the perspective of the series:
   *  - 'team1' -> team1 win
   *  - 'team2' -> team2 win
   *  - 'draw'  -> true tie (no winner)
   */
  result: 'team1' | 'team2' | 'draw';
}): Promise<void> {
  const { match, matchSlug, team1Players, team2Players, result } = options;

  const integration = integrationForMatch(match);
  const reported = await seriesStatsFor(integration, matchSlug);

  const now = Math.floor(Date.now() / 1000);

  // Look players up by account id, not by which side the game filed them
  // under. MatchZy has shipped payloads that list team2's players inside the
  // `team1` block, which made every one of those players land on 0 kills /
  // 0 damage / 0.0 ADR in their match history. Matching on the id is correct
  // either way. A later line for the same account wins.
  const reportedById = new Map<string, ReportedStatLine>();
  for (const line of reported) {
    const id = line.account.externalId;
    if (id) reportedById.set(id.toLowerCase(), line);
  }

  // The rostered player's line: roster side and series result, with the
  // metrics the game reported for them (none when it reported nothing).
  const lineFor = (steamId: string, team: 'team1' | 'team2'): PlayerStatLine => {
    const found = reportedById.get((steamId || '').toLowerCase());
    return {
      account: found?.account ?? { provider: 'steam', externalId: steamId },
      name: found?.name ?? '',
      team,
      won: result === team,
      metrics: found?.metrics ?? {},
    };
  };

  const insertRow = async (steamId: string, line: PlayerStatLine): Promise<void> => {
    await db.insertAsync('player_match_stats', {
      player_id: steamId,
      match_slug: matchSlug,
      team: line.team,
      won_match: line.won,
      ...(integration.playerStatsColumns?.(line.metrics) ?? {}),
      created_at: now,
    });
  };

  for (const player of team1Players) {
    await insertRow(player.steamId, lineFor(player.steamId, 'team1'));
  }
  for (const player of team2Players) {
    await insertRow(player.steamId, lineFor(player.steamId, 'team2'));
  }

  log.debug(`Tracked player stats for ${team1Players.length + team2Players.length} players`, {
    matchSlug,
  });
}

/**
 * Track individual player stats for matches (all tournament types with players)
 * using persistent team records.
 */
export async function trackPlayerStatsForMatch(
  match: DbMatchRow,
  winnerId: string | null,
  matchSlug: string
): Promise<void> {
  try {
    if (!match.team1_id || !match.team2_id) {
      log.warn('Cannot track player stats: missing team IDs', { matchSlug });
      return;
    }

    // Get teams
    const team1 = await teamService.getTeamById(match.team1_id);
    const team2 = await teamService.getTeamById(match.team2_id);

    if (!team1 || !team2) {
      log.warn('Cannot track player stats: teams not found', { matchSlug });
      return;
    }

    // Determine match result for stats purposes. When winnerId is null (true
    // draw), both teams will have won_match = false in player_match_stats.
    let result: 'team1' | 'team2' | 'draw';
    if (!winnerId) {
      result = 'draw';
    } else if (match.team1_id === winnerId) {
      result = 'team1';
    } else {
      result = 'team2';
    }

    await persistPlayerMatchStats({
      match,
      matchSlug,
      team1Players: team1.players as Array<{ steamId: string }>,
      team2Players: team2.players as Array<{ steamId: string }>,
      result,
    });
  } catch (error) {
    log.error('Error tracking player stats for match', { error, matchSlug });
    // Don't throw - stats tracking failure shouldn't break match completion
  }
}

/**
 * Track stats for manual matches (round = 0) whose teams may only exist inside
 * the stored config (ad‑hoc teams). The integration reads the roster from its
 * config (`standaloneRoster`); without that hook, `describeMatch` does.
 */
export async function trackPlayerStatsForManualMatch(
  match: DbMatchRow,
  matchSlug: string,
  team1SeriesScore: number,
  team2SeriesScore: number
): Promise<void> {
  try {
    if (!match.config) {
      log.warn('Cannot track manual match stats: missing config', { matchSlug });
      return;
    }

    const integration = integrationForMatch(match);
    let roster: { team1: string[]; team2: string[] } | null;
    if (integration.standaloneRoster) {
      roster = integration.standaloneRoster(match.config);
    } else {
      const description = describeMatch(match);
      roster = {
        team1: description.team1.players.map((p) => p.account.externalId),
        team2: description.team2.players.map((p) => p.account.externalId),
      };
    }
    if (!roster) {
      log.warn('Failed to parse manual match config for stats', { matchSlug });
      return;
    }

    const team1Players = roster.team1.map((steamId) => ({ steamId }));
    const team2Players = roster.team2.map((steamId) => ({ steamId }));

    if (team1Players.length === 0 && team2Players.length === 0) {
      log.warn('Cannot track manual match stats: no players found in config', { matchSlug });
      return;
    }

    let result: 'team1' | 'team2' | 'draw';
    if (team1SeriesScore > team2SeriesScore) {
      result = 'team1';
    } else if (team2SeriesScore > team1SeriesScore) {
      result = 'team2';
    } else {
      result = 'draw';
    }

    await persistPlayerMatchStats({
      match,
      matchSlug,
      team1Players,
      team2Players,
      result,
    });
  } catch (error) {
    log.error('Error tracking player stats for manual match', { error, matchSlug });
  }
}
