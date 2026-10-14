/**
 * Match event reads (CS2), at /api/events: who is connected, the live score
 * snapshot, and the stored event log of a match or a server. Ready Up's
 * events themselves arrive on the fleet link (fleet/inbound.ts).
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { playerConnectionService } from '../../../services/playerConnectionService';
import { matchLiveStatsService } from '../../../services/matchLiveStatsService';
import type { DbEventRow } from '../../../types/database.types';

const router = Router();

/**
 * GET /api/events/connections/:matchSlug
 * Get player connection status for a match (PUBLIC - for team pages)
 */
router.get('/connections/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    // Kept live by Ready Up's player events (connect, disconnect, ready).
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
