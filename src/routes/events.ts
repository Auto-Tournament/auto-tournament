import { Router, Request, Response } from 'express';
import { validateServerToken } from '../middleware/serverAuth';
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
 * POST /api/events
 * Receive MatchZy events via webhook
 * Protected by server token validation
 */
router.post('/', validateServerToken, (req: Request, res: Response) => {
  try {
    const event: MatchZyEvent = req.body;

    // Validate event has required fields
    if (!event.event || !event.matchid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event: missing required fields (event, matchid)',
      });
    }

    log.webhookReceived(event.event, event.matchid);

    // Get server ID from match for event buffer
    const match = db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [
      event.matchid,
    ]);
    const serverId = match?.server_id || 'unknown';

    // Log to file (persistent logging for debugging/recovery)
    logWebhookEvent(serverId, event);

    // Store event in database
    db.insert('match_events', {
      match_slug: event.matchid,
      event_type: event.event,
      event_data: JSON.stringify(event),
      received_at: Math.floor(Date.now() / 1000),
    });

    // Add to event buffer for debugging/monitoring
    eventBufferService.addEvent(serverId, event.matchid, event);

    // Handle specific events
    handleEvent(event);

    // Emit real-time event via Socket.io
    emitMatchEvent(event.matchid, event as unknown as Record<string, unknown>);

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
});

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
 * Get player connection status for a match
 * Protected by API token
 */
router.get('/connections/:matchSlug', requireAuth, (req: Request, res: Response) => {
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
 */
function handleEvent(event: MatchZyEvent): void {
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
      break;

    case 'round_end':
      log.debug(`Round ${event.round_number} ended: ${event.team1_score}-${event.team2_score}`, {
        matchId: event.matchid,
        winner: event.winner,
      });
      break;

    case 'player_connect':
      log.debug(`Player connected: ${event.player.name}`, { steamId: event.player.steamid });
      // Track connection (we don't know team yet, will be in series_start or other events)
      // For now, we'll get team from match config
      {
        const match = db.queryOne<DbMatchRow>('SELECT config FROM matches WHERE slug = ?', [
          event.matchid,
        ]);
        if (match && match.config) {
          const config = JSON.parse(match.config);
          const team1Players = config.team1?.players || [];

          const isTeam1 = team1Players.some(
            (p: { steamid: string }) => p.steamid === event.player.steamid
          );
          const team = isTeam1 ? 'team1' : 'team2';

          playerConnectionService.playerConnected(
            event.matchid,
            event.player.steamid,
            event.player.name,
            team
          );
        }
      }
      break;

    case 'player_disconnect':
      log.debug(`Player disconnected: ${event.player.name}`, { steamId: event.player.steamid });
      playerConnectionService.playerDisconnected(event.matchid, event.player.steamid);
      break;

    case 'going_live':
      log.success(`Map ${event.map_number} going live!`, { matchId: event.matchid });
      // Mark all connected players as ready
      playerConnectionService.markAllReady(event.matchid);
      // Update server status if first map
      if (event.map_number === 1) {
        const match = db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [
          event.matchid,
        ]);
        if (match?.server_id) {
          serverStatusService.setMatchLive(match.server_id, event.matchid);
        }
      }
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
          const config = {
            matchid: updatedNextMatch.slug,
            num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
            maplist: maps,
            players_per_team: 5,
            clinch_series: true,
            team1: {
              name: team1.name,
              tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
              players: JSON.parse(team1.players),
            },
            team2: {
              name: team2.name,
              tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
              players: JSON.parse(team2.players),
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
        const config = {
          matchid: updatedLbMatch.slug,
          num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
          maplist: maps,
          players_per_team: 5,
          clinch_series: true,
          team1: {
            name: team1.name,
            tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
            players: JSON.parse(team1.players),
          },
          team2: {
            name: team2.name,
            tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
            players: JSON.parse(team2.players),
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
