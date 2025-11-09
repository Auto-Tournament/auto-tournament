import { Router, Request, Response } from 'express';
import { matchService } from '../services/matchService';
import { matchAllocationService } from '../services/matchAllocationService';
import { loadMatchOnServer } from '../services/matchLoadingService';
import { CreateMatchInput, MatchListItem } from '../types/match.types';
import { TournamentResponse } from '../types/tournament.types';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import { getBaseUrl, getWebhookBaseUrl } from '../utils/urlHelper';
import { emitMatchUpdate, emitBracketUpdate } from '../services/socketService';
import { generateMatchConfig } from '../services/matchConfigBuilder';
import { enrichMatch } from '../utils/matchEnrichment';

const router = Router();

/**
 * GET /api/matches/:slug.json
 * Protected endpoint for MatchZy to fetch match configuration
 * Returns a FRESH, on-demand config assembled from DB (reads veto_state)
 * Requires bearer token authentication from game server (kept commented for local dev)
 */
router.get('/:slug.json', async (req: Request, res: Response) => {
  try {
    // // Optional bearer token auth — enable when you wire SERVER_TOKEN on the game server
    // const authHeader = req.headers.authorization;
    // const expectedToken = process.env.SERVER_TOKEN;
    // if (!expectedToken) {
    //   return res.status(500).json({
    //     success: false,
    //     error: 'SERVER_TOKEN environment variable is not configured',
    //   });
    // }
    // if (!authHeader?.startsWith('Bearer ')) {
    //     return res.status(401).json({
    //       success: false,
    //       error: 'Missing or invalid authorization header. Expected: Bearer <token>',
    //     });
    // }
    // const token = authHeader.substring(7);
    // if (token !== expectedToken) {
    //   return res.status(403).json({ success: false, error: 'Invalid bearer token' });
    // }

    const { slug } = req.params;

    // 1) Load the match row
    const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match configuration '${slug}' not found`,
      });
    }

    // 2) Load the tournament row
    const t = db.queryOne<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      match.tournament_id ?? 1,
    ]);
    if (!t) {
      return res.status(500).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    // 3) Hydrate a Tournament-like object for config generation
    const tournament: TournamentResponse = {
      id: t.id,
      name: t.name,
      type: t.type as TournamentResponse['type'],
      format: t.format as TournamentResponse['format'],
      status: t.status as TournamentResponse['status'],
      maps: JSON.parse(t.maps),
      teamIds: JSON.parse(t.team_ids),
      settings: t.settings ? JSON.parse(t.settings) : {},
      created_at: t.created_at,
      updated_at: t.updated_at ?? t.created_at,
      started_at: t.started_at,
      completed_at: t.completed_at,
      teams: [], // Not needed for config generation
    };

    // 4) Generate a fresh config (reads veto_state internally)
    const fresh = await generateMatchConfig(
      tournament,
      match.team1_id ?? undefined,
      match.team2_id ?? undefined,
      slug
    );

    // Return raw MatchZy config
    return res.json(fresh);
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

    const matches: MatchListItem[] = rows.map((row) => {
      const config = row.config ? JSON.parse(row.config as string) : {};
      const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

      const match: MatchListItem = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        team1:
          row.team1_id && row.team1_name
            ? {
                id: row.team1_id,
                name: row.team1_name,
                tag: row.team1_tag,
              }
            : undefined,
        team2:
          row.team2_id && row.team2_name
            ? {
                id: row.team2_id,
                name: row.team2_name,
                tag: row.team2_tag,
              }
            : undefined,
        winner:
          row.winner_id && row.winner_name
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
        createdAt: row.created_at ?? 0,
        loadedAt: row.loaded_at,
        completedAt: row.completed_at,
        vetoCompleted: vetoState?.status === 'completed',
      };

      // Enrich match with player stats and scores from events
      enrichMatch(match, row.slug);

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

    const baseUrl = getWebhookBaseUrl(req);

    // Use centralized match loading service
    const result = await loadMatchOnServer(slug, match.serverId, {
      skipWebhook,
      baseUrl,
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.webhookConfigured
          ? 'Match loaded and webhook configured'
          : 'Match loaded (webhook skipped)',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        match: matchService.getMatchBySlug(slug, getBaseUrl(req)),
        rconResponses: result.rconResponses,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to load match',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        rconResponses: result.rconResponses,
      });
    }
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
        emitMatchUpdate(updatedMatch);
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
