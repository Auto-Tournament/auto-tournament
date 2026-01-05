/**
 * Match enrichment utilities - adds player stats and scores to match objects
 * Shared between routes and services to avoid duplication
 */

import { db } from '../config/database';
import type { DbEventRow } from '../types/database.types';
import type { EnrichableMatch } from '../types/match.types';
import type { BracketMatch } from '../types/tournament.types';

/**
 * Enriches a match object with player stats from match events
 */
export async function enrichMatchWithPlayerStats(
  match: EnrichableMatch | BracketMatch,
  matchSlug: string
): Promise<void> {
  const playerStatsEvent = await db.queryOneAsync<DbEventRow>(
    `SELECT event_data FROM match_events 
     WHERE match_slug = ? AND event_type = 'player_stats' 
     ORDER BY received_at DESC LIMIT 1`,
    [matchSlug]
  );

  if (playerStatsEvent) {
    try {
      const eventData = JSON.parse(playerStatsEvent.event_data);
      if (eventData.team1_players) {
        match.team1Players = eventData.team1_players;
      }
      if (eventData.team2_players) {
        match.team2Players = eventData.team2_players;
      }
    } catch {
      // Ignore parse errors
    }
  }
}

/**
 * Enriches a match object with scores from match events
 */
export async function enrichMatchWithScores(
  match: EnrichableMatch | BracketMatch,
  matchSlug: string
): Promise<void> {
  const scoreEvent = await db.queryOneAsync<DbEventRow>(
    `SELECT event_data FROM match_events 
     WHERE match_slug = ? AND event_type IN ('series_end', 'round_end', 'map_end') 
     ORDER BY received_at DESC LIMIT 1`,
    [matchSlug]
  );

  if (scoreEvent) {
    try {
      const eventData = JSON.parse(scoreEvent.event_data) as
        | {
            team1_series_score?: number;
            team2_series_score?: number;
            team1?: { series_score?: number };
            team2?: { series_score?: number };
          }
        | Record<string, unknown>;

      const team1Series =
        typeof (eventData as { team1_series_score?: unknown }).team1_series_score === 'number'
          ? (eventData as { team1_series_score: number }).team1_series_score
          : typeof (eventData as { team1?: { series_score?: unknown } }).team1?.series_score ===
            'number'
          ? ((eventData as { team1: { series_score: number } }).team1.series_score as number)
          : undefined;

      const team2Series =
        typeof (eventData as { team2_series_score?: unknown }).team2_series_score === 'number'
          ? (eventData as { team2_series_score: number }).team2_series_score
          : typeof (eventData as { team2?: { series_score?: unknown } }).team2?.series_score ===
            'number'
          ? ((eventData as { team2: { series_score: number } }).team2.series_score as number)
          : undefined;

      if (team1Series !== undefined) {
        match.team1Score = team1Series;
      }
      if (team2Series !== undefined) {
        match.team2Score = team2Series;
      }
    } catch {
      // Ignore parse errors – we'll fall back to map results below if needed
    }
  }

  // If we still don't have series scores, derive them from persisted map results.
  if (match.team1Score === undefined && match.team2Score === undefined) {
    const rows = await db.queryAsync<{
      team1_score: number;
      team2_score: number;
    }>('SELECT team1_score, team2_score FROM match_map_results WHERE match_slug = ?', [matchSlug]);

    if (rows.length > 0) {
      let team1MapsWon = 0;
      let team2MapsWon = 0;
      for (const row of rows) {
        if (row.team1_score > row.team2_score) {
          team1MapsWon += 1;
        } else if (row.team2_score > row.team1_score) {
          team2MapsWon += 1;
        }
      }
      match.team1Score = team1MapsWon;
      match.team2Score = team2MapsWon;
    }
  }

  // BO1 safety net for completed matches:
  // If we still don't have a meaningful series score (missing or 0‑0) but we
  // DO know the winner and the config explicitly says this is a single‑map
  // series (num_maps = 1), treat the series score as 1–0 in favour of the
  // winner. This prevents bracket/list views from showing "0–0" with a
  // highlighted winner when map_results or series_end events are missing or
  // incomplete (common in simulated games or abrupt server stops).
  const anyMatch = match as EnrichableMatch & BracketMatch & { status?: string };
  if (
    anyMatch.status === 'completed' &&
    (
      match.team1Score === undefined ||
      match.team2Score === undefined ||
      ((match.team1Score ?? 0) === 0 && (match.team2Score ?? 0) === 0)
    ) &&
    anyMatch.winner?.id &&
    anyMatch.team1?.id &&
    anyMatch.team2?.id &&
    typeof (match as { config?: { num_maps?: unknown } }).config?.num_maps === 'number' &&
    (match as { config: { num_maps: number } }).config.num_maps === 1
  ) {
    const winnerId = anyMatch.winner.id;
    const team1Id = anyMatch.team1.id;
    const team2Id = anyMatch.team2.id;

    if (winnerId === team1Id) {
      match.team1Score = 1;
      match.team2Score = 0;
    } else if (winnerId === team2Id) {
      match.team1Score = 0;
      match.team2Score = 1;
    }
  }
}

/**
 * Enriches a match with both player stats and scores
 */
export async function enrichMatch(
  match: EnrichableMatch | BracketMatch,
  matchSlug: string
): Promise<void> {
  await enrichMatchWithPlayerStats(match, matchSlug);
  await enrichMatchWithScores(match, matchSlug);
}
