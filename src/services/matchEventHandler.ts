/**
 * Match Event Handler Service
 * Handles processing of MatchZy webhook events
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitMatchUpdate, emitBracketUpdate } from './socketService';
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
      break;

    case 'series_end':
      handleSeriesEnd(event);
      break;

    // Map Events
    case 'going_live':
      log.success(`Going live: Map ${eventData.map_number} - ${eventData.map_name}`, {
        matchId: event.matchid,
        team1: eventData.team1_name,
        team2: eventData.team2_name,
      });
      break;

    // Round Events
    case 'round_end':
      log.debug(`Round ${eventData.round_number} won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
        reason: eventData.reason,
      });
      break;

    case 'knife_round_started':
      log.info(`Knife round started`, { matchId: event.matchid, mapNumber: eventData.map_number });
      break;

    case 'knife_round_ended':
      log.success(`Knife round won by ${eventData.winner}`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      break;

    case 'round_started':
      log.debug(`Round ${eventData.round_number} started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      break;

    case 'halftime_started':
      log.info(`Halftime started`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
        score: `${eventData.team1_score}-${eventData.team2_score}`,
      });
      break;

    case 'overtime_started':
      log.success(`Overtime ${eventData.overtime_number} started!`, {
        matchId: event.matchid,
        mapNumber: eventData.map_number,
      });
      break;

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

/**
 * Handle series end event - update match status and advance tournament
 */
function handleSeriesEnd(event: MatchZyEvent): void {
  const eventData = event as unknown as Record<string, unknown>;
  const matchSlug = String(event.matchid);
  log.success(
    `🏆 SERIES ENDED: ${eventData.team1_name} ${eventData.team1_series_score}-${eventData.team2_series_score} ${eventData.team2_name}`,
    {
      matchId: event.matchid,
      winner: (eventData.winner as { name?: string })?.name,
    }
  );

  // Determine winner team ID
  const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
  if (!match) {
    log.error(`Match not found for series_end event: ${matchSlug}`);
    return;
  }

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
    'slug = ?',
    [matchSlug]
  );

  log.success(`Match ${matchSlug} marked as completed with winner ${winnerId}`);

  // Emit match update
  const updatedMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
    event.matchid,
  ]);
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
