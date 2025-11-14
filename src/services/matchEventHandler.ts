/**
 * Match Event Handler Service
 * Handles processing of MatchZy webhook events
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitMatchUpdate, emitBracketUpdate } from './socketService';
import { playerConnectionService } from './playerConnectionService';
import { matchLiveStatsService, type MatchLiveStats } from './matchLiveStatsService';
import type { MatchZyEvent } from '../types/matchzy-events.types';
import type { DbMatchRow } from '../types/database.types';
import {
  advanceWinnerToNextMatch,
  advanceLoserToLosersBracket,
  checkTournamentCompletion,
} from '../utils/matchProgression';

/**
 * Main event handler - routes events to specific handlers
 */
export function handleMatchEvent(event: MatchZyEvent): void {
  // Use type assertion to access event-specific properties
  const eventData = event as unknown as Record<string, unknown>;

  switch (event.event) {
    // Match Lifecycle Events
    case 'series_start':
      log.success(`Series started: ${eventData.team1_name} vs ${eventData.team2_name}`, {
        matchId: event.matchid,
        format: `BO${eventData.num_maps}`,
      });
      break;

    case 'map_picked':
      log.info(`Map picked: ${eventData.map_name} (Map ${eventData.map_number})`, {
        matchId: event.matchid,
        pickedBy: eventData.picked_by,
      });
      break;

    case 'map_vetoed':
      log.info(`Map vetoed: ${eventData.map_name}`, {
        matchId: event.matchid,
        vetoedBy: eventData.vetoed_by,
      });
      break;

    case 'side_picked':
      log.info(`${eventData.team} picked side ${eventData.side} for map ${eventData.map_number}`, {
        matchId: event.matchid,
      });
      break;

    case 'map_result':
      log.success(
        `Map ${eventData.map_number} result: ${eventData.team1_name} ${eventData.team1_score}-${eventData.team2_score} ${eventData.team2_name}`,
        {
          matchId: event.matchid,
          map: eventData.map_name,
          winner: (eventData.winner as { name?: string })?.name,
        }
      );
      {
        const match = resolveMatch(event.matchid);
        if (match) {
          updateLiveStats(match, parseScorePayload(eventData, 'postgame'));
        }
      }
      break;

    case 'series_end':
      handleSeriesEnd(event);
      break;

    // Map Events
    case 'going_live': {
      log.success(`Going live: Map ${eventData.map_number} - ${eventData.map_name}`, {
        matchId: event.matchid,
        team1: eventData.team1_name,
        team2: eventData.team2_name,
      });
      const liveMatch = resolveMatch(event.matchid);
      if (liveMatch) {
        updateMatchStatus(liveMatch, 'live');
        playerConnectionService.markAllReady(liveMatch.slug);
        updateLiveStats(liveMatch, parseScorePayload(eventData, 'live'));
      } else {
        log.warn(`Going live event received for unknown match`, { matchId: event.matchid });
      }
      break;
    }

    // Player connection events
    case 'player_connect': {
      const match = resolveMatch(event.matchid);
      const playerInfo = eventData.player as { steamid?: string; name?: string; team?: string };
      const steamId = playerInfo?.steamid;
      if (!match || !steamId) {
        log.warn('Player connect event received without match or steamId', {
          matchId: event.matchid,
        });
        break;
      }
      const team = determinePlayerTeam(match, steamId, playerInfo?.team);
      if (!team) {
        log.warn('Could not determine team for player_connect event', {
          matchId: event.matchid,
          steamId,
        });
        break;
      }
      playerConnectionService.playerConnected(match.slug, steamId, playerInfo?.name || 'Unknown', team);
      break;
    }

    case 'player_disconnect': {
      const match = resolveMatch(event.matchid);
      const steamId = (eventData.player as { steamid?: string })?.steamid;
      if (!match || !steamId) {
        log.warn('Player disconnect event received without match or steamId', {
          matchId: event.matchid,
        });
        break;
      }
      playerConnectionService.playerDisconnected(match.slug, steamId);
      break;
    }

    case 'player_ready':
    case 'player_unready': {
      const match = resolveMatch(event.matchid);
      const steamId = (eventData.player as { steamid?: string })?.steamid;
      if (!match || !steamId) {
        break;
      }
      playerConnectionService.playerReady(
        match.slug,
        steamId,
        event.event === 'player_ready'
      );
      break;
    }

    // Round Events
    case 'round_end': {
      log.debug(`Round ${eventData.round_number} won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
        reason: eventData.reason,
      });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, parseScorePayload(eventData, 'live'));
      }
      break;
    }

    case 'knife_round_started': {
      log.info(`Knife round started`, { matchId: event.matchid, mapNumber: eventData.map_number });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, { status: 'knife' });
      }
      break;
    }

    case 'knife_round_ended': {
      log.success(`Knife round won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, { status: 'warmup' });
      }
      break;
    }

    case 'round_started': {
      log.debug(`Round ${eventData.round_number} started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, parseScorePayload(eventData, 'live'));
      }
      break;
    }

    case 'halftime_started': {
      log.info(`Halftime started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, parseScorePayload(eventData, 'halftime'));
      }
      break;
    }

    case 'overtime_started': {
      log.success(`Overtime ${eventData.overtime_number} started!`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      const match = resolveMatch(event.matchid);
      if (match) {
        updateLiveStats(match, { status: 'live' });
      }
      break;
    }

    // Pause System Events
    case 'match_paused':
      log.warn(`Match paused by ${(eventData.paused_by as { name?: string })?.name}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        tactical: eventData.is_tactical,
        admin: eventData.is_admin,
      });
      break;

    case 'unpause_requested':
      log.info(`Unpause requested by ${eventData.team}`, {
        matchId: event.matchid,
        teamsReady: eventData.teams_ready,
        teamsNeeded: eventData.teams_needed,
      });
      break;

    case 'match_unpaused':
      log.success(`Match unpaused by ${(eventData.unpaused_by as { name?: string })?.name}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      break;

    default:
      log.debug(`Event: ${event.event}`, { matchId: event.matchid });
      break;
  }
}

function resolveMatch(identifier: string | number): DbMatchRow | null {
  const identifierStr = String(identifier);
  const numericId = Number(identifierStr);

  if (!Number.isNaN(numericId)) {
    const byId = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [numericId]);
    if (byId) {
      return byId;
    }
  }

  return db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [identifierStr]);
}

function updateMatchStatus(match: DbMatchRow, status: DbMatchRow['status']): void {
  if (match.status === status) {
    return;
  }

  db.update('matches', { status }, 'id = ?', [match.id]);
  const updatedMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [match.id]);
  if (updatedMatch) {
    emitMatchUpdate(updatedMatch);
    emitBracketUpdate({
      action: 'match_status',
      matchSlug: updatedMatch.slug,
      status: updatedMatch.status,
    });
  }
}

function determinePlayerTeam(
  match: DbMatchRow,
  steamId: string,
  fallbackTeam?: string
): 'team1' | 'team2' | null {
  if (fallbackTeam === 'team1' || fallbackTeam === 'team2') {
    return fallbackTeam;
  }

  if (!match.config) {
    return null;
  }

  try {
    const config = typeof match.config === 'string' ? JSON.parse(match.config) : match.config;
    const team1Players = config?.team1?.players;
    const team2Players = config?.team2?.players;
    if (team1Players && Object.prototype.hasOwnProperty.call(team1Players, steamId)) {
      return 'team1';
    }
    if (team2Players && Object.prototype.hasOwnProperty.call(team2Players, steamId)) {
      return 'team2';
    }
  } catch (error) {
    log.warn('Failed to parse match config when determining player team', {
      error,
      matchId: match.id,
    });
  }

  return null;
}

function updateLiveStats(match: DbMatchRow, updates: Partial<MatchLiveStats>): void {
  const stats = matchLiveStatsService.update(match.slug, updates);
  emitMatchUpdate({
    slug: match.slug,
    liveStats: stats,
  });
}

function parseScorePayload(
  eventData: Record<string, unknown>,
  status: MatchLiveStats['status']
): Partial<MatchLiveStats> {
  const updates: Partial<MatchLiveStats> = { status };
  const mapNumber = parseNumber(eventData.map_number);
  const roundNumber = parseNumber(eventData.round_number);
  const team1Score =
    parseNumber(eventData.team1_score) ??
    parseNumber((eventData.team1 as Record<string, unknown> | undefined)?.score);
  const team2Score =
    parseNumber(eventData.team2_score) ??
    parseNumber((eventData.team2 as Record<string, unknown> | undefined)?.score);
  const team1SeriesScore =
    parseNumber(eventData.team1_series_score) ??
    parseNumber((eventData.team1 as Record<string, unknown> | undefined)?.series_score);
  const team2SeriesScore =
    parseNumber(eventData.team2_series_score) ??
    parseNumber((eventData.team2 as Record<string, unknown> | undefined)?.series_score);
  const mapName = (eventData.map_name as string) ?? undefined;

  if (mapNumber !== undefined) updates.mapNumber = mapNumber;
  if (roundNumber !== undefined) updates.roundNumber = roundNumber;
  if (team1Score !== undefined) updates.team1Score = team1Score;
  if (team2Score !== undefined) updates.team2Score = team2Score;
  if (team1SeriesScore !== undefined) updates.team1SeriesScore = team1SeriesScore;
  if (team2SeriesScore !== undefined) updates.team2SeriesScore = team2SeriesScore;
  if (mapName !== undefined) updates.mapName = mapName;

  return updates;
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num === 'number' && Number.isFinite(num)) {
    return num;
  }
  return undefined;
}

/**
 * Handle series end event - update match status and advance tournament
 */
function handleSeriesEnd(event: MatchZyEvent): void {
  const eventData = event as unknown as Record<string, unknown>;
  const match = resolveMatch(event.matchid);
  if (!match) {
    log.error(`Match not found for series_end event: ${event.matchid}`);
    return;
  }
  const matchSlug = match.slug;
  log.success(
    `🏆 SERIES ENDED: ${eventData.team1_name} ${eventData.team1_series_score}-${eventData.team2_series_score} ${eventData.team2_name}`,
    {
      matchId: event.matchid,
      winner: (eventData.winner as { name?: string })?.name,
    }
  );

  const team1Score = Number(eventData.team1_series_score) || 0;
  const team2Score = Number(eventData.team2_series_score) || 0;
  const winnerId = team1Score > team2Score ? match.team1_id : match.team2_id;

  if (!winnerId) {
    log.error(`Could not determine winner for match ${matchSlug}`);
    return;
  }

  // Update match status to completed
  db.update(
    'matches',
    {
      status: 'completed',
      winner_id: winnerId,
      completed_at: Math.floor(Date.now() / 1000),
    },
    'id = ?',
    [match.id]
  );

  log.success(`Match ${matchSlug} marked as completed with winner ${winnerId}`);

  // Emit match update
  const updatedMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [match.id]);
  if (updatedMatch) {
    emitMatchUpdate(updatedMatch);
  }

  // If this match has a next_match_id, advance the winner
  if (match.next_match_id) {
    advanceWinnerToNextMatch(match, winnerId);
  }

  // For double elimination, advance loser to losers bracket
  const tournament = db.queryOne<{ type: string }>('SELECT type FROM tournament WHERE id = ?', [
    match.tournament_id ?? 1,
  ]);
  if (tournament?.type === 'double_elimination') {
    const loserId = match.team1_id === winnerId ? match.team2_id : match.team1_id;
    if (loserId) {
      advanceLoserToLosersBracket(match, winnerId);
    }
  }

  // Check for round completion (Swiss)
  if (tournament?.type === 'swiss') {
    checkAndAdvanceRound(match.round);
  }

  // Check if tournament is complete
  checkTournamentCompletion();
}

/**
 * Check if a round is complete and advance to next round (Swiss)
 */
function checkAndAdvanceRound(completedRound: number): void {
  // Get all matches in this round
  const roundMatches = db.query<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = 1 AND round = ?',
    [completedRound]
  );

  // Check if all matches in this round are completed
  const allCompleted = roundMatches.every((m) => m.status === 'completed');

  if (!allCompleted) {
    log.debug(`Round ${completedRound} not yet complete`);
    return;
  }

  log.success(`Round ${completedRound} completed! Checking for next round matches...`);

  // Check if there are matches in the next round
  const nextRoundMatches = db.query<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = 1 AND round = ? AND status = "pending"',
    [completedRound + 1]
  );

  if (nextRoundMatches.length === 0) {
    log.info(`No more rounds to advance to`);
    return;
  }

  log.info(`Found ${nextRoundMatches.length} matches in round ${completedRound + 1}`);

  // Swiss system: pair teams based on current standings
  // For now, we just mark matches as ready if both teams are set
  nextRoundMatches.forEach((match) => {
    if (match.team1_id && match.team2_id) {
      db.update('matches', { status: 'ready' }, 'id = ?', [match.id]);
      log.info(`Match ${match.slug} is ready`);
      emitBracketUpdate({ action: 'match_ready', matchSlug: match.slug });
    }
  });
}
