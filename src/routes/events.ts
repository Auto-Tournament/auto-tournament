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
import { handleMatchEvent } from '../services/matchEventHandler';
import { playerConnectionService } from '../services/playerConnectionService';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import { refreshConnectionsFromServer } from '../services/connectionSnapshotService';
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
      ? db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlugOrServerIdFromUrl]) ||
        db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE server_id = ?', [
          matchSlugOrServerIdFromUrl,
        ])
      : null;

    const matchFromPayload = findMatchByIdentifier(event.matchid);
    const resolvedMatch = matchFromUrl || matchFromPayload;

    const actualMatchSlug = resolvedMatch?.slug || String(event.matchid);
    const isNoMatch = actualMatchSlug === '-1';

    console.log(`📍 Match Slug: ${actualMatchSlug} (from ${matchFromUrl ? 'URL' : 'payload'})`);
    log.webhookReceived(event.event, actualMatchSlug);

    // Log full event payload
    console.log('\n📡 FULL EVENT RECEIVED:');
    console.log(JSON.stringify(event, null, 2));
    console.log('---\n');

    // Get server ID
    const serverId =
      resolvedMatch?.server_id || matchSlugOrServerIdFromUrl || 'unknown';

    console.log(
      `🖥️ Server ID: ${serverId} (from ${
        matchFromUrl
          ? 'URL match lookup'
          : resolvedMatch
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
      logWebhookEvent(serverId, actualMatchSlug, event);
      return res.status(200).json({
        success: true,
        message: 'Event received (no active match)',
      });
    }

    // Log to file
    logWebhookEvent(serverId, actualMatchSlug, event);

    // Store event in database
    if (resolvedMatch) {
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

function findMatchByIdentifier(identifier: string | number): DbMatchRow | null {
  if (identifier === undefined || identifier === null) {
    return null;
  }

  const identifierStr = String(identifier);
  const numericId = Number(identifierStr);

  if (!Number.isNaN(numericId)) {
    const byId = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [numericId]);
    if (byId) {
      return byId;
    }
  }

  return db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [identifierStr]) ?? null;
}

/**
 * GET /api/events/connections/:matchSlug
 * Get player connection status for a match (PUBLIC - for team pages)
 */
router.get('/connections/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;

    await refreshConnectionsFromServer(matchSlug);

    const status = playerConnectionService.getStatus(matchSlug);

    if (!status) {
      // Return empty status if match not found
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
    log.error('Error fetching connection status', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch connection status',
    });
  }
});

/**
 * GET /api/events/live/:matchSlug
 * Get latest live stats snapshot for a match (PUBLIC)
 */
router.get('/live/:matchSlug', (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const stats = matchLiveStatsService.getStats(matchSlug);

    if (!stats) {
      return res.json({
        success: true,
        matchSlug,
        team1Score: 0,
        team2Score: 0,
        team1SeriesScore: 0,
        team2SeriesScore: 0,
        roundNumber: 0,
        mapNumber: 0,
        status: 'warmup',
        lastEventAt: Date.now(),
        mapName: null,
      });
    }

    return res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    log.error('Error fetching live stats', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch live stats',
    });
  }
});

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
