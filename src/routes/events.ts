/**
 * Events Routes
 * Handles MatchZy webhook events
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { MatchZyEvent } from '../types/matchzy-events.types';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { logWebhookEvent } from '../utils/eventLogger';
import { emitMatchEvent } from '../services/socketService';
import { eventBufferService } from '../services/eventBufferService';
import { handleMatchEvent } from '../services/matchEventHandler';
import type { DbMatchRow, DbEventRow } from '../types/database.types';

const router = Router();

/**
 * GET /api/events/test
 */
router.get('/test', (_req: Request, res: Response) => {
  res.send('hello - events route is working');
});

/**
 * POST /api/events
 * Receive MatchZy events via webhook (legacy endpoint without server ID)
 */
router.post('/', (req: Request, res: Response) => {
  handleEventRequest(req, res, undefined);
});

/**
 * POST /api/events/:matchSlugOrServerId
 * Receive MatchZy events via webhook with match slug or server ID in URL
 */
router.post('/:matchSlugOrServerId', (req: Request, res: Response) => {
  const identifier = req.params.matchSlugOrServerId;
  handleEventRequest(req, res, identifier);
});

/**
 * Handle incoming event request
 */
function handleEventRequest(
  req: Request,
  res: Response,
  matchSlugOrServerIdFromUrl?: string
): Response {
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

    // Determine match slug from URL or payload
    const matchFromUrl = matchSlugOrServerIdFromUrl
      ? db.queryOne<DbMatchRow>('SELECT server_id, slug FROM matches WHERE slug = ?', [
          matchSlugOrServerIdFromUrl,
        ])
      : null;

    const actualMatchSlug = matchFromUrl?.slug || String(event.matchid);
    const isNoMatch = actualMatchSlug === '-1';

    console.log(`📍 Match Slug: ${actualMatchSlug} (from ${matchFromUrl ? 'URL' : 'payload'})`);
    log.webhookReceived(event.event, actualMatchSlug);

    // Log full event payload
    console.log('\n📡 FULL EVENT RECEIVED:');
    console.log(JSON.stringify(event, null, 2));
    console.log('---\n');

    // Get server ID
    const match = !isNoMatch
      ? db.queryOne<DbMatchRow>('SELECT server_id FROM matches WHERE slug = ?', [actualMatchSlug])
      : matchFromUrl;

    const serverId =
      matchFromUrl?.server_id || match?.server_id || matchSlugOrServerIdFromUrl || 'unknown';

    console.log(
      `🖥️ Server ID: ${serverId} (from ${
        matchFromUrl
          ? 'URL match lookup'
          : match?.server_id
          ? 'matchid lookup'
          : matchSlugOrServerIdFromUrl
          ? 'URL fallback'
          : 'unknown'
      })`
    );

    // Handle events with no match loaded
    if (isNoMatch) {
      console.log(
        `ℹ️ Event received but no match is loaded (matchid: ${actualMatchSlug}). Event type: ${event.event}`
      );
      console.log('   This is normal during server startup or between matches.');
      logWebhookEvent(serverId, event);
      return res.status(200).json({
        success: true,
        message: 'Event received (no active match)',
      });
    }

    // Log to file
    logWebhookEvent(serverId, event);

    // Store event in database
    if (match) {
      try {
        db.insert('match_events', {
          match_slug: actualMatchSlug,
          event_type: event.event,
          event_data: JSON.stringify(event),
          received_at: Math.floor(Date.now() / 1000),
        });
      } catch (insertError) {
        log.error(
          `Failed to insert event to database (match: ${actualMatchSlug}, event: ${event.event})`,
          insertError
        );
      }
    } else {
      log.warn(
        `Event received for unknown match: ${actualMatchSlug}. Event will not be stored in database.`
      );
    }

    // Add to event buffer
    eventBufferService.addEvent(serverId, actualMatchSlug, event);

    // Process the event
    handleMatchEvent(event);

    // Emit real-time event via Socket.io
    emitMatchEvent(actualMatchSlug, event as unknown as Record<string, unknown>);

    // Respond to MatchZy
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
 * GET /api/events/:matchSlug
 * Get all events for a specific match
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
      data: events.map((e) => ({
        ...e,
        event_data: JSON.parse(e.event_data),
      })),
    });
  } catch (error) {
    log.error('Error fetching match events', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch events',
    });
  }
});

export default router;
