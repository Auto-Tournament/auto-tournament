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
import { resolveViewerIdentity } from '../../../utils/viewerIdentity';
import { viewerTeamIdOfMatch } from '../../../services/matchViewer';
import { gotvHosts, gotvPassword, matchGotvSettings } from '../gotv';

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
router.get('/live/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    // People who do not play in it see it as GOTV does (gotv.ts): delayed, live or not at all.
    const delay = await spectatorDelay(req, matchSlug);
    if (delay === 'off') return res.json({ success: false, matchSlug, hidden: true });
    const stats =
      delay > 0
        ? matchLiveStatsService.getStatsDelayed(matchSlug, delay)
        : matchLiveStatsService.getStats(matchSlug);

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
      ...(delay > 0 ? { delaySeconds: delay } : {}),
    });
  } catch (error) {
    log.error('Error fetching live stats', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch live stats',
    });
  }
});

/** How a viewer sees a match's live table: 0 (live: a player, an admin), the GOTV delay, or 'off'. */
async function spectatorDelay(req: Request, matchSlug: string): Promise<number | 'off'> {
  const settings = await matchGotvSettings(matchSlug);
  if (settings.liveStats === 'live') return 0;
  const identity = await resolveViewerIdentity(req);
  if (identity.isRealAdmin) return 0;
  const match = await db.queryOneAsync<{
    game: string | null;
    config: string | null;
    team1_id: string | null;
    team2_id: string | null;
  }>('SELECT game, config, team1_id, team2_id FROM matches WHERE slug = ?', [matchSlug]);
  if (match && (await viewerTeamIdOfMatch(req, match as Parameters<typeof viewerTeamIdOfMatch>[1])))
    return 0;
  return settings.liveStats === 'off' ? 'off' : settings.delay;
}

/**
 * GET /api/events/watch/:matchSlug
 * Watching a match in GOTV (public; gotv.ts): `state` is live (with `connect`
 * for a viewer who may watch), before (the map is not live yet), off (GOTV
 * is off, or not for this viewer), player (they play in it: no Watch button)
 * or none (not on a server). Never the address to someone who may not watch.
 */
router.get('/watch/:matchSlug', async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const settings = await matchGotvSettings(matchSlug);
    const base = {
      success: true,
      delay: settings.delay,
      seats: settings.seats,
      access: settings.access,
    };
    const match = await db.queryOneAsync<{
      game: string | null;
      config: string | null;
      team1_id: string | null;
      team2_id: string | null;
      server_id: string | null;
      status: string;
      on_stage: number | null;
    }>(
      'SELECT game, config, team1_id, team2_id, server_id, status, on_stage FROM matches WHERE slug = ?',
      [matchSlug]
    );
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
    if (!settings.enabled) return res.json({ ...base, state: 'off' });
    const identity = await resolveViewerIdentity(req);
    if (await viewerTeamIdOfMatch(req, match as Parameters<typeof viewerTeamIdOfMatch>[1])) {
      return res.json({ ...base, state: 'player' });
    }
    const allowed =
      settings.access === 'everyone' ||
      (settings.access === 'signed_in' && Boolean(identity.effectiveSteamId)) ||
      identity.isRealAdmin;
    if (!allowed) return res.json({ ...base, state: 'off', reason: settings.access });
    if (!match.server_id || !['loaded', 'live'].includes(match.status))
      return res.json({ ...base, state: 'none' });
    const live = matchLiveStatsService.getStats(matchSlug);
    if (match.status !== 'live' && live?.status !== 'live')
      return res.json({ ...base, state: 'before' });
    const address = await gotvAddress(match.server_id, req);
    if (!address) return res.json({ ...base, state: 'off', reason: 'no_port' });
    const password = await gotvPassword(matchSlug);
    return res.json({
      ...base,
      state: 'live',
      onStage: Number(match.on_stage ?? 0) === 1,
      seats: Number(match.on_stage ?? 0) === 1 ? 128 : settings.seats,
      connect: `connect ${address}; password ${password}`,
      steamUrl: `steam://connect/${address}/${password}`,
    });
  } catch (error) {
    log.error('Error reading how to watch a match', error);
    return res.status(500).json({ success: false, error: 'Failed to read how to watch' });
  }
});

/** host:tv_port of a match's server, the LAN or public host as for players (fleet/connectChoice). */
async function gotvAddress(serverId: string, req: Request): Promise<string | null> {
  const viewerIp = req.get('cf-connecting-ip') || req.ip || null;
  const where = await gotvHosts(serverId, viewerIp);
  return where?.recommended ? `${where.recommended}:${where.port}` : null;
}

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
