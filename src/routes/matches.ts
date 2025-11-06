import { Router, Request, Response } from 'express';
import { matchService } from '../services/matchService';
import { rconService } from '../services/rconService';
import { matchAllocationService } from '../services/matchAllocationService';
import { CreateMatchInput } from '../types/match.types';
import { requireAuth } from '../middleware/auth';
import {
  getMatchZyWebhookCommands,
  getMatchZyDemoUploadCommand,
  getMatchZyLoadMatchAuthCommands,
} from '../utils/matchzyConfig';
import { log } from '../utils/logger';
import { db } from '../config/database';
import type { DbMatchRow, DbEventRow } from '../types/database.types';
import { getBaseUrl, getWebhookBaseUrl } from '../utils/urlHelper';
import { emitMatchUpdate, emitBracketUpdate } from '../services/socketService';

const router = Router();

/**
 * GET /api/matches/:slug.json
 * Protected endpoint for MatchZy to fetch match configuration
 * Requires bearer token authentication from game server
 */
router.get('/:slug.json', (req: Request, res: Response) => {
  try {
    // Check for bearer token (uses same SERVER_TOKEN as webhook auth)
    // const authHeader = req.headers.authorization;
    // const expectedToken = process.env.SERVER_TOKEN;

    // if (!expectedToken) {
    //   return res.status(500).json({
    //     success: false,
    //     error: 'SERVER_TOKEN environment variable is not configured',
    //   });
    // }

    // if (!authHeader || !authHeader.startsWith('Bearer ')) {
    //   return res.status(401).json({
    //     success: false,
    //     error: 'Missing or invalid authorization header. Expected: Bearer <token>',
    //   });
    // }

    // const token = authHeader.substring(7); // Remove "Bearer " prefix
    // if (token !== expectedToken) {
    //   return res.status(403).json({
    //     success: false,
    //     error: 'Invalid bearer token',
    //   });
    // }

    // Token is valid, fetch config
    const { slug } = req.params;
    const config = matchService.getMatchConfig(slug);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: `Match configuration '${slug}' not found`,
      });
    }

    // Return raw MatchZy config
    return res.json(config);
  } catch (error) {
    console.error('Error fetching match config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match configuration',
    });
  }
});

/**
 * GET /api/matches
 * List all matches (authenticated)
 * Returns tournament matches with team information
 */
router.get('/', requireAuth, (req: Request, res: Response) => {
  try {
    const serverId = req.query.serverId as string | undefined;

    // Fetch matches with tournament information
    let query = `
      SELECT 
        m.*,
        t1.id as team1_id, t1.name as team1_name, t1.tag as team1_tag,
        t2.id as team2_id, t2.name as team2_name, t2.tag as team2_tag,
        w.id as winner_id, w.name as winner_name, w.tag as winner_tag
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN teams w ON m.winner_id = w.id
    `;

    const params: unknown[] = [];
    if (serverId) {
      query += ' WHERE m.server_id = ?';
      params.push(serverId);
    }

    query += ' ORDER BY m.created_at DESC';

    // This query includes JOIN columns that extend DbMatchRow
    const rows = db.query<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team2_name?: string;
        team2_tag?: string;
        winner_name?: string;
        winner_tag?: string;
        demo_file_path?: string;
      }
    >(query, params);

    const matches = rows.map((row) => {
      const config = row.config ? JSON.parse(row.config as string) : {};
      const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

      const match: Record<string, unknown> = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        team1: row.team1_id
          ? {
              id: row.team1_id,
              name: row.team1_name,
              tag: row.team1_tag,
            }
          : undefined,
        team2: row.team2_id
          ? {
              id: row.team2_id,
              name: row.team2_name,
              tag: row.team2_tag,
            }
          : undefined,
        winner: row.winner_id
          ? {
              id: row.winner_id,
              name: row.winner_name,
              tag: row.winner_tag,
            }
          : undefined,
        status: row.status,
        serverId: row.server_id,
        config,
        demoFilePath: row.demo_file_path,
        createdAt: row.created_at,
        loadedAt: row.loaded_at,
        completedAt: row.completed_at,
        vetoCompleted: vetoState?.status === 'completed',
      };

      // Get latest player stats from match events
      const playerStatsEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type = 'player_stats' 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (playerStatsEvent) {
        try {
          const eventData = JSON.parse(playerStatsEvent.event_data);
          if (eventData.team1_players) {
            match.team1Players = eventData.team1_players;
          }
          if (eventData.team2_players) {
            match.team2Players = eventData.team2_players;
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Get latest scores from series_end or round_end events
      const scoreEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type IN ('series_end', 'round_end', 'map_end') 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (scoreEvent) {
        try {
          const eventData = JSON.parse(scoreEvent.event_data);
          if (eventData.team1_series_score !== undefined) {
            match.team1Score = eventData.team1_series_score;
          }
          if (eventData.team2_series_score !== undefined) {
            match.team2Score = eventData.team2_series_score;
          }
        } catch {
          // Ignore parse errors
        }
      }

      return match;
    });

    // Get tournament status
    const tournament = db.queryOne<{ status: string }>(
      'SELECT status FROM tournament WHERE id = 1'
    );

    return res.json({
      success: true,
      count: matches.length,
      tournamentStatus: tournament?.status || 'setup',
      matches,
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch matches',
    });
  }
});

/**
 * GET /api/matches/:slug
 * Get match details (authenticated)
 */
router.get('/:slug', requireAuth, (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const match = matchService.getMatchBySlug(slug, getBaseUrl(req));

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    return res.json({
      success: true,
      match,
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match',
    });
  }
});

/**
 * POST /api/matches
 * Create a new match configuration (authenticated)
 */
router.post('/', requireAuth, (req: Request, res: Response) => {
  try {
    const input: CreateMatchInput = req.body;

    if (!input.slug || !input.serverId || !input.config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: slug, serverId, config',
      });
    }

    // Validate config structure
    if (!input.config.team1 || !input.config.team2) {
      return res.status(400).json({
        success: false,
        error: 'Match config must include team1 and team2',
      });
    }

    const match = matchService.createMatch(input, getBaseUrl(req));

    return res.status(201).json({
      success: true,
      message: 'Match created successfully',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create match';
    const statusCode = message.includes('already exists')
      ? 409
      : message.includes('not found')
      ? 404
      : 400;

    console.error('Error creating match:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/matches/:slug/load
 * Load match on server via RCON (authenticated)
 * Automatically configures webhook unless ?skipWebhook=true
 */
router.post('/:slug/load', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const skipWebhook = req.query.skipWebhook === 'true';
    const match = matchService.getMatchBySlug(slug, getBaseUrl(req));

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const results = [];
    let webhookConfigured = false;

    // Configure webhook by default (unless explicitly skipped)
    if (!skipWebhook) {
      const serverToken = process.env.SERVER_TOKEN || '';
      if (!serverToken) {
        log.warn('SERVER_TOKEN not configured - skipping webhook setup');
      } else {
        const baseUrl = getWebhookBaseUrl(req);
        const webhookUrl = `${baseUrl}/api/events/${slug}`;
        log.webhookConfigured(match.serverId, webhookUrl);

        const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, slug);
        for (const cmd of webhookCommands) {
          const result = await rconService.sendCommand(match.serverId, cmd);
          results.push(result);
        }
        webhookConfigured = true;
      }
    }

    // Configure demo upload URL
    const baseUrl = getWebhookBaseUrl(req);
    const demoUploadCommand = getMatchZyDemoUploadCommand(baseUrl, slug);
    const demoResult = await rconService.sendCommand(match.serverId, demoUploadCommand);
    results.push(demoResult);
    if (demoResult.success) {
      log.debug(`Demo upload configured for match ${slug}`);
    }

    // Configure bearer token auth for match config loading
    const serverToken = process.env.SERVER_TOKEN;
    if (serverToken) {
      log.debug(`Configuring match config auth for ${match.serverId}`);
      const authCommands = getMatchZyLoadMatchAuthCommands(serverToken);
      for (const cmd of authCommands) {
        const result = await rconService.sendCommand(match.serverId, cmd);
        results.push(result);
      }
      log.debug(`Match config auth configured for ${match.serverId}`);
    } else {
      log.warn(`No SERVER_TOKEN set - match loading will fail. Please set SERVER_TOKEN in .env`);
    }

    // Send RCON command to load match
    const configUrl = match.configUrl;
    const loadResult = await rconService.sendCommand(
      match.serverId,
      `matchzy_loadmatch_url "${configUrl}"`
    );
    results.push(loadResult);

    if (loadResult.success) {
      // Update match status
      matchService.updateMatchStatus(slug, 'loaded');
      log.matchLoaded(slug, match.serverId, webhookConfigured);
    } else {
      log.error(`Failed to load match ${slug} on server ${match.serverId}`, undefined, {
        command: loadResult.command,
      });
    }

    const allSuccessful = results.every((r) => r.success);

    return res.status(allSuccessful ? 200 : 400).json({
      success: allSuccessful,
      message: allSuccessful
        ? webhookConfigured
          ? 'Match loaded and webhook configured'
          : 'Match loaded (webhook skipped)'
        : 'Failed to load match',
      webhookConfigured,
      match: matchService.getMatchBySlug(slug, getBaseUrl(req)),
      rconResponses: results,
    });
  } catch (error) {
    console.error('Error loading match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load match on server',
    });
  }
});

/**
 * POST /api/matches/:slug/restart
 * Restart a match - end it and reload it (authenticated)
 */
router.post('/:slug/restart', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const baseUrl = getWebhookBaseUrl(req);

    const result = await matchAllocationService.restartMatch(slug, baseUrl);

    if (result.success) {
      log.success(`Match ${slug} restarted successfully`);

      // Emit match restart event
      const updatedMatch = matchService.getMatchBySlug(slug, baseUrl);
      if (updatedMatch) {
        emitMatchUpdate(updatedMatch as unknown as Record<string, unknown>);
        emitBracketUpdate({ action: 'match_restarted', matchSlug: slug });
      }

      return res.json({
        success: true,
        message: result.message,
        match: updatedMatch,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    log.error(`Error restarting match`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart match',
    });
  }
});

/**
 * PATCH /api/matches/:slug/status
 * Update match status (authenticated)
 */
router.patch('/:slug/status', requireAuth, (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'loaded', 'live', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, loaded, live, or completed',
      });
    }

    matchService.updateMatchStatus(slug, status);
    const match = matchService.getMatchBySlug(slug, getBaseUrl(req));

    return res.json({
      success: true,
      message: 'Match status updated',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update status';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error updating match status:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/matches/:slug
 * Delete a match (authenticated)
 */
router.delete('/:slug', requireAuth, (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    matchService.deleteMatch(slug);

    return res.json({
      success: true,
      message: 'Match deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete match';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error deleting match:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

export default router;
