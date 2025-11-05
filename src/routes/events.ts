import { Router, Request, Response } from 'express';
// import { validateServerToken } from '../middleware/serverAuth'; // TEMPORARILY DISABLED FOR TESTING
import { requireAuth } from '../middleware/auth';
import { MatchZyEvent } from '../types/matchzy-events.types';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { logWebhookEvent } from '../utils/eventLogger';
import { emitMatchEvent, emitMatchUpdate, emitBracketUpdate } from '../services/socketService';
import { matchAllocationService } from '../services/matchAllocationService';
import { eventBufferService } from '../services/eventBufferService';
import { playerConnectionService } from '../services/playerConnectionService';
import { serverStatusService } from '../services/serverStatusService';
import type { DbMatchRow, DbTeamRow, DbTournamentRow, DbEventRow } from '../types/database.types';

const router = Router();

/**
 * GET /api/events
 * Simple test endpoint to verify route is working
 */
router.get('/test', (_req: Request, res: Response) => {
  res.send('hello - events route is working');
});

/**
 * POST /api/events
 * Receive MatchZy events via webhook (legacy endpoint without server ID)
 * Protected by server token validation (TEMPORARILY DISABLED FOR TESTING)
 */
router.post('/', (req: Request, res: Response) => {
  handleEventRequest(req, res, undefined);
});

/**
 * POST /api/events/:matchSlugOrServerId
 * Receive MatchZy events via webhook with match slug or server ID in URL
 * Protected by server token validation (TEMPORARILY DISABLED FOR TESTING)
 */
router.post('/:matchSlugOrServerId', (req: Request, res: Response) => {
  const identifier = req.params.matchSlugOrServerId;
  handleEventRequest(req, res, identifier);
});

/**
 * Handle incoming event request
 */
function handleEventRequest(req: Request, res: Response, matchSlugOrServerIdFromUrl?: string): Response {
  // Log raw request for debugging
  console.log('\n🔍 RAW REQUEST RECEIVED:');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('URL Path:', req.path);
  console.log('---\n');
  try {
    const event: MatchZyEvent = req.body;

    // Validate event has required fields
    if (!event.event) {
      console.log('⚠️ Event missing "event" field');
      return res.status(400).json({
        success: false,
        error: 'Invalid event: missing event type',
      });
    }

    // USE MATCH SLUG FROM URL INSTEAD OF PAYLOAD!
    // If we have a match slug in the URL, use it (overrides payload matchid)
    const matchSlugFromUrl = matchSlugOrServerIdFromUrl;
    
    // Check if URL param is a match slug
    const matchFromUrl = matchSlugFromUrl ? db.queryOne<DbMatchRow>(
      'SELECT server_id, slug FROM matches WHERE slug = ?',
      [matchSlugFromUrl]
    ) : null;
    
    // Use match slug from URL if available, otherwise fall back to event.matchid
    const actualMatchSlug = matchFromUrl?.slug || String(event.matchid);
    const isNoMatch = actualMatchSlug === '-1';
    
    console.log(`📍 Match Slug: ${actualMatchSlug} (from ${matchFromUrl ? 'URL' : 'payload'})`);

    log.webhookReceived(event.event, actualMatchSlug);
    
    // Log full event payload to console
    console.log('\n📡 FULL EVENT RECEIVED:');
    console.log(JSON.stringify(event, null, 2));
    console.log('---\n');

    // Get server ID from match lookup
    const match = !isNoMatch ? db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [
      actualMatchSlug,
    ]) : matchFromUrl;
    
    const serverId = matchFromUrl?.server_id || match?.server_id || matchSlugOrServerIdFromUrl || 'unknown';
    
    console.log(`🖥️ Server ID: ${serverId} (from ${matchFromUrl ? 'URL match lookup' : match?.server_id ? 'matchid lookup' : matchSlugOrServerIdFromUrl ? 'URL fallback' : 'unknown'})`);

    // Handle events with no match loaded
    if (isNoMatch) {
      console.log(`ℹ️ Event received but no match is loaded (matchid: ${actualMatchSlug}). Event type: ${event.event}`);
      console.log('   This is normal during server startup or between matches.');
      
      // Log to file but don't store in database
      logWebhookEvent(serverId, event);
      
      return res.status(200).json({
        success: true,
        message: 'Event received (no active match)',
      });
    }

    // Log to file (persistent logging for debugging/recovery)
    logWebhookEvent(serverId, event);

    // Store event in database - only if match exists
    if (match) {
      try {
        db.insert('match_events', {
          match_slug: actualMatchSlug, // Use actual match slug from URL
          event_type: event.event,
          event_data: JSON.stringify(event),
          received_at: Math.floor(Date.now() / 1000),
        });
      } catch (insertError) {
        // Log but don't fail - event is still logged to file and will be processed
        log.error(`Failed to insert event to database (match: ${actualMatchSlug}, event: ${event.event})`, insertError);
      }
    } else {
      log.warn(`Event received for unknown match: ${actualMatchSlug}. Event will not be stored in database but will still be processed.`);
    }

    // Add to event buffer for debugging/monitoring
    eventBufferService.addEvent(serverId, actualMatchSlug, event);

    // Handle specific events with actual match slug
    handleEvent(event, actualMatchSlug);

    // Emit real-time event via Socket.io
    emitMatchEvent(actualMatchSlug, event as unknown as Record<string, unknown>);

    // Respond quickly to MatchZy
    return res.status(200).json({
      success: true,
      message: 'Event received',
    });
  } catch (error) {
    log.error('Error processing MatchZy event', error);
    // Still return 200 to prevent MatchZy from retrying
    return res.status(200).json({
      success: false,
      error: 'Error processing event',
    });
  }
}

/**
 * POST /api/events (legacy - redirects to handleEventRequest)
 */

/**
 * GET /api/events/:matchSlug
 * Get all events for a specific match
 * Protected by API token
 */
router.get('/:matchSlug', requireAuth, (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const eventType = req.query.type as string | undefined;

    let query = 'SELECT * FROM match_events WHERE match_slug = ?';
    const params: unknown[] = [matchSlug];

    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }

    query += ' ORDER BY received_at DESC LIMIT ?';
    params.push(limit);

    const events = db.query<DbEventRow>(query, params);

    return res.json({
      success: true,
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        data: JSON.parse(e.event_data),
        receivedAt: e.received_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch events',
    });
  }
});

/**
 * GET /api/events/server/:serverId
 * Get buffered events for a specific server (debugging)
 * Protected by API token
 */
router.get('/server/:serverId', requireAuth, (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const events = eventBufferService.getEvents(serverId);

    return res.json({
      success: true,
      serverId,
      count: events.length,
      events,
    });
  } catch (error) {
    console.error('Error fetching server events:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch server events',
    });
  }
});

/**
 * GET /api/events/servers/list
 * Get list of servers with buffered events
 * Protected by API token
 */
router.get('/servers/list', requireAuth, (_req: Request, res: Response) => {
  try {
    const stats = eventBufferService.getStats();

    return res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    console.error('Error fetching server list:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch server list',
    });
  }
});

/**
 * GET /api/events/connections/:matchSlug
 * Get player connection status for a match (public - no auth for teams to see)
 */
router.get('/connections/:matchSlug', (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const status = playerConnectionService.getStatus(matchSlug);

    if (!status) {
      return res.json({
        success: true,
        matchSlug,
        connectedPlayers: [],
        team1Connected: 0,
        team2Connected: 0,
        totalConnected: 0,
        lastUpdated: Date.now(),
      });
    }

    return res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Error fetching connection status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch connection status',
    });
  }
});

/**
 * Handle different event types
 * @param event The MatchZy event
 * @param actualMatchSlug The actual match slug (from URL or payload)
 */
function handleEvent(event: MatchZyEvent, actualMatchSlug: string): void {
  switch (event.event) {
    case 'series_start':
      log.success(`Series started: ${event.team1_name} vs ${event.team2_name}`, {
        matchId: event.matchid,
        numMaps: event.num_maps,
      });
      // Update match status to 'live'
      db.exec(
        `UPDATE matches SET status = 'live', loaded_at = ${Math.floor(
          Date.now() / 1000
        )} WHERE slug = '${event.matchid}'`
      );
      // Update server status to live
      {
        const match = db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [
          event.matchid,
        ]);
        if (match?.server_id) {
          serverStatusService.setMatchLive(match.server_id, event.matchid);
        }
      }
      break;

    case 'series_end':
      log.success(
        `Series ended! Winner: ${event.winner} (${event.team1_series_score}-${event.team2_series_score})`,
        { matchId: event.matchid, winner: event.winner }
      );
      handleSeriesEnd(event);
      // Clear connection tracking when match ends
      playerConnectionService.clearMatch(event.matchid);
      // Update server status to postgame
      {
        const match = db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [
          event.matchid,
        ]);
        if (match?.server_id) {
          serverStatusService.setMatchCompleted(match.server_id);
        }
      }
      break;

    case 'map_result':
      log.success(
        `Map ${event.map_number} result: ${event.team1_score}-${event.team2_score} on ${event.map_name}`,
        { matchId: event.matchid, winner: event.winner }
      );
      // Update current map for multi-map series
      if (actualMatchSlug !== '-1' && event.map_name) {
        db.update('matches', { current_map: event.map_name, map_number: event.map_number || 0 }, 'slug = ?', [actualMatchSlug]);
      }
      break;

    case 'round_end':
      log.debug(`Round ${event.round_number} ended: ${event.team1_score}-${event.team2_score}`, {
        matchId: event.matchid,
        winner: event.winner,
      });
      break;

    case 'player_connect':
      log.debug(`Player connected: ${event.player.name}`, { steamId: event.player.steamid, matchSlug: actualMatchSlug });
      // Track connection using actual match slug from URL
      {
        const match = db.queryOne<DbMatchRow>('SELECT config FROM matches WHERE slug = ?', [
          actualMatchSlug,
        ]);
        if (match && match.config) {
          const config = JSON.parse(match.config);
          const team1Players = config.team1?.players || [];

          const isTeam1 = team1Players.some(
            (p: { steamid: string }) => p.steamid === event.player.steamid
          );
          const team = isTeam1 ? 'team1' : 'team2';

          playerConnectionService.playerConnected(
            actualMatchSlug,
            event.player.steamid,
            event.player.name,
            team
          );
        }
      }
      break;

    case 'player_disconnect':
      log.debug(`Player disconnected: ${event.player.name}`, { steamId: event.player.steamid, matchSlug: actualMatchSlug });
      playerConnectionService.playerDisconnected(actualMatchSlug, event.player.steamid);
      break;

    case 'going_live':
      log.success(`Map ${event.map_number} going live!`, { matchSlug: actualMatchSlug });
      // Mark all connected players as ready
      playerConnectionService.markAllReady(actualMatchSlug);
      // Update current map from config if available
      if (actualMatchSlug !== '-1') {
        const matchData = db.queryOne<DbMatchRow>('SELECT config, server_id FROM matches WHERE slug = ?', [
          actualMatchSlug,
        ]);
        if (matchData) {
          const config = matchData.config ? JSON.parse(matchData.config) : null;
          const currentMap = config?.maplist?.[event.map_number || 0];
          if (currentMap) {
            db.update('matches', { current_map: currentMap, map_number: event.map_number || 0 }, 'slug = ?', [actualMatchSlug]);
          }
          // Update server status if first map
          if (event.map_number === 1 && matchData.server_id) {
            serverStatusService.setMatchLive(matchData.server_id, actualMatchSlug);
          }
        }
      }
      break;

    // Player Ready Events
    case 'player_ready':
      log.debug(`Player ready: ${event.player.name}`, {
        matchSlug: actualMatchSlug,
        team: event.team,
        totalReady: event.total_ready,
        expected: event.expected_total,
      });
      playerConnectionService.playerReady(actualMatchSlug, event.player.steamid, true);
      // Emit connection status update with ready counts
      emitMatchUpdate({
        slug: actualMatchSlug,
        connectionStatus: {
          totalConnected: event.total_ready,
          team1Connected: event.ready_count_team1,
          team2Connected: event.ready_count_team2,
        },
      });
      break;

    case 'player_unready':
      log.debug(`Player unready: ${event.player.name}`, {
        matchSlug: actualMatchSlug,
        team: event.team,
      });
      playerConnectionService.playerReady(actualMatchSlug, event.player.steamid, false);
      emitMatchUpdate({
        slug: actualMatchSlug,
        connectionStatus: {
          totalConnected: event.total_ready,
          team1Connected: event.ready_count_team1,
          team2Connected: event.ready_count_team2,
        },
      });
      break;

    case 'team_ready':
      log.success(`Team ready: ${event.team}`, {
        matchId: event.matchid,
        readyCount: event.ready_count,
      });
      break;

    case 'all_players_ready':
      log.success(`All players ready! Match starting soon.`, {
        matchId: event.matchid,
        totalReady: event.total_ready,
      });
      break;

    // Match Phase Events
    case 'warmup_ended':
      log.info(`Warmup ended`, { matchId: event.matchid, mapNumber: event.map_number });
      break;

    case 'knife_round_started':
      log.info(`Knife round started`, { matchId: event.matchid, mapNumber: event.map_number });
      break;

    case 'knife_round_ended':
      log.success(`Knife round won by ${event.winner}`, {
        matchId: event.matchid,
        mapNumber: event.map_number,
      });
      break;

    case 'round_started':
      log.debug(`Round ${event.round_number} started`, {
        matchId: event.matchid,
        mapNumber: event.map_number,
        score: `${event.team1_score}-${event.team2_score}`,
      });
      break;

    case 'halftime_started':
      log.info(`Halftime started`, {
        matchId: event.matchid,
        mapNumber: event.map_number,
        score: `${event.team1_score}-${event.team2_score}`,
      });
      break;

    case 'overtime_started':
      log.success(`Overtime ${event.overtime_number} started!`, {
        matchId: event.matchid,
        mapNumber: event.map_number,
      });
      break;

    // Pause System Events
    case 'match_paused':
      log.warn(`Match paused by ${event.paused_by.name}`, {
        matchId: event.matchid,
        mapNumber: event.map_number,
        tactical: event.is_tactical,
        admin: event.is_admin,
      });
      break;

    case 'unpause_requested':
      log.info(`Unpause requested by ${event.team}`, {
        matchId: event.matchid,
        teamsReady: event.teams_ready,
        teamsNeeded: event.teams_needed,
      });
      break;

    case 'match_unpaused':
      log.success(`Match unpaused`, {
        matchId: event.matchid,
        pauseDuration: event.pause_duration,
      });
      break;

    default:
      // Log all other events for debugging
      log.debug(`Event received: ${event.event}`, { matchId: event.matchid });
  }
}

/**
 * Handle series end - update match status and advance bracket
 */
function handleSeriesEnd(event: MatchZyEvent): void {
  try {
    // Get the match from database
    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [event.matchid]);

    if (!match) {
      log.warn('Match not found for series end event', { matchSlug: event.matchid });
      return;
    }

    // Determine winner team ID
    const team1Id = match.team1_id;
    const team2Id = match.team2_id;

    let winnerId: string | null = null;

    // Winner is determined by series score
    const eventData = event as { team1_series_score?: number; team2_series_score?: number };
    const team1Score = eventData.team1_series_score || 0;
    const team2Score = eventData.team2_series_score || 0;

    if (team1Score > team2Score) {
      winnerId = team1Id || null;
    } else if (team2Score > team1Score) {
      winnerId = team2Id || null;
    }

    if (!winnerId) {
      log.warn('Could not determine winner', { event });
      // Still mark as completed even if winner is unclear
      db.update(
        'matches',
        {
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
        },
        'slug = ?',
        [event.matchid]
      );
      return;
    }

    // Update match with winner
    db.update(
      'matches',
      {
        status: 'completed',
        winner_id: winnerId,
        completed_at: Math.floor(Date.now() / 1000),
      },
      'slug = ?',
      [event.matchid]
    );

    log.success(`Match ${event.matchid} completed. Winner: ${winnerId}`);

    // Emit match update
    const updatedMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      event.matchid,
    ]);
    if (updatedMatch) {
      emitMatchUpdate(updatedMatch as unknown as Record<string, unknown>);
    }

    // If this match has a next_match_id, advance the winner
    if (match.next_match_id) {
      advanceWinnerToNextMatch(match, winnerId);
    }

    // For double elimination: advance loser to losers bracket
    advanceLoserToLosersBracket(match, winnerId);

    // Check if tournament is completed
    checkTournamentCompletion();

    // For round robin/swiss, check if round is complete and advance to next round
    checkAndAdvanceRound(match.round);

    // Emit bracket update
    emitBracketUpdate({ action: 'match_completed', matchSlug: event.matchid });
  } catch (error) {
    log.error('Error handling series end', error);
  }
}

/**
 * Check if a round is complete and advance to next round (for round robin/swiss)
 */
function checkAndAdvanceRound(completedRound: number): void {
  try {
    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament) return;

    // Only for round robin and swiss formats
    if (tournament.type !== 'round_robin' && tournament.type !== 'swiss') {
      return;
    }

    // Check if all matches in the completed round are done
    const pendingInRound = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE round = ? AND status != "completed" AND tournament_id = 1',
      [completedRound]
    );

    if (pendingInRound && pendingInRound.count === 0) {
      // All matches in this round are complete, make next round ready
      const nextRound = completedRound + 1;

      const nextRoundMatches = db.query<DbMatchRow>(
        'SELECT * FROM matches WHERE round = ? AND tournament_id = 1',
        [nextRound]
      );

      if (nextRoundMatches.length > 0) {
        db.update('matches', { status: 'ready' }, 'round = ? AND tournament_id = 1', [nextRound]);

        log.success(
          `Round ${completedRound} complete. Round ${nextRound} is now ready (${nextRoundMatches.length} matches)`
        );

        // Auto-allocate servers for the new round
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        matchAllocationService.allocateServersToMatches(baseUrl).catch((err) => {
          log.error('Failed to auto-allocate servers for next round', err);
        });
      }
    }
  } catch (error) {
    log.error('Error checking round advancement', error);
  }
}

/**
 * Advance winner to next match in bracket
 */
function advanceWinnerToNextMatch(currentMatch: DbMatchRow, winnerId: string): void {
  try {
    const nextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      currentMatch.next_match_id,
    ]);

    if (!nextMatch) {
      log.warn('Next match not found', { nextMatchId: currentMatch.next_match_id });
      return;
    }

    // Determine which slot to fill (team1 or team2)
    // Teams from lower match numbers go to team1
    if (!nextMatch.team1_id) {
      db.update('matches', { team1_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team1`);
    } else if (!nextMatch.team2_id) {
      db.update('matches', { team2_id: winnerId }, 'id = ?', [nextMatch.id]);
      log.debug(`Advanced ${winnerId} to ${nextMatch.slug} as team2`);
    } else {
      log.warn('Next match already has both teams assigned', { nextMatchSlug: nextMatch.slug });
      return;
    }

    // Update next match config with new team info
    const updatedNextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      nextMatch.id,
    ]);
    if (updatedNextMatch && updatedNextMatch.team1_id && updatedNextMatch.team2_id) {
      // Both teams are now assigned, update status to 'ready'
      db.update('matches', { status: 'ready' }, 'id = ?', [nextMatch.id]);

      // Regenerate match config with both teams
      const team1 = db.queryOne<DbTeamRow & { players: string }>(
        'SELECT * FROM teams WHERE id = ?',
        [updatedNextMatch.team1_id]
      );
      const team2 = db.queryOne<DbTeamRow & { players: string }>(
        'SELECT * FROM teams WHERE id = ?',
        [updatedNextMatch.team2_id]
      );

      if (team1 && team2) {
        const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
        if (tournament) {
          const maps = JSON.parse(tournament.maps);
          
          // Calculate players based on actual team sizes
          const team1PlayerObj = JSON.parse(team1.players);
          const team2PlayerObj = JSON.parse(team2.players);
          const team1PlayerCount = Object.keys(team1PlayerObj).length;
          const team2PlayerCount = Object.keys(team2PlayerObj).length;
          const playersPerTeam = Math.max(team1PlayerCount, team2PlayerCount, 1);
          const totalExpectedPlayers = team1PlayerCount + team2PlayerCount;
          
          const config = {
            matchid: updatedNextMatch.slug,
            num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
            maplist: maps,
            min_players_to_ready: 1,
            players_per_team: playersPerTeam,
            clinch_series: true,
            expected_players_total: totalExpectedPlayers,
            expected_players_team1: team1PlayerCount,
            expected_players_team2: team2PlayerCount,
            team1: {
              name: team1.name,
              tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
              players: team1PlayerObj,
            },
            team2: {
              name: team2.name,
              tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
              players: team2PlayerObj,
            },
          };

          db.update('matches', { config: JSON.stringify(config) }, 'id = ?', [nextMatch.id]);
          log.success(
            `Match ${updatedNextMatch.slug} is now ready: ${team1.name} vs ${team2.name}`
          );

          // Emit bracket update for new ready match
          emitBracketUpdate({ action: 'match_ready', matchSlug: updatedNextMatch.slug });

          // Automatically allocate an available server to this ready match
          autoAllocateServerToMatch(updatedNextMatch.slug).catch((error) => {
            log.error('Failed to auto-allocate server to ready match', error, {
              matchSlug: updatedNextMatch.slug,
            });
          });
        }
      }
    }
  } catch (error) {
    log.error('Error advancing winner to next match', error);
  }
}

/**
 * Advance loser to losers bracket (for double elimination)
 */
function advanceLoserToLosersBracket(currentMatch: DbMatchRow, winnerId: string): void {
  try {
    // Only for winners bracket matches (wb-rXmY)
    if (!currentMatch.slug.startsWith('wb-')) {
      return; // Not a winners bracket match
    }

    // Check if this is a double elimination tournament
    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.type !== 'double_elimination') {
      return;
    }

    // Determine the loser
    const loserId =
      currentMatch.team1_id === winnerId ? currentMatch.team2_id : currentMatch.team1_id;

    if (!loserId) {
      log.warn('Could not determine loser for double elimination advancement', {
        matchSlug: currentMatch.slug,
      });
      return;
    }

    // Parse winners bracket match slug: wb-r{round}m{match}
    const wbMatch = currentMatch.slug.match(/^wb-r(\d+)m(\d+)$/);
    if (!wbMatch) {
      log.warn('Invalid winners bracket slug format', { slug: currentMatch.slug });
      return;
    }

    const wbRound = parseInt(wbMatch[1], 10);
    const wbMatchNum = parseInt(wbMatch[2], 10);

    // Calculate losers bracket destination
    // Winners Round R → Losers Round (2R-1)
    const lbRound = 2 * wbRound - 1;
    const lbMatchNum = wbMatchNum;

    // Find the losers bracket match
    const lbSlug = `lb-r${lbRound}m${lbMatchNum}`;
    const lbMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [lbSlug]);

    if (!lbMatch) {
      log.warn('Losers bracket match not found', { lbSlug, wbSlug: currentMatch.slug });
      return;
    }

    // Determine which slot to fill in losers bracket
    if (!lbMatch.team1_id) {
      db.update('matches', { team1_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbSlug} as team1`);
    } else if (!lbMatch.team2_id) {
      db.update('matches', { team2_id: loserId }, 'id = ?', [lbMatch.id]);
      log.debug(`Advanced loser ${loserId} to ${lbSlug} as team2`);
    } else {
      log.warn('Losers bracket match already has both teams', { lbSlug });
      return;
    }

    // Check if losers bracket match is now ready (has both teams)
    const updatedLbMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      lbMatch.id,
    ]);

    if (updatedLbMatch && updatedLbMatch.team1_id && updatedLbMatch.team2_id) {
      // Both teams assigned, make it ready
      db.update('matches', { status: 'ready' }, 'id = ?', [lbMatch.id]);

      // Regenerate match config
      const team1 = db.queryOne<DbTeamRow & { players: string }>(
        'SELECT * FROM teams WHERE id = ?',
        [updatedLbMatch.team1_id]
      );
      const team2 = db.queryOne<DbTeamRow & { players: string }>(
        'SELECT * FROM teams WHERE id = ?',
        [updatedLbMatch.team2_id]
      );

      if (team1 && team2 && tournament) {
        const maps = JSON.parse(tournament.maps);
        
        // Calculate players based on actual team sizes
        const team1PlayerObj = JSON.parse(team1.players);
        const team2PlayerObj = JSON.parse(team2.players);
        const team1PlayerCount = Object.keys(team1PlayerObj).length;
        const team2PlayerCount = Object.keys(team2PlayerObj).length;
        const playersPerTeam = Math.max(team1PlayerCount, team2PlayerCount, 1);
        const totalExpectedPlayers = team1PlayerCount + team2PlayerCount;
        
        const config = {
          matchid: updatedLbMatch.slug,
          num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
          maplist: maps,
          min_players_to_ready: 1,
          players_per_team: playersPerTeam,
          clinch_series: true,
          expected_players_total: totalExpectedPlayers,
          expected_players_team1: team1PlayerCount,
          expected_players_team2: team2PlayerCount,
          team1: {
            name: team1.name,
            tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
            players: team1PlayerObj,
          },
          team2: {
            name: team2.name,
            tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
            players: team2PlayerObj,
          },
        };

        db.update('matches', { config: JSON.stringify(config) }, 'id = ?', [lbMatch.id]);
        log.success(
          `Losers bracket match ${updatedLbMatch.slug} is now ready: ${team1.name} vs ${team2.name}`
        );

        // Emit bracket update
        emitBracketUpdate({ action: 'match_ready', matchSlug: updatedLbMatch.slug });

        // Auto-allocate server
        autoAllocateServerToMatch(updatedLbMatch.slug).catch((error) => {
          log.error('Failed to auto-allocate server to losers bracket match', error, {
            matchSlug: updatedLbMatch.slug,
          });
        });
      }
    }
  } catch (error) {
    log.error('Error advancing loser to losers bracket', error);
  }
}

/**
 * Check if tournament is completed
 */
function checkTournamentCompletion(): void {
  try {
    const tournament = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!tournament || tournament.status === 'completed') return;

    // Check if all matches are completed
    const pendingMatches = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM matches WHERE tournament_id = 1 AND status != ?',
      ['completed']
    );

    if (pendingMatches && pendingMatches.count === 0) {
      // Tournament is complete!
      db.update(
        'tournament',
        {
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
        },
        'id = ?',
        [1]
      );

      log.success('🏆 Tournament completed! 🏆');
    }
  } catch (error) {
    log.error('Error checking tournament completion', error);
  }
}

/**
 * Automatically allocate an available server to a newly ready match
 */
async function autoAllocateServerToMatch(matchSlug: string): Promise<void> {
  try {
    // Get base URL from environment or construct it
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Allocate this specific match to first available server
    const result = await matchAllocationService.allocateSingleMatch(matchSlug, baseUrl);

    if (result.success) {
      log.success(`Auto-allocated match ${matchSlug} to server ${result.serverId}`);

      // Emit bracket update
      emitBracketUpdate({
        action: 'match_allocated',
        matchSlug,
        serverId: result.serverId,
      });
    } else {
      log.warn(`Could not auto-allocate match ${matchSlug}: ${result.error}`);
    }
  } catch (error) {
    log.error('Error in auto-allocate server', error, { matchSlug });
  }
}

export default router;
