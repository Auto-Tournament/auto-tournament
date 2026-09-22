/**
 * Events Routes (CS2 event adapter)
 * Handles MatchZy webhook events at /api/events — the URL every MatchZy
 * plugin in the field is configured with, so it must not change. Mounted
 * through the CS2 integration's `legacyRoutes`.
 *
 * CS2-only side effects stay here: server tracking and health, turnover,
 * attribution to the assigned server, the match report, and (in
 * `./matchEvents`) the live score, connections and stale-event guards. What
 * `normalize()` makes of the event then goes to the core's
 * `matchLifecycle.ingest`, which owns map results and series results.
 *
 * MatchZy Enhanced Retry System:
 * - Events are automatically retried on failure with exponential backoff
 * - Local queue on server survives API downtime
 * - Return 200 OK: Event successfully received (MatchZy marks as sent)
 * - Return 4xx: Validation error (MatchZy will still retry)
 * - Return 5xx: Server error (MatchZy retries with exponential backoff)
 * - Retry schedule: 30s, 1m, 2m, 4m, 8m, 16m, 32m (max 20 attempts)
 * - No events lost during API outages!
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { validateEventToken, validateServerToken } from '../../../middleware/serverAuth';
import { MatchZyEvent } from './matchzy-events.types';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { logWebhookEvent } from '../../../utils/eventLogger';
import { emitMatchEvent, emitServerEvent } from '../../../services/socketService';
import { matchLifecycle } from '../../../core/matchLifecycle';
import { handleMatchEvent } from './matchEvents';
import { playerConnectionService } from '../../../services/playerConnectionService';
import { matchLiveStatsService } from '../../../services/matchLiveStatsService';
import { recordServerTestEvent } from '../services/serverConnectivityService';
import { serverTurnoverTracker } from '../utils/serverTurnover';
import {
  refreshConnectionsFromServer,
  applyMatchReport,
  type MatchReport,
} from './connectionSnapshotService';
import type { DbMatchRow, DbEventRow } from '../../../types/database.types';
import {
  serverTrackingService,
  type ServerConfiguredEvent,
  type Cs2UpdateRequiredEvent,
  type ServerHealthEvent,
} from '../services/serverTrackingService';
import {
  isFromAssignedServer,
  readQueryString,
  resolveReportTarget,
  SERVER_ID_PARAM,
} from '../../../utils/serverAttribution';
import { findActiveMatchForServer } from '../../../services/matchTerminationService';

const router = Router();

/**
 * GET /api/events/test
 * Use this to verify the game server can reach the MAT API (e.g. curl from game host).
 * Check API logs for [EVENTS] Webhook reachability check to confirm.
 */
router.get('/test', (req: Request, res: Response) => {
  log.info('[EVENTS] Webhook reachability check (GET /test)', {
    ip: req.ip ?? req.socket?.remoteAddress,
    ua: req.get('user-agent') ?? undefined,
  });
  res.json({
    success: true,
    message: 'events route is working',
  });
});

/**
 * POST /api/events
 * Receive MatchZy events via webhook (legacy endpoint without server ID)
 */
router.post('/', validateEventToken, async (req: Request, res: Response) => {
  await handleEventRequest(req, res, undefined);
});

/**
 * POST /api/events/report
 * Allows the server plugin to push a full match report directly via HTTP
 * Must be defined BEFORE the catch-all route to avoid matching /report as a parameter
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

    const target = await resolveReportTarget<DbMatchRow>(
      { serverId: String(serverId), matchSlug, report: parsedReport },
      { findByIdentifier: findMatchByIdentifier, findActiveForServer: findActiveMatchForServer }
    );

    if (target.kind === 'ignore') {
      // Answer 200 so the plugin does not retry. None of these are errors: the
      // plugin also reports on warmup_start when no match is loaded (autostarted
      // warmup after a restart or reset), and a 404 logged a warning every time.
      if (target.reason === 'wrong-server') {
        // The report names its server. One that is not running this match (it
        // loaded a stale or duplicate copy) must not overwrite the real report.
        log.warn('[MatchReport] Ignoring report from a server not assigned to the match', {
          matchSlug: target.match?.slug,
          assignedServerId: target.match?.server_id,
          reportServerId: serverId,
        });
      } else {
        log.debug('[MatchReport] Report with no active match; nothing to apply', {
          serverId,
          matchSlug: matchSlug ?? null,
          reason: target.reason,
        });
      }
      return res.status(200).json({
        success: true,
        ignored: true,
        message:
          target.reason === 'wrong-server'
            ? 'Report ignored: server is not assigned to this match'
            : target.reason === 'idle-server'
              ? 'Report ignored: no match loaded on this server'
              : 'Report ignored: no match found for this server',
      });
    }

    const match = target.match;
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
 * POST /api/events/:matchSlugOrServerId
 * Receive MatchZy events via webhook with match slug or server ID in URL
 */
router.post('/:matchSlugOrServerId', validateEventToken, async (req: Request, res: Response) => {
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
  const body = req.body as MatchZyEvent | undefined;
  const eventType = body?.event;
  const payloadServerId = (body as { server_id?: string })?.server_id;
  // Set by MAT in the webhook URL it gives each server (see serverAttribution).
  const urlServerId = readQueryString(req.query?.[SERVER_ID_PARAM]);

  log.info('[EVENTS] Incoming webhook', {
    path: req.path,
    event: eventType ?? '(missing)',
    server_id: payloadServerId ?? urlServerId ?? '(none)',
    urlParam: matchSlugOrServerIdFromUrl ?? '(none)',
  });

  try {
    const event: MatchZyEvent | undefined = body;

    if (!event?.event) {
      log.warn('[EVENTS] Rejected: missing event type', { path: req.path });
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

    // Server-level events (server_configured, server_health, the connectivity
    // probe) describe the server, not a match, and carry no matchid at all —
    // so this cannot assume the field is there. It previously read it off every
    // event and logged server events against the slug "undefined".
    const payloadMatchId = 'matchid' in event ? event.matchid : undefined;

    const matchFromPayload =
      payloadMatchId === undefined ? null : await findMatchByIdentifier(payloadMatchId);
    const resolvedMatch = matchFromUrl || matchFromPayload;

    const actualMatchSlug =
      resolvedMatch?.slug ?? (payloadMatchId === undefined ? '-1' : String(payloadMatchId));
    const isNoMatch = actualMatchSlug === '-1';

    log.webhookReceived(event.event, actualMatchSlug);

    // The server that actually sent the request, when it identified itself.
    const sourceServerId = urlServerId || payloadServerId || null;

    const serverId =
      sourceServerId || resolvedMatch?.server_id || matchSlugOrServerIdFromUrl || 'unknown';

    // Handle server_configured event from MatchZy Enhanced
    // Sent when server is configured with webhook URL or on startup
    if (event.event === 'server_configured') {
      const ev = event as ServerConfiguredEvent;
      await serverTrackingService.handleServerConfigured(ev);

      log.info('[EVENTS] server_configured handled', {
        server_id: ev.server_id,
        hostname: ev.hostname,
        plugin_version: ev.plugin_version,
      });

      if (serverId && serverId !== 'unknown') {
        await serverTrackingService.updateHeartbeat(serverId);
      } else if (ev.server_id) {
        await serverTrackingService.updateHeartbeat(ev.server_id);
      }

      return res.status(200).json({
        success: true,
        message: 'Server registered successfully',
      });
    }

    // Handle special connectivity test events from MatchZy.
    // These are used to verify that the server can reach our /api/events endpoint.
    if (event.event === 'test_event' || event.event === 'MatchZyTestEvent') {
      if (serverId && serverId !== 'unknown') {
        recordServerTestEvent(serverId);
      }
    }

    // Handle CS2 update-required marker from MatchZy Enhanced safe auto-updater.
    // This is a server-level signal (matchid=-1) and should not enter the match event pipeline.
    if (event.event === 'cs2_update_required') {
      const ev = event as Cs2UpdateRequiredEvent;
      const effectiveServerId = ev.server_id || serverId;
      if (effectiveServerId && effectiveServerId !== 'unknown') {
        await serverTrackingService.setCs2UpdateRequired(effectiveServerId, ev.required_version, {
          phase: ev.phase ?? null,
          timestamp: ev.timestamp,
        });

        log.warn('[EVENTS] CS2 update required reported by server', {
          server_id: effectiveServerId,
          required_version: ev.required_version,
          phase: ev.phase ?? null,
        });
      }

      // Still log and fan out for admin monitoring.
      logWebhookEvent(serverId, actualMatchSlug, event);
      return res.status(200).json({
        success: true,
        message: 'CS2 update-required event received',
      });
    }
    
    // Handle server health signals (DB connectivity etc).
    // This is a server-level signal and should not enter the match event pipeline.
    if (event.event === 'server_health') {
      const ev = event as ServerHealthEvent;
      const effectiveServerId = ev.server_id || serverId;
      if (effectiveServerId && effectiveServerId !== 'unknown') {
        await serverTrackingService.setServerHealth(effectiveServerId, {
          dbOk: Boolean(ev.db_ok),
          dbType: String(ev.db_type || ''),
          dbError: ev.db_error ?? null,
          timestamp: ev.timestamp,
        });
        await serverTrackingService.updateHeartbeat(effectiveServerId);
      }

      // Still log and fan out for admin monitoring.
      logWebhookEvent(serverId, actualMatchSlug, event);
      return res.status(200).json({
        success: true,
        message: 'Server health event received',
      });
    }

    // Update server heartbeat for ALL events (shows server is alive)
    if (serverId && serverId !== 'unknown') {
      await serverTrackingService.updateHeartbeat(serverId);
    }

    // Demo recording/upload and series lifecycle decide when this server may
    // take its next match (see serverTurnover). Recorded against the server
    // that sent the event, before any match-level filtering: an upload in
    // progress holds the server whichever match it belongs to.
    if (sourceServerId) {
      serverTurnoverTracker.recordEvent(
        sourceServerId,
        event as unknown as Record<string, unknown>,
        Math.floor(Date.now() / 1000)
      );
    }

    // Emit server-level event for admin monitoring UI (Server Events Monitor).
    // This allows the frontend to subscribe to `server:event` and
    // `server:event:{serverId}` streams without needing to join on matches.
    if (serverId && serverId !== 'unknown') {
      emitServerEvent(serverId, {
        timestamp: Date.now(),
        matchSlug: actualMatchSlug,
        event,
      });
    }

    // Handle events with no match loaded
    if (isNoMatch) {
      log.info('[EVENTS] Event received, no match loaded', {
        matchid: actualMatchSlug,
        event: event.event,
        serverId,
      });
      logWebhookEvent(serverId, actualMatchSlug, event);
      return res.status(200).json({
        success: true,
        message: 'Event received (no active match)',
      });
    }

    // An event for a match from a server the match is not assigned to. This is
    // how one match got results from two servers: a load MAT gave up on was
    // queued by the plugin and played later alongside the re-allocated copy,
    // and its map_result overwrote the real one. Answer 200 so the plugin does
    // not retry it forever, but apply nothing.
    if (resolvedMatch && !isFromAssignedServer(resolvedMatch.server_id, sourceServerId)) {
      log.warn('[EVENTS] Ignoring event from a server not assigned to the match', {
        event: event.event,
        matchSlug: resolvedMatch.slug,
        matchId: resolvedMatch.id,
        assignedServerId: resolvedMatch.server_id,
        sourceServerId,
      });
      logWebhookEvent(serverId, actualMatchSlug, event);
      return res.status(200).json({
        success: true,
        ignored: true,
        message: 'Event ignored: server is not assigned to this match',
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

    // Process the event: the CS2 side effects, then the normalized events in
    // the core (map results, series end).
    const lifecycleEvents = await handleMatchEvent(event, resolvedMatch?.slug);
    await matchLifecycle.ingest(lifecycleEvents);

    // Emit real-time event via Socket.io
    emitMatchEvent(actualMatchSlug, event);

    // Respond to MatchZy - 200 OK tells MatchZy the event was successfully received
    return res.status(200).json({
      success: true,
      message: 'Event received',
    });
  } catch (error) {
    log.error('Error processing MatchZy event', error);
    
    // Return 500 so MatchZy's automatic retry system will queue this event
    // and retry with exponential backoff. This ensures no events are lost
    // during temporary API issues (database timeouts, memory issues, etc.)
    return res.status(500).json({
      success: false,
      error: 'Internal server error - event will be retried by the Auto Tournament plugin',
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
    const byId = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
      numericId,
    ]);
    if (byId) {
      return byId;
    }
  }

  return (
    (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [identifierStr])) ??
    null
  );
}

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
      // No in‑memory live stats for this match (likely completed or server restarted).
      // Return success: false so callers can fall back to persisted DB state
      // instead of overwriting scores with 0‑0.
      return res.json({
        success: false,
        matchSlug,
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
 * GET /api/events/server/:serverId
 * Get recent events for a specific server (for admin Server Events Monitor)
 */
router.get('/server/:serverId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    // Fetch latest events for matches currently (or previously) associated with this server.
    // We join via matches so we can derive server_id from match_slug.
    const rows = await db.queryAsync<
      DbEventRow & {
        match_slug: string;
        server_id: string | null;
      }
    >(
      `
        SELECT me.id,
               me.match_slug,
               me.event_type,
               me.event_data,
               me.received_at,
               m.server_id
        FROM match_events me
        JOIN matches m ON m.slug = me.match_slug
        WHERE m.server_id = ?
        ORDER BY me.received_at DESC, me.id DESC
        LIMIT ?
      `,
      [serverId, limit]
    );

    const events = rows.map((row) => ({
      timestamp: (row.received_at || 0) * 1000,
      serverId,
      matchSlug: row.match_slug,
      event: (() => {
        try {
          return JSON.parse(row.event_data);
        } catch {
          return { event: row.event_type, raw: row.event_data };
        }
      })(),
    }));

    return res.json({
      success: true,
      events,
    });
  } catch (error) {
    log.error('Error fetching server events', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch server events',
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

    query += ' ORDER BY received_at DESC, id DESC LIMIT ?';
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
