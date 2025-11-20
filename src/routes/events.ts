/**
 * Events Routes
 * Handles MatchZy webhook events
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateServerToken } from '../middleware/serverAuth';
import { MatchZyEvent } from '../types/matchzy-events.types';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { logWebhookEvent } from '../utils/eventLogger';
import { emitMatchEvent } from '../services/socketService';
import { handleMatchEvent } from '../services/matchEventHandler';
import { playerConnectionService } from '../services/playerConnectionService';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import {
  refreshConnectionsFromServer,
  applyMatchReport,
  type MatchReport,
} from '../services/connectionSnapshotService';
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
router.post('/', async (req: Request, res: Response) => {
  await handleEventRequest(req, res, undefined);
});

/**
 * POST /api/events/:matchSlugOrServerId
 * Receive MatchZy events via webhook with match slug or server ID in URL
 */
router.post('/:matchSlugOrServerId', async (req: Request, res: Response) => {
  const identifier = req.params.matchSlugOrServerId;
  await handleEventRequest(req, res, identifier);
});

/**
 * Handle incoming event request
 */
async function handleEventRequest(
  req: Request,
  res: Response,
  matchSlugOrServerIdFromUrl?: string
): Promise<Response> {
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
      ? (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
          matchSlugOrServerIdFromUrl,
        ])) ||
        (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE server_id = ?', [
          matchSlugOrServerIdFromUrl,
        ]))
      : null;

    const matchFromPayload = await findMatchByIdentifier(event.matchid);
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
    const serverId = resolvedMatch?.server_id || matchSlugOrServerIdFromUrl || 'unknown';

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
        await db.insertAsync('match_events', {
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
    await handleMatchEvent(event);

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

async function findMatchByIdentifier(identifier: string | number): Promise<DbMatchRow | null> {
  if (identifier === undefined || identifier === null) {
    return null;
  }

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

/**
 * POST /api/events/report
 * Allows the server plugin to push a full match report directly via HTTP
 */
router.post('/report', validateServerToken, async (req: Request, res: Response) => {
  try {
    const { serverId, matchSlug, report } = req.body ?? {};

    if (!serverId || !report) {
      return res.status(400).json({
        success: false,
        error: 'serverId and report are required',
      });
    }

    let match: DbMatchRow | null = null;
    if (matchSlug !== undefined && matchSlug !== null) {
      match = await findMatchByIdentifier(matchSlug);
    }
    if (!match) {
      match =
        (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE server_id = ?', [serverId])) ?? null;
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found for provided identifiers',
      });
    }

    let parsedReport: MatchReport;
    try {
      parsedReport =
        typeof report === 'string' ? (JSON.parse(report) as MatchReport) : (report as MatchReport);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Report must be valid JSON',
      });
    }

    if (!parsedReport || typeof parsedReport !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Report payload is invalid',
      });
    }

    await applyMatchReport(match.slug, parsedReport);

    log.info('[MatchReport] Report ingested via plugin POST', {
      matchSlug: match.slug,
      serverId,
    });

    return res.json({ success: true });
  } catch (error) {
    log.error('Failed to ingest match report via plugin POST', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to ingest match report',
    });
  }
});

/**
 * GET /api/events/connections/:matchSlug
 * Get player connection status for a match (PUBLIC - for team pages)
 */
const CONNECTION_SNAPSHOT_TTL_MS = 5000;

router.get('/connections/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const force = req.query.force === 'true';

    const existingStatus = playerConnectionService.getStatus(matchSlug);
    const isStale =
      !existingStatus ||
      Date.now() - (existingStatus.lastUpdated ?? 0) > CONNECTION_SNAPSHOT_TTL_MS;

    if (force || isStale) {
      await refreshConnectionsFromServer(matchSlug, { force });
    }

    const status = playerConnectionService.getStatus(matchSlug) ?? existingStatus;

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
        totalMaps: 1,
        playerStats: null,
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
router.get('/:matchSlug', requireAuth, async (req: Request, res: Response) => {
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

    const events = await db.queryAsync<DbEventRow>(query, params);

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
