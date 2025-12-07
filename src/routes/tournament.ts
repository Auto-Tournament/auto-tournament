import { Router, Request, Response } from 'express';
import { tournamentService } from '../services/tournamentService';
import { matchAllocationService } from '../services/matchAllocationService';
import { rconService } from '../services/rconService';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { getWebhookBaseUrl } from '../utils/urlHelper';
import type { CreateTournamentInput, UpdateTournamentInput } from '../types/tournament.types';
import type { DbMatchRow } from '../types/database.types';
import { emitTournamentUpdate, emitBracketUpdate } from '../services/socketService';
import {
  createShuffleTournament,
  registerPlayers,
  setRegisteredPlayers,
  getRegisteredPlayers,
  generateRoundMatches,
  getPlayerLeaderboard,
  getTournamentStandings,
  type ShuffleTournamentConfig,
} from '../services/shuffleTournamentService';
import { eloTemplateService } from '../services/eloTemplateService';

const router = Router();

// Public routes (before auth middleware)
/**
 * @openapi
 * /api/tournament/{id}/standings:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get tournament standings (public)
 *     description: Public endpoint to get tournament standings, leaderboard, and current round status. No authentication required.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     responses:
 *       200:
 *         description: Standings retrieved successfully
 *       400:
 *         description: Invalid tournament ID
 *       500:
 *         description: Server error
 */
router.get('/:id/standings', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    const standings = await getTournamentStandings();

    return res.json({
      success: true,
      ...standings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching standings', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/tournament:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get current tournament
 *     description: Returns the current tournament configuration and status
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament retrieved successfully
 *       404:
 *         description: No tournament exists
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tournament = await tournamentService.getTournament();

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: 'No tournament exists',
      });
    }

    return res.json({
      success: true,
      tournament,
    });
  } catch (error) {
    log.error('Error fetching tournament', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Create new tournament
 *     description: Creates a new tournament (replaces existing if any)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - format
 *               - maps
 *               - teamIds
 *             properties:
 *               name:
 *                 type: string
 *                 example: "NTLAN 2025 Spring Cup"
 *               type:
 *                 type: string
 *                 enum: [single_elimination, double_elimination, round_robin, swiss]
 *                 example: "single_elimination"
 *               format:
 *                 type: string
 *                 enum: [bo1, bo3, bo5]
 *                 example: "bo3"
 *               maps:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["de_mirage", "de_inferno", "de_ancient"]
 *               teamIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["team1", "team2", "team3", "team4"]
 *               settings:
 *                 type: object
 *                 properties:
 *                   thirdPlaceMatch:
 *                     type: boolean
 *                   autoAdvance:
 *                     type: boolean
 *                   checkInRequired:
 *                     type: boolean
 *                   seedingMethod:
 *                     type: string
 *                     enum: [random, manual]
 *     responses:
 *       200:
 *         description: Tournament created successfully
 *       400:
 *         description: Invalid input
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateTournamentInput = req.body;

    // Validate input
    if (!input.name || !input.type || !input.format || !input.maps || !input.teamIds) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, type, format, maps, teamIds',
      });
    }

    if (input.maps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one map is required',
      });
    }

    if (input.teamIds.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'At least 2 teams are required',
      });
    }

    const tournament = await tournamentService.createTournament(input);

    return res.json({
      success: true,
      tournament,
      message: 'Tournament created successfully',
    });
  } catch (error) {
    log.error('Error creating tournament', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to create tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament:
 *   put:
 *     tags:
 *       - Tournament
 *     summary: Update tournament
 *     description: Update tournament settings (only allowed before tournament starts)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Tournament updated successfully
 *       400:
 *         description: Invalid input or tournament already started
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const input: UpdateTournamentInput = req.body;
    const tournament = tournamentService.updateTournament(input);

    // Emit updates to all clients
    emitTournamentUpdate({ action: 'tournament_updated', ...tournament });
    emitBracketUpdate({ action: 'tournament_updated' });

    return res.json({
      success: true,
      tournament,
      message: 'Tournament updated successfully',
    });
  } catch (error) {
    log.error('Error updating tournament', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to update tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament:
 *   delete:
 *     tags:
 *       - Tournament
 *     summary: Delete tournament
 *     description: Ends all matches on servers and deletes the current tournament and all associated data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament deleted successfully
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    log.info('Deleting tournament...');

    // First, end all matches on servers (same as reset)
    const loadedMatches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE tournament_id = 1 
       AND status IN ('loaded', 'live')
       AND server_id IS NOT NULL 
       AND server_id != ''`
    );

    let matchesEnded = 0;
    let matchesEndedFailed = 0;

    if (loadedMatches.length > 0) {
      log.info(`Ending ${loadedMatches.length} active match(es) on servers before deletion...`);

      const serverIds = new Set<string>();
      for (const match of loadedMatches) {
        if (match.server_id) {
          serverIds.add(match.server_id);
        }
      }

      for (const serverId of serverIds) {
        try {
          log.info(`Ending match on server: ${serverId}`);
          const result = await rconService.sendCommand(serverId, 'css_restart');

          if (result.success) {
            log.success(`Match ended on server ${serverId}`);
            matchesEnded++;
          } else {
            log.error(`Failed to end match on server ${serverId}`, undefined, {
              error: result.error,
            });
            matchesEndedFailed++;
          }
        } catch (error) {
          log.error(`Error ending match on server ${serverId}`, error);
          matchesEndedFailed++;
        }
      }

      // Wait a moment for servers to clean up
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Now delete the tournament (will also delete matches via CASCADE)
    await tournamentService.deleteTournament();

    log.success(`Tournament deleted successfully. ${matchesEnded} match(es) ended on servers.`);

    // Emit tournament deleted event
    emitTournamentUpdate({ deleted: true, action: 'tournament_deleted' });

    return res.json({
      success: true,
      message: `Tournament deleted successfully.${
        matchesEnded > 0 ? ` ${matchesEnded} match(es) ended on servers.` : ''
      }${matchesEndedFailed > 0 ? ` ${matchesEndedFailed} match(es) failed to end.` : ''}`,
      matchesEnded,
      matchesEndedFailed,
    });
  } catch (error) {
    log.error('Error deleting tournament', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to delete tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament/bracket:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get tournament bracket
 *     description: Returns the tournament bracket with all matches
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Bracket retrieved successfully
 *       404:
 *         description: No tournament exists
 */
router.get('/bracket', async (_req: Request, res: Response) => {
  try {
    const bracket = await tournamentService.getBracket();

    if (!bracket) {
      return res.status(404).json({
        success: false,
        error: 'No tournament bracket exists',
      });
    }

    return res.json({
      success: true,
      ...bracket,
    });
  } catch (error) {
    log.error('Error fetching bracket', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch bracket',
    });
  }
});

/**
 * @openapi
 * /api/tournament/bracket/regenerate:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Regenerate tournament bracket (DESTRUCTIVE)
 *     description: Deletes all existing matches and regenerates bracket. Requires force=true for live tournaments.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 description: Set to true to regenerate bracket for live tournament (destroys match data)
 *     responses:
 *       200:
 *         description: Bracket regenerated successfully
 *       400:
 *         description: Cannot regenerate bracket without force flag
 */
router.post('/bracket/regenerate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { force } = req.body;
    const bracket = await tournamentService.regenerateBracket(force === true);

    // Emit updates to all clients
    emitBracketUpdate({ action: 'bracket_regenerated' });
    emitTournamentUpdate({ action: 'bracket_regenerated', status: 'ready' });

    return res.json({
      success: true,
      ...bracket,
      message: 'Bracket regenerated successfully. All previous match data has been deleted.',
    });
  } catch (error) {
    log.error('Error regenerating bracket', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to regenerate bracket',
    });
  }
});

/**
 * @openapi
 * /api/tournament/reset:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Reset tournament to setup mode
 *     description: Ends all matches on servers and resets tournament status to setup
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament reset successfully
 */
router.post('/reset', requireAuth, async (_req: Request, res: Response) => {
  try {
    log.info('Resetting tournament to setup mode...');

    // First, end all matches on servers
    const loadedMatches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE tournament_id = 1 
       AND status IN ('loaded', 'live')
       AND server_id IS NOT NULL 
       AND server_id != ''`
    );

    let matchesEnded = 0;
    let matchesEndedFailed = 0;

    if (loadedMatches.length > 0) {
      log.info(`Ending ${loadedMatches.length} active match(es) on servers...`);

      const serverIds = new Set<string>();
      for (const match of loadedMatches) {
        if (match.server_id) {
          serverIds.add(match.server_id);
        }
      }

      for (const serverId of serverIds) {
        try {
          log.info(`Ending match on server: ${serverId}`);
          const result = await rconService.sendCommand(serverId, 'css_restart');

          if (result.success) {
            log.success(`Match ended on server ${serverId}`);
            matchesEnded++;
          } else {
            log.error(`Failed to end match on server ${serverId}`, undefined, {
              error: result.error,
            });
            matchesEndedFailed++;
          }
        } catch (error) {
          log.error(`Error ending match on server ${serverId}`, error);
          matchesEndedFailed++;
        }
      }

      // Wait a moment for servers to clean up
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Now reset the tournament in the database
    const tournament = await tournamentService.resetTournament();

    log.success(`Tournament reset to setup mode. ${matchesEnded} match(es) ended on servers.`);

    // Emit updates to all clients
    emitBracketUpdate({ action: 'tournament_reset' });
    emitTournamentUpdate({ action: 'tournament_reset', status: 'setup' });

    return res.json({
      success: true,
      tournament,
      message: `Tournament reset to setup mode.${
        matchesEnded > 0 ? ` ${matchesEnded} match(es) ended on servers.` : ''
      }${
        matchesEndedFailed > 0 ? ` ${matchesEndedFailed} match(es) failed to end.` : ''
      } All match data and veto states have been cleared.`,
      matchesEnded,
      matchesEndedFailed,
    });
  } catch (error) {
    log.error('Error resetting tournament', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to reset tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament/start:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Start tournament and allocate servers
 *     description: Automatically allocates available servers to ready matches and loads them via RCON. Updates tournament status to 'in_progress'.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament started successfully with match allocation results
 *       400:
 *         description: Tournament not ready or no available servers
 *       404:
 *         description: No tournament exists
 */
/**
 * @openapi
 * /api/tournament/server-availability:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get available server count
 *     description: Returns the number of servers currently available for match allocation
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Server availability retrieved successfully
 */
router.get('/server-availability', requireAuth, async (_req: Request, res: Response) => {
  try {
    const count = await matchAllocationService.getAvailableServerCount();
    return res.json({
      success: true,
      availableServerCount: count,
    });
  } catch (error) {
    log.error('Error checking server availability', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check server availability',
    });
  }
});

router.post('/start', requireAuth, async (req: Request, res: Response) => {
  try {
    // Get base URL for webhook configuration
    const baseUrl = await getWebhookBaseUrl(req);

    const result = await matchAllocationService.startTournament(baseUrl);

    if (result.success) {
      log.success(result.message, {
        allocated: result.allocated,
        failed: result.failed,
      });

      return res.json({
        success: true,
        message: result.message,
        allocated: result.allocated,
        failed: result.failed,
        results: result.results,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.message,
        allocated: result.allocated,
        failed: result.failed,
        results: result.results,
      });
    }
  } catch (error) {
    log.error('Error starting tournament', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to start tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament/restart:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Restart tournament matches and reallocate servers
 *     description: Runs css_restart on all servers with loaded/live matches, resets matches to ready status, then reallocates servers. Useful for restarting stuck matches.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament restarted successfully with allocation results
 *       400:
 *         description: Tournament not ready or restart failed
 *       404:
 *         description: No tournament exists
 */
router.post('/restart', requireAuth, async (req: Request, res: Response) => {
  try {
    // Get base URL for webhook configuration
    const baseUrl = await getWebhookBaseUrl(req);

    const result = await matchAllocationService.restartTournament(baseUrl);

    if (result.success) {
      log.success(result.message, {
        restarted: result.restarted,
        allocated: result.allocated,
        failed: result.failed,
        restartFailed: result.restartFailed,
      });

      // Emit tournament restart event
      emitBracketUpdate({ action: 'tournament_restarted', allocated: result.allocated });
      emitTournamentUpdate({ action: 'tournament_restarted', status: 'ready' });

      return res.json({
        success: true,
        message: result.message,
        allocated: result.allocated,
        failed: result.failed,
        restarted: result.restarted,
        restartFailed: result.restartFailed,
        results: result.results,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.message,
        allocated: result.allocated,
        failed: result.failed,
        restarted: result.restarted,
        restartFailed: result.restartFailed,
        results: result.results,
      });
    }
  } catch (error) {
    log.error('Error restarting tournament', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to restart tournament',
    });
  }
});

/**
 * @openapi
 * /api/tournament/wipe-database:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Reset entire database (DEV ONLY)
 *     description: Drops all tables and reinitializes the database schema with default data (maps, map pools). This resets the database to its initial state as if starting fresh. USE WITH CAUTION!
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Database reset successfully
 */
router.post('/wipe-database', async (_req: Request, res: Response) => {
  try {
    log.warn('[WARNING] DATABASE WIPE REQUESTED - Resetting database to initial state');

    const { db } = await import('../config/database');

    // Reset database: drops all tables and reinitializes schema with default data
    await db.resetDatabase();

    log.success('[DATABASE] Database reset successfully - all tables recreated with default data');

    return res.json({
      success: true,
      message:
        'Database reset successfully. All tables have been recreated and default data (maps, map pools) has been inserted.',
    });
  } catch (error) {
    log.error('Error resetting database', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to reset database',
    });
  }
});

/**
 * @openapi
 * /api/tournament/wipe-table/{table}:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Wipe specific table (DEV ONLY)
 *     description: Deletes all data from a specific table
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: table
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [teams, servers, tournament, matches, players, maps, map_pools, tournament_templates, elo_calculation_templates, match_events, match_map_results, player_rating_history, player_match_stats, shuffle_tournament_players, app_settings]
 *     responses:
 *       200:
 *         description: Table wiped successfully
 */
router.post('/wipe-table/:table', async (req: Request, res: Response) => {
  try {
    const { table } = req.params;
    const allowedTables = [
      'teams',
      'servers',
      'tournament',
      'matches',
      'players',
      'maps',
      'map_pools',
      'tournament_templates',
      'elo_calculation_templates',
      'match_events',
      'match_map_results',
      'player_rating_history',
      'player_match_stats',
      'shuffle_tournament_players',
      'app_settings',
    ];

    if (!allowedTables.includes(table)) {
      return res.status(400).json({
        success: false,
        error: `Invalid table. Allowed: ${allowedTables.join(', ')}`,
      });
    }

    log.warn(`[WARNING] TABLE WIPE REQUESTED - Deleting all data from ${table}`);

    const { db } = await import('../config/database');

    // Handle special cases for foreign key constraints
    if (table === 'tournament') {
      await tournamentService.deleteTournament();
    } else if (table === 'matches') {
      // Delete related data first
      await db.execAsync('DELETE FROM match_events');
      await db.execAsync('DELETE FROM match_map_results');
      await db.execAsync('DELETE FROM player_match_stats');
      await db.execAsync('DELETE FROM matches');
    } else if (table === 'players') {
      // Delete related data first
      await db.execAsync('DELETE FROM player_rating_history');
      await db.execAsync('DELETE FROM player_match_stats');
      await db.execAsync('DELETE FROM shuffle_tournament_players');
      await db.execAsync('DELETE FROM players');
    } else if (table === 'map_pools') {
      // Delete related data first
      await db.execAsync('DELETE FROM tournament_templates WHERE map_pool_id IS NOT NULL');
      await db.execAsync('DELETE FROM map_pools');
    } else if (table === 'tournament_templates') {
      await db.execAsync('DELETE FROM tournament_templates');
    } else if (table === 'elo_calculation_templates') {
      // Update tournaments to remove references
      await db.execAsync(
        'UPDATE tournament SET elo_template_id = NULL WHERE elo_template_id IS NOT NULL'
      );
      await db.execAsync("DELETE FROM elo_calculation_templates WHERE id != 'pure-win-loss'");
    } else {
      await db.execAsync(`DELETE FROM ${table}`);
    }

    log.success(`[DATABASE] Table ${table} wiped successfully`);

    return res.json({
      success: true,
      message: `Table ${table} wiped successfully.`,
    });
  } catch (error) {
    log.error('Error wiping table', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to wipe table',
    });
  }
});

/**
 * @openapi
 * /api/tournament/shuffle:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Create a shuffle tournament
 *     description: Creates a new shuffle tournament with dynamic team balancing. Shuffle tournaments are individual player competitions where teams are automatically balanced and reshuffled each round based on ELO ratings.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - mapSequence
 *               - roundLimitType
 *               - overtimeMode
 *             properties:
 *               name:
 *                 type: string
 *                 description: Tournament name
 *                 example: "LAN Party 2025"
 *               mapSequence:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of maps in order (number of maps = number of rounds)
 *                 example: ["de_dust2", "de_mirage", "de_inferno"]
 *               roundLimitType:
 *                 type: string
 *                 enum: [first_to_13, max_rounds]
 *                 description: Round limit type - "first_to_13" or "max_rounds"
 *                 example: "max_rounds"
 *               maxRounds:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 30
 *                 description: Maximum rounds per match (required if roundLimitType is "max_rounds")
 *                 example: 24
 *               overtimeMode:
 *                 type: string
 *                 enum: [enabled, disabled]
 *                 description: Overtime handling mode
 *                 example: "enabled"
 *     responses:
 *       201:
 *         description: Shuffle tournament created successfully
 *       400:
 *         description: Invalid request or missing required fields
 */
router.post('/shuffle', async (req: Request, res: Response) => {
  try {
    const config: ShuffleTournamentConfig = req.body;

    if (!config.name || !config.mapSequence || !config.roundLimitType || !config.overtimeMode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, mapSequence, roundLimitType, overtimeMode',
      });
    }

    // Validate team size
    if (config.teamSize !== undefined && (config.teamSize < 2 || config.teamSize > 10)) {
      return res.status(400).json({
        success: false,
        error: 'Team size must be between 2 and 10 players',
      });
    }

    const tournament = await createShuffleTournament(config);

    return res.status(201).json({
      success: true,
      message: 'Shuffle tournament created successfully',
      tournament,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error creating shuffle tournament', { error });
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * @openapi
 * /api/tournament/{id}/register-players:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Register players to shuffle tournament
 *     description: Register one or more players to a shuffle tournament. Players must exist in the players table. Only works when tournament is in "setup" status.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - playerIds
 *             properties:
 *               playerIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of player Steam IDs to register
 *                 example: ["76561198000000000", "76561198000000001"]
 *     responses:
 *       200:
 *         description: All players registered successfully
 *       207:
 *         description: Some players registered, some failed (Multi-Status)
 *       400:
 *         description: Invalid request, tournament not in setup status, or tournament not found
 */
router.post('/:id/register-players', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { playerIds } = req.body;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'playerIds must be a non-empty array',
      });
    }

    const result = await registerPlayers(playerIds);

    const statusCode = result.errors.length > 0 ? 207 : 200; // 207 Multi-Status if some failed

    return res.status(statusCode).json({
      success: result.errors.length === 0,
      message: `Registered ${result.registered} player(s), ${result.errors.length} error(s)`,
      registered: result.registered,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error registering players', { error });
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * @openapi
 * /api/tournament/{id}/set-players:
 *   put:
 *     tags:
 *       - Tournament
 *     summary: Set registered players for shuffle tournament (replaces all)
 *     description: Sets the complete list of registered players. Players not in the list will be unregistered, new players will be registered.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - playerIds
 *             properties:
 *               playerIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Complete list of player Steam IDs to register (replaces all existing registrations)
 *                 example: ["76561198000000000", "76561198000000001"]
 *     responses:
 *       200:
 *         description: Players updated successfully
 *       207:
 *         description: Some players updated, some failed (Multi-Status)
 *       400:
 *         description: Invalid request, tournament not in setup status, or tournament not found
 */
router.put('/:id/set-players', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { playerIds } = req.body;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    if (!Array.isArray(playerIds)) {
      return res.status(400).json({
        success: false,
        error: 'playerIds must be an array (can be empty to unregister all)',
      });
    }

    const result = await setRegisteredPlayers(playerIds);

    const statusCode = result.errors.length > 0 ? 207 : 200; // 207 Multi-Status if some failed

    return res.status(statusCode).json({
      success: result.errors.length === 0,
      message: `Updated player registrations: ${result.registered} added, ${
        result.unregistered
      } removed${result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''}`,
      registered: result.registered,
      unregistered: result.unregistered,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error setting players', { error });
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * @openapi
 * /api/tournament/{id}/players:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get registered players for shuffle tournament
 *     description: Returns list of all players registered for the shuffle tournament with their current ELO ratings.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     responses:
 *       200:
 *         description: Registered players retrieved successfully
 *       400:
 *         description: Invalid tournament ID
 *       500:
 *         description: Server error
 */
router.get('/:id/players', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    const players = await getRegisteredPlayers();

    return res.json({
      success: true,
      count: players.length,
      players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching registered players', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * @openapi
 * /api/tournament/{id}/leaderboard:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get player leaderboard for shuffle tournament
 *     description: Returns leaderboard sorted by match wins, then ELO. Includes player stats (wins, losses, win rate, ELO change).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
 *       400:
 *         description: Invalid tournament ID
 *       500:
 *         description: Server error
 */
router.get('/:id/leaderboard', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    const leaderboard = await getPlayerLeaderboard();

    return res.json({
      success: true,
      leaderboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching leaderboard', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * @openapi
 * /api/tournament/{id}/round-status:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Get current round status for shuffle tournament
 *     description: Returns current round number, map, match completion status, and progress. Used for displaying round status indicators.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tournament ID (currently only "1" is supported)
 *     responses:
 *       200:
 *         description: Round status retrieved successfully
 *       400:
 *         description: Invalid tournament ID or not a shuffle tournament
 *       500:
 *         description: Server error
 */
router.get('/:id/round-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    const standings = await getTournamentStandings();

    return res.json({
      success: true,
      roundStatus: standings.roundStatus,
      currentRound: standings.currentRound,
      totalRounds: standings.totalRounds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching round status', { error });
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/tournament/:id/generate-round
 * Manually trigger round generation (for testing/admin use)
 * Note: Rounds should advance automatically, but this endpoint exists for manual control
 */
router.post('/:id/generate-round', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roundNumber } = req.body;

    if (id !== '1') {
      return res.status(400).json({
        success: false,
        error: 'Only tournament ID 1 is supported',
      });
    }

    if (!roundNumber || typeof roundNumber !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'roundNumber is required and must be a number',
      });
    }

    const result = await generateRoundMatches(roundNumber);

    return res.json({
      success: true,
      message: `Generated ${result.matches.length} matches for round ${roundNumber}`,
      matches: result.matches,
      teams: result.teams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error generating round', { error });
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/tournament/:id/elo-template
 * Get tournament's ELO calculation template
 */
router.get('/:id/elo-template', async (req: Request, res: Response) => {
  try {
    const tournament = await db.queryOneAsync<{ elo_template_id: string | null }>(
      'SELECT elo_template_id FROM tournament WHERE id = ?',
      [req.params.id]
    );

    if (!tournament) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }

    const templateId = tournament.elo_template_id;
    if (!templateId) {
      // Return default template
      const defaultTemplate = await eloTemplateService.getDefaultTemplate();
      return res.json({ success: true, template: defaultTemplate });
    }

    const template = await eloTemplateService.getTemplate(templateId);
    if (!template) {
      // Template ID exists but template not found - return default
      const defaultTemplate = await eloTemplateService.getDefaultTemplate();
      return res.json({ success: true, template: defaultTemplate });
    }

    return res.json({ success: true, template });
  } catch (error) {
    log.error('Error fetching tournament ELO template', { error, tournamentId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
});

/**
 * PUT /api/tournament/:id/elo-template
 * Set ELO calculation template for tournament
 */
router.put('/:id/elo-template', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.body;

    // Validate tournament exists
    const tournament = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM tournament WHERE id = ?',
      [req.params.id]
    );

    if (!tournament) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }

    // If templateId is provided, validate it exists
    if (templateId !== null && templateId !== undefined) {
      const template = await eloTemplateService.getTemplate(templateId);
      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }
    }

    // Update tournament
    await db.updateAsync(
      'tournament',
      { elo_template_id: templateId || null, updated_at: Math.floor(Date.now() / 1000) },
      'id = ?',
      [req.params.id]
    );

    log.success(`Updated ELO template for tournament ${req.params.id}`, { templateId });
    return res.json({ success: true, templateId: templateId || null });
  } catch (error) {
    log.error('Error updating tournament ELO template', { error, tournamentId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to update template' });
  }
});

export default router;
