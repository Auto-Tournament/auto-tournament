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
export async function enrichMatchWithPlayerStats(match: EnrichableMatch | BracketMatch, matchSlug: string): Promise<void> {
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
export async function enrichMatchWithScores(match: EnrichableMatch | BracketMatch, matchSlug: string): Promise<void> {
  const scoreEvent = await db.queryOneAsync<DbEventRow>(
    `SELECT event_data FROM match_events 
     WHERE match_slug = ? AND event_type IN ('series_end', 'round_end', 'map_end') 
     ORDER BY received_at DESC LIMIT 1`,
    [matchSlug]
  );

  if (scoreEvent) {
    try {
      const eventData = JSON.parse(scoreEvent.event_data);
      if (eventData.team1_series_score !== undefined) {
        match.team1Score = eventData.team1_series_score;
      }
      if (eventData.team2_series_score !== undefined) {
        match.team2Score = eventData.team2_series_score;
      }
    } catch {
      // Ignore parse errors
    }
  }
}

/**
 * Enriches a match with both player stats and scores
 */
export async function enrichMatch(match: EnrichableMatch | BracketMatch, matchSlug: string): Promise<void> {
  await enrichMatchWithPlayerStats(match, matchSlug);
  await enrichMatchWithScores(match, matchSlug);
}
