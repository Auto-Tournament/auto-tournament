import { Router, Request, Response } from 'express';
import { validateServerToken } from '../middleware/serverAuth';
import { MatchZyEvent } from '../types/matchzy-events.types';
import { db } from '../config/database';
import { log } from '../utils/logger';

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

    // Store event in database
    db.insert('match_events', {
      match_slug: event.matchid,
      event_type: event.event,
      event_data: JSON.stringify(event),
      received_at: Math.floor(Date.now() / 1000),
    });

    // Handle specific events
    handleEvent(event);

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
router.get('/:matchSlug', (req: Request, res: Response) => {
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

    const events = db.query(query, params);

    return res.json({
      success: true,
      count: events.length,
      events: events.map((e: any) => ({
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
      db.exec(`UPDATE matches SET status = 'live' WHERE slug = '${event.matchid}'`);
      break;

    case 'series_end':
      log.success(
        `Series ended! Winner: ${event.winner} (${event.team1_series_score}-${event.team2_series_score})`,
        { matchId: event.matchid, winner: event.winner }
      );
      // Update match status to 'completed'
      db.exec(`UPDATE matches SET status = 'completed' WHERE slug = '${event.matchid}'`);
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
      break;

    case 'player_disconnect':
      log.debug(`Player disconnected: ${event.player.name}`, { steamId: event.player.steamid });
      break;

    case 'going_live':
      log.success(`Map ${event.map_number} going live!`, { matchId: event.matchid });
      break;

    default:
      // Log all other events for debugging
      log.debug(`Event received: ${event.event}`, { matchId: event.matchid });
  }
}

export default router;
