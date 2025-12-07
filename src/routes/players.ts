/**
 * Players API Routes
 * Handles player CRUD operations and bulk import
 */

import { Router, Request, Response } from 'express';
import {
  playerService,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from '../services/playerService';
import { getRatingHistory } from '../services/ratingService';
import { steamService } from '../services/steamService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';

const router = Router();

// ============================================================================
// PUBLIC ROUTES (no authentication required)
// ============================================================================

/**
 * GET /api/players/find
 * Find player by Steam URL or Steam ID (public)
 * NOTE: This route must come before /:playerId to avoid route conflicts
 */
router.get('/find', async (req: Request, res: Response) => {
  try {
    const { query, steamId } = req.query;

    // Support both 'query' and 'steamId' parameters for backward compatibility
    const searchQuery = (query || steamId) as string;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing query or steamId parameter',
      });
    }

    // Extract Steam ID from various formats
    let resolvedSteamId: string | null = null;

    // Direct Steam ID (64-bit)
    if (/^7656\d{13}$/.test(searchQuery)) {
      resolvedSteamId = searchQuery;
    }
    // Steam profile URL
    else if (searchQuery.includes('steamcommunity.com')) {
      // Extract from URL: https://steamcommunity.com/profiles/76561198012345678
      const profileMatch = searchQuery.match(/\/profiles\/(\d+)/);
      if (profileMatch) {
        resolvedSteamId = profileMatch[1];
      }
      // Extract from vanity URL: https://steamcommunity.com/id/username
      // Try to resolve via Steam API if available
      else if (searchQuery.includes('/id/')) {
        try {
          if (await steamService.isAvailable()) {
            const resolvedId = await steamService.resolveSteamId(searchQuery);
            if (resolvedId) {
              resolvedSteamId = resolvedId;
            }
          } else {
            log.debug('Steam API not configured, cannot resolve vanity URL');
          }
        } catch (error) {
          log.debug(
            `Failed to resolve vanity URL: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    // Try to resolve as vanity URL/ID if Steam API is available
    else if (await steamService.isAvailable()) {
      try {
        const resolvedId = await steamService.resolveSteamId(searchQuery);
        if (resolvedId) {
          resolvedSteamId = resolvedId;
        }
      } catch (error) {
        log.debug(
          `Failed to resolve Steam input: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (resolvedSteamId) {
      const player = await playerService.getPlayerById(resolvedSteamId);
      if (player) {
        return res.json({
          success: true,
          players: [player],
        });
      }
    }

    // Fallback: search by name
    const players = await playerService.searchPlayers(searchQuery, 10);
    if (players.length === 1) {
      return res.json({
        success: true,
        players: [players[0]],
      });
    } else if (players.length > 1) {
      return res.json({
        success: true,
        players, // Return multiple results
        message: 'Multiple players found',
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Player not found',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error finding player', { error, query: req.query.query });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId
 * Get player details (public - no auth required for viewing)
 */
router.get('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const player = await playerService.getPlayerById(playerId);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId/rating-history
 * Get player rating history (public)
 */
router.get('/:playerId/rating-history', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { tournamentId } = req.query;

    const history = await getRatingHistory(
      playerId,
      tournamentId ? parseInt(tournamentId as string, 10) : undefined
    );

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching rating history', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/:playerId/matches
 * Get player match history (public)
 */
router.get('/:playerId/matches', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { tournamentId } = req.query;

    // Get all matches this player participated in
    let query = `
      SELECT 
        m.slug,
        m.round,
        m.match_number,
        m.status,
        m.completed_at,
        m.team1_id,
        m.team2_id,
        m.winner_id,
        pms.team,
        pms.won_match,
        pms.adr,
        pms.total_damage,
        pms.kills,
        pms.deaths,
        pms.assists
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      WHERE pms.player_id = ?
    `;
    const params: unknown[] = [playerId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(parseInt(tournamentId as string, 10));
    }

    query += ' ORDER BY m.completed_at DESC, m.round DESC';

    const matches = await db.queryAsync(query, params);

    return res.json({
      success: true,
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching player matches', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ============================================================================
// PROTECTED ROUTES (authentication required)
// ============================================================================

// All player management routes require authentication (admin only)
router.use(requireAuth);

/**
 * GET /api/players
 * Get all players (for admin management)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const players = await playerService.getAllPlayers();
    return res.json({
      success: true,
      count: players.length,
      players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching players', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/players/selection
 * Get players for selection modal (with team membership status)
 */
router.get('/selection', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.query;
    const players = await playerService.getAllPlayers();

    // If teamId provided, mark which players are already in that team
    let teamPlayerIds: string[] = [];
    if (teamId && typeof teamId === 'string') {
      const team = await db.queryOneAsync<{ players: string }>(
        'SELECT players FROM teams WHERE id = ?',
        [teamId]
      );
      if (team) {
        const teamPlayers = JSON.parse(team.players) as Array<{ steamId: string }>;
        teamPlayerIds = teamPlayers.map((p) => p.steamId);
      }
    }

    const playersWithStatus = players.map((p) => ({
      ...p,
      inTeam: teamPlayerIds.includes(p.id),
    }));

    return res.json({
      success: true,
      players: playersWithStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching players for selection', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/players
 * Create a new player
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreatePlayerInput = req.body;

    if (!input.id || !input.name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id (Steam ID), name',
      });
    }

    const player = await playerService.createPlayer(input);

    return res.status(201).json({
      success: true,
      message: 'Player created successfully',
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message.includes('already exists') ? 409 : 400;
    log.error('Error creating player', { error });
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/players/bulk-import
 * Bulk import players from CSV/JSON
 */
router.post('/bulk-import', async (req: Request, res: Response) => {
  try {
    const players: CreatePlayerInput[] = req.body;

    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be an array of players',
      });
    }

    // Validate each player has required fields
    for (const player of players) {
      if (!player.id || !player.name) {
        return res.status(400).json({
          success: false,
          error: 'Each player must have id (Steam ID) and name',
        });
      }
    }

    const result = await playerService.bulkImportPlayers(players);
    const statusCode = result.errors.length > 0 ? 207 : 201; // 207 Multi-Status if some failed

    return res.status(statusCode).json({
      success: result.errors.length === 0,
      message: `Imported ${result.created} player(s), updated ${result.updated}, ${result.errors.length} error(s)`,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error bulk importing players', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/players/:playerId
 * Update a player (admin only)
 */
router.put('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const input: UpdatePlayerInput = req.body;

    const player = await playerService.updatePlayer(playerId, input);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      message: 'Player updated successfully',
      player,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error updating player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/players/:playerId
 * Delete a player (admin only)
 */
router.delete('/:playerId', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const deleted = await playerService.deletePlayer(playerId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Player '${playerId}' not found`,
      });
    }

    return res.json({
      success: true,
      message: 'Player deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error deleting player', { error, playerId: req.params.playerId });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
