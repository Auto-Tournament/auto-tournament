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

type MapResultLike = {
  team1Score: number;
  team2Score: number;
  winnerTeam?: 'team1' | 'team2' | 'none' | null;
};

type LiveStatsLike = {
  team1Score: number;
  team2Score: number;
  team1SeriesScore: number;
  team2SeriesScore: number;
  status?: string;
};

export type ScoreFieldsTarget = {
  team1Score?: number;
  team2Score?: number;
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  team1MapScore?: number | null;
  team2MapScore?: number | null;
};

/**
 * Maps won per side from persisted map results. An explicit winnerTeam wins
 * over the round score so a 12-12 map decided by the damage tiebreak counts.
 */
export function countMapWins(mapResults: MapResultLike[]): { team1: number; team2: number } {
  return mapResults.reduce(
    (acc, r) => {
      if (r.winnerTeam === 'team1') acc.team1 += 1;
      else if (r.winnerTeam === 'team2') acc.team2 += 1;
      else if (r.winnerTeam !== 'none') {
        if (r.team1Score > r.team2Score) acc.team1 += 1;
        else if (r.team2Score > r.team1Score) acc.team2 += 1;
      }
      return acc;
    },
    { team1: 0, team2: 0 }
  );
}

/**
 * Normalise the score fields on a match/bracket item so each field means one
 * thing for both sides. (The old overlay mixed a positive series score on one
 * side with the round score on the other, e.g. "23 vs 1".)
 *
 * - team1SeriesScore/team2SeriesScore: maps won, always set.
 * - team1MapScore/team2MapScore: rounds on the map being played, 0-0 while the
 *   current map is still in warmup; once completed, rounds on the last map
 *   played (null when no map results are stored).
 * - team1Score/team2Score: the headline score. Maps won once the match is
 *   completed; the current map's rounds while in progress (unset until live
 *   stats exist).
 */
export function applyScoreFields(
  match: ScoreFieldsTarget,
  opts: {
    status: string;
    mapResults?: MapResultLike[] | null;
    liveStats?: LiveStatsLike | null;
  }
): void {
  const { status, mapResults, liveStats } = opts;
  const fromResults =
    Array.isArray(mapResults) && mapResults.length > 0 ? countMapWins(mapResults) : null;

  if (status === 'completed') {
    const hasHeadline =
      typeof match.team1Score === 'number' &&
      typeof match.team2Score === 'number' &&
      !(match.team1Score === 0 && match.team2Score === 0);
    if (!hasHeadline && fromResults && (fromResults.team1 > 0 || fromResults.team2 > 0)) {
      match.team1Score = fromResults.team1;
      match.team2Score = fromResults.team2;
    }
    match.team1SeriesScore =
      typeof match.team1Score === 'number' ? match.team1Score : fromResults?.team1 ?? 0;
    match.team2SeriesScore =
      typeof match.team2Score === 'number' ? match.team2Score : fromResults?.team2 ?? 0;
    // Rounds on the last map played, so a finished BO1 still reports its
    // map score (13-7) next to the series score (1-0).
    const lastMap = fromResults ? mapResults![mapResults!.length - 1] : null;
    match.team1MapScore = lastMap ? lastMap.team1Score : null;
    match.team2MapScore = lastMap ? lastMap.team2Score : null;
    return;
  }

  match.team1SeriesScore = Math.max(fromResults?.team1 ?? 0, liveStats?.team1SeriesScore ?? 0);
  match.team2SeriesScore = Math.max(fromResults?.team2 ?? 0, liveStats?.team2SeriesScore ?? 0);

  if (liveStats) {
    // Between maps the live stats keep the finished map's rounds until the
    // next map goes live; that score does not belong to the current map.
    const inWarmup = liveStats.status === 'warmup';
    match.team1MapScore = inWarmup ? 0 : liveStats.team1Score ?? 0;
    match.team2MapScore = inWarmup ? 0 : liveStats.team2Score ?? 0;
    match.team1Score = match.team1MapScore;
    match.team2Score = match.team2MapScore;
  } else {
    match.team1MapScore = null;
    match.team2MapScore = null;
    delete match.team1Score;
    delete match.team2Score;
  }
}
