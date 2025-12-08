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
import { recordMapResult, getMapResults } from './matchMapResultService';
import { updatePlayerRatings } from './ratingService';
import { teamService } from './teamService';
import { advanceToNextRound } from './shuffleTournamentService';
import { matchAllocationService } from './matchAllocationService';
import { settingsService } from './settingsService';
import type { Player } from '../types/team.types';

/**
 * Main event handler - routes events to specific handlers
 */
export async function handleMatchEvent(event: MatchZyEvent): Promise<void> {
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
        const match = await resolveMatch(event.matchid);
        if (match) {
          updateLiveStats(match, parseScorePayload(eventData, 'postgame'));
          await handleMapCompletion(match, event, eventData);
        }
      }
      break;

    case 'series_end':
      await handleSeriesEnd(event);
      break;

    // Map Events
    case 'going_live': {
      log.success(`Going live: Map ${eventData.map_number} - ${eventData.map_name}`, {
        matchId: event.matchid,
        team1: eventData.team1_name,
        team2: eventData.team2_name,
      });
      const liveMatch = await resolveMatch(event.matchid);
      if (liveMatch) {
        await updateMatchStatus(liveMatch, 'live');
        playerConnectionService.markAllReady(liveMatch.slug);
        updateLiveStats(liveMatch, parseScorePayload(eventData, 'live'));
        await db.updateAsync(
          'matches',
          { current_map: eventData.map_name, map_number: eventData.map_number },
          'id = ?',
          [liveMatch.id]
        );
      } else {
        log.warn(`Going live event received for unknown match`, { matchId: event.matchid });
      }
      break;
    }

    // Player connection events
    case 'player_connect': {
      const match = await resolveMatch(event.matchid);
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
      const match = await resolveMatch(event.matchid);
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
      const match = await resolveMatch(event.matchid);
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
      const match = await resolveMatch(event.matchid);
      if (match) {
        const updates = parseScorePayload(eventData, 'live');
        const stats = matchLiveStatsService.update(match.slug, updates);
        await db.updateAsync(
          'matches',
          {
            current_map: stats.mapName ?? match.current_map,
            map_number: stats.mapNumber ?? match.map_number,
          },
          'id = ?',
          [match.id]
        );
        emitMatchUpdate({
          slug: match.slug,
          liveStats: stats,
          status: match.status,
        });
      }
      break;
    }

    case 'knife_round_started': {
      log.info(`Knife round started`, { matchId: event.matchid, mapNumber: eventData.map_number });
      const match = await resolveMatch(event.matchid);
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
      const match = await resolveMatch(event.matchid);
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
        const match = (await resolveMatch(event.matchid)) ?? null;
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
      const match = (await resolveMatch(event.matchid)) ?? null;
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
      const match = await resolveMatch(event.matchid);
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

async function resolveMatch(identifier: string | number): Promise<DbMatchRow | null> {
  const identifierStr = String(identifier);
  const numericId = Number(identifierStr);

  if (!Number.isNaN(numericId)) {
    const byId = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [numericId]);
    if (byId) {
      return byId;
    }
  }

  return (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [identifierStr])) ?? null;
}

async function updateMatchStatus(match: DbMatchRow, status: DbMatchRow['status']): Promise<void> {
  if (match.status === status) {
    return;
  }

  await db.updateAsync('matches', { status }, 'id = ?', [match.id]);
  const updatedMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [match.id]);
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

    if (playerMatchesCollection(team1Players, steamId)) {
      return 'team1';
    }
    if (playerMatchesCollection(team2Players, steamId)) {
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

function playerMatchesCollection(collection: unknown, steamId: string): boolean {
  if (!collection) return false;

  // Handle array of players [{ steamid, name }, ...]
  if (Array.isArray(collection)) {
    return collection.some((player) => getSteamIdFromUnknown(player) === steamId);
  }

  if (typeof collection === 'object') {
    // Direct key lookup (MatchZy format {steamId: name})
    if (Object.prototype.hasOwnProperty.call(collection, steamId)) {
      return true;
    }

    // Iterate over values (legacy format {0: {steamId, name}})
    return Object.values(collection).some((value) => getSteamIdFromUnknown(value) === steamId);
  }

  return false;
}

function getSteamIdFromUnknown(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    // Some older configs stored steamId directly as a string entry
    return /^7656\d{13}$/.test(value) ? value : null;
  }

  if (typeof value === 'object') {
    const candidate =
      (value as { steamId?: string; steamid?: string }).steamId ||
      (value as { steamId?: string; steamid?: string }).steamid;
    return typeof candidate === 'string' ? candidate : null;
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

async function handleMapCompletion(
  match: DbMatchRow,
  originalEvent: MatchZyEvent,
  eventData: Record<string, unknown>
): Promise<void> {
  const config = parseMatchConfig(match.config);
  const totalMaps = config?.num_maps ?? 1;
  const requiredWins = Math.max(1, Math.ceil(totalMaps / 2));
  const completedMapNumber =
    typeof eventData.map_number === 'number'
      ? (eventData.map_number as number)
      : parseNumber(eventData.map_number) ?? match.map_number ?? 0;
  const mapName = (eventData.map_name as string) ?? match.current_map ?? null;
  const team1ScoreFinal =
    extractNestedNumber(eventData, ['team1', 'score']) ??
    extractNestedNumber(eventData, ['team1_score']) ??
    0;
  const team2ScoreFinal =
    extractNestedNumber(eventData, ['team2', 'score']) ??
    extractNestedNumber(eventData, ['team2_score']) ??
    0;
  const winnerTeam =
    ((eventData.winner as { team?: string } | undefined)?.team as 'team1' | 'team2' | undefined) ??
    (team1ScoreFinal === team2ScoreFinal ? 'none' : team1ScoreFinal > team2ScoreFinal ? 'team1' : 'team2');

  await recordMapResult({
    matchSlug: match.slug,
    mapNumber: completedMapNumber,
    mapName,
    team1Score: team1ScoreFinal,
    team2Score: team2ScoreFinal,
    winnerTeam,
  });

  const team1SeriesScore =
    extractNestedNumber(eventData, ['team1', 'series_score']) ??
    extractNestedNumber(eventData, ['team1_series_score']) ??
    0;
  const team2SeriesScore =
    extractNestedNumber(eventData, ['team2', 'series_score']) ??
    extractNestedNumber(eventData, ['team2_series_score']) ??
    0;

  const seriesFinished =
    team1SeriesScore >= requiredWins || team2SeriesScore >= requiredWins;

  const maxMapIndex = Math.max(0, totalMaps - 1);
  const upcomingIndex = Math.min(completedMapNumber + 1, maxMapIndex);
  const targetMapNumber = seriesFinished ? completedMapNumber : upcomingIndex;
  await db.updateAsync(
    'matches',
    {
      current_map: null,
      map_number: targetMapNumber,
    },
    'id = ?',
    [match.id]
  );

  if (seriesFinished) {
    const syntheticSeriesEvent: MatchZyEvent = {
      ...originalEvent,
      event: 'series_end',
      team1_series_score: team1SeriesScore,
      team2_series_score: team2SeriesScore,
      winner:
        ((eventData.winner as { team?: string })?.team as 'team1' | 'team2' | undefined) || 'none',
      time_until_restore: 0,
    };
    handleSeriesEnd(syntheticSeriesEvent);
    return;
  }

  const nextStats = matchLiveStatsService.update(match.slug, {
    team1Score: 0,
    team2Score: 0,
    status: 'warmup',
    mapNumber: completedMapNumber + 1,
    mapName: null,
  });

  const mapResults = await getMapResults(match.slug);
  emitMatchUpdate({
    slug: match.slug,
    liveStats: nextStats,
    mapResults,
  });
}

function parseMatchConfig(config: unknown): { num_maps?: number } | null {
  if (!config) return null;
  if (typeof config === 'object') {
    return config as { num_maps?: number };
  }
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as { num_maps?: number };
    } catch {
      return null;
    }
  }
  return null;
}

function extractNestedNumber(
  source: Record<string, unknown>,
  path: Array<string>
): number | undefined {
  let cursor: unknown = source;
  for (const key of path) {
    if (cursor && typeof cursor === 'object' && key in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  if (typeof cursor === 'number') {
    return cursor;
  }
  if (typeof cursor === 'string') {
    const parsed = Number(cursor);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Handle series end event - update match status, ratings, and advance tournament
 */
async function handleSeriesEnd(event: MatchZyEvent): Promise<void> {
  const eventData = event as unknown as Record<string, unknown>;
  const match = await resolveMatch(event.matchid);
  if (!match) {
    log.error(`Match not found for series_end event: ${event.matchid}`);
    return;
  }
  const matchSlug = match.slug;
  log.success(
    `[SERIES END] SERIES ENDED: ${eventData.team1_name} ${eventData.team1_series_score}-${eventData.team2_series_score} ${eventData.team2_name}`,
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
  await db.updateAsync(
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
  const updatedMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [match.id]);
  if (updatedMatch) {
    emitMatchUpdate(updatedMatch);
  }

  // If this match has a next_match_id, advance the winner
  if (match.next_match_id) {
    advanceWinnerToNextMatch(match, winnerId);
  }

  // For double elimination, advance loser to losers bracket
  const tournament = await db.queryOneAsync<{ type: string }>('SELECT type FROM tournament WHERE id = ?', [
    match.tournament_id ?? 1,
  ]);
  if (tournament?.type === 'double_elimination') {
    const loserId = match.team1_id === winnerId ? match.team2_id : match.team1_id;
    if (loserId) {
      advanceLoserToLosersBracket(match, winnerId);
    }
  }

  // Always track player stats and ratings where possible
  await trackPlayerStatsForMatch(match, winnerId, matchSlug);
  await updateRatingsForMatch(match, winnerId, matchSlug);

  // Check for round completion (Swiss)
  if (tournament?.type === 'swiss') {
    await checkAndAdvanceRound(match.round);
  }

  // Shuffle-specific round progression
  if (tournament?.type === 'shuffle') {
    await checkAndAdvanceShuffleRound(match.round);
  }

  // Check if tournament is complete
  await checkTournamentCompletion();
}

/**
 * Update player ratings for matches (all tournament types with players)
 */
async function updateRatingsForMatch(
  match: DbMatchRow,
  winnerId: string,
  matchSlug: string
): Promise<void> {
  try {
    if (!match.team1_id || !match.team2_id) {
      log.warn('Cannot update ratings: missing team IDs', { matchSlug });
      return;
    }

    // Get teams and extract player Steam IDs
    const team1 = await teamService.getTeamById(match.team1_id);
    const team2 = await teamService.getTeamById(match.team2_id);

    if (!team1 || !team2) {
      log.warn('Cannot update ratings: teams not found', { matchSlug, team1_id: match.team1_id, team2_id: match.team2_id });
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

/**
 * Track individual player stats for matches (all tournament types with players)
 */
async function trackPlayerStatsForMatch(
  match: DbMatchRow,
  winnerId: string,
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

    // Determine which team won
    const team1Won = match.team1_id === winnerId;

    // Get player stats from match events (if available)
    const playerStatsEvent = await db.queryOneAsync<{
      event_data: string;
    }>(
      `SELECT event_data FROM match_events 
       WHERE match_slug = ? AND event_type = 'player_stats' 
       ORDER BY received_at DESC LIMIT 1`,
      [matchSlug]
    );

    let team1PlayerStats: Record<string, Record<string, unknown>> = {};
    let team2PlayerStats: Record<string, Record<string, unknown>> = {};

    if (playerStatsEvent) {
      try {
        const eventData = JSON.parse(playerStatsEvent.event_data) as {
          team1_players?: Record<string, Record<string, unknown>>;
          team2_players?: Record<string, Record<string, unknown>>;
        };
        // MatchZy format: {steamId: {kills, deaths, assists, damage, ...}}
        if (eventData.team1_players) {
          team1PlayerStats = eventData.team1_players;
        }
        if (eventData.team2_players) {
          team2PlayerStats = eventData.team2_players;
        }
      } catch (error) {
        log.warn('Failed to parse player stats from event', { error, matchSlug });
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Store stats for team1 players
    for (const player of team1.players) {
      const stats = team1PlayerStats[player.steamId] || {};
      const roundsPlayed = stats.rounds_played || stats.roundsPlayed || 0;
      const adr = roundsPlayed > 0 ? (stats.damage || 0) / roundsPlayed : 0;

      await db.insertAsync('player_match_stats', {
        player_id: player.steamId,
        match_slug: matchSlug,
        team: 'team1',
        won_match: team1Won,
        adr: Math.round(adr * 100) / 100, // Round to 2 decimal places
        total_damage: stats.damage || 0,
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        assists: stats.assists || 0,
        headshots: stats.headshot_kills || stats.headshotKills || 0,
        flash_assists: stats.flash_assists || stats.flashAssists || 0,
        utility_damage: stats.utility_damage || stats.utilityDamage || 0,
        kast: stats.kast || 0,
        mvps: stats.mvp || stats.mvps || 0,
        score: stats.score || 0,
        rounds_played: roundsPlayed,
        created_at: now,
      });
    }

    // Store stats for team2 players
    for (const player of team2.players) {
      const stats = team2PlayerStats[player.steamId] || {};
      const roundsPlayed = stats.rounds_played || stats.roundsPlayed || 0;
      const adr = roundsPlayed > 0 ? (stats.damage || 0) / roundsPlayed : 0;

      await db.insertAsync('player_match_stats', {
        player_id: player.steamId,
        match_slug: matchSlug,
        team: 'team2',
        won_match: !team1Won,
        adr: Math.round(adr * 100) / 100,
        total_damage: stats.damage || 0,
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        assists: stats.assists || 0,
        headshots: stats.headshot_kills || stats.headshotKills || 0,
        flash_assists: stats.flash_assists || stats.flashAssists || 0,
        utility_damage: stats.utility_damage || stats.utilityDamage || 0,
        kast: stats.kast || 0,
        mvps: stats.mvp || stats.mvps || 0,
        score: stats.score || 0,
        rounds_played: roundsPlayed,
        created_at: now,
      });
    }

    log.debug(`Tracked player stats for ${team1.players.length + team2.players.length} players`, {
      matchSlug,
    });
  } catch (error) {
    log.error('Error tracking player stats for shuffle tournament', { error, matchSlug });
    // Don't throw - stats tracking failure shouldn't break match completion
  }
}

/**
 * Check if shuffle round is complete and advance if needed
 */
async function checkAndAdvanceShuffleRound(roundNumber: number): Promise<void> {
  try {
    const { checkRoundCompletion } = await import('./shuffleTournamentService');
    const isComplete = await checkRoundCompletion(roundNumber);

    if (isComplete) {
      log.info(`Round ${roundNumber} is complete, advancing to next round...`);
      const result = await advanceToNextRound();

      if (result) {
        log.success(`Advanced to round ${result.roundNumber} with ${result.matches.length} matches`);
        // Emit bracket update for new matches
        emitBracketUpdate({ action: 'round_advanced', roundNumber: result.roundNumber });

        // Automatically allocate servers to newly generated matches
        try {
          const webhookUrl = await settingsService.getWebhookUrl();
          if (webhookUrl) {
            log.info(`Auto-allocating servers to ${result.matches.length} new matches in round ${result.roundNumber}...`);
            
            // Allocate servers to all new matches
            const allocationResults = await Promise.allSettled(
              result.matches.map(async (match) => {
                try {
                  const allocationResult = await matchAllocationService.allocateSingleMatch(match.slug, webhookUrl);
                  if (allocationResult.success) {
                    log.success(`Auto-allocated match ${match.slug} to server ${allocationResult.serverId}`);
                    return { matchSlug: match.slug, success: true, serverId: allocationResult.serverId };
                  } else {
                    log.warn(`Could not auto-allocate match ${match.slug}: ${allocationResult.error}`);
                    // Start polling for this match
                    matchAllocationService.startPollingForServer(match.slug, webhookUrl);
                    return { matchSlug: match.slug, success: false, error: allocationResult.error };
                  }
                } catch (error) {
                  log.error(`Error allocating match ${match.slug}`, error);
                  return { matchSlug: match.slug, success: false, error: error instanceof Error ? error.message : 'Unknown error' };
                }
              })
            );

            const successful = allocationResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
            const failed = allocationResults.length - successful;

            if (successful > 0) {
              log.success(`Auto-allocated ${successful} match(es) to servers`);
            }
            if (failed > 0) {
              log.info(`${failed} match(es) will be allocated when servers become available (polling started)`);
            }
          } else {
            log.warn('Webhook URL not configured - cannot auto-allocate servers to new round matches');
          }
        } catch (error) {
          log.error('Error auto-allocating servers to new round matches', error);
          // Don't throw - server allocation failure shouldn't break round advancement
        }
      } else {
        log.info('Tournament is complete or no more rounds');
      }
    }
  } catch (error) {
    log.error('Error checking/advancing shuffle round', { error, roundNumber });
    // Don't throw - round advancement failure shouldn't break match completion
  }
}

/**
 * Check if a round is complete and advance to next round (Swiss)
 */
async function checkAndAdvanceRound(completedRound: number): Promise<void> {
  // Get all matches in this round
  const roundMatches = await db.queryAsync<DbMatchRow>(
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
  const nextRoundMatches = await db.queryAsync<DbMatchRow>(
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
  for (const match of nextRoundMatches) {
    if (match.team1_id && match.team2_id) {
      await db.updateAsync('matches', { status: 'ready' }, 'id = ?', [match.id]);
      log.info(`Match ${match.slug} is ready`);
      emitBracketUpdate({ action: 'match_ready', matchSlug: match.slug });
    }
  }
}
