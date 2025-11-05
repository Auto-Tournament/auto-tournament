import { Router, Request, Response } from 'express';
import { tournamentService } from '../services/tournamentService';
import { matchAllocationService } from '../services/matchAllocationService';
import { rconService } from '../services/rconService';
import { serverStatusService, ServerStatus } from '../services/serverStatusService';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { getWebhookBaseUrl } from '../utils/urlHelper';
import type { CreateTournamentInput, UpdateTournamentInput } from '../types/tournament.types';
import type { DbMatchRow } from '../types/database.types';
import { emitTournamentUpdate, emitBracketUpdate } from '../services/socketService';

const router = Router();

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
    const tournament = tournamentService.getTournament();

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
    const loadedMatches = db.query<DbMatchRow>(
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
            log.success(`✓ Match ended on server ${serverId}`);
            matchesEnded++;

            // Clear server status
            await serverStatusService.setServerStatus(serverId, ServerStatus.IDLE);
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
    tournamentService.deleteTournament();

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
    const bracket = tournamentService.getBracket();

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
    const loadedMatches = db.query<DbMatchRow>(
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
            log.success(`✓ Match ended on server ${serverId}`);
            matchesEnded++;

            // Clear server status
            await serverStatusService.setServerStatus(serverId, ServerStatus.IDLE);
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
    const tournament = tournamentService.resetTournament();

    log.success(`Tournament reset to setup mode. ${matchesEnded} match(es) ended on servers.`);

    return res.json({
      success: true,
      tournament,
      message: `Tournament reset to setup mode.${
        matchesEnded > 0
          ? ` ${matchesEnded} match(es) ended on servers.`
          : ''
      }${
        matchesEndedFailed > 0
          ? ` ${matchesEndedFailed} match(es) failed to end.`
          : ''
      } All match data has been cleared.`,
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
router.post('/start', requireAuth, async (req: Request, res: Response) => {
  try {
    // Get base URL for webhook configuration
    const baseUrl = getWebhookBaseUrl(req);

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
    const baseUrl = getWebhookBaseUrl(req);

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
 *     summary: Wipe entire database (DEV ONLY)
 *     description: Deletes all tournaments, matches, events, teams, and servers. USE WITH CAUTION!
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Database wiped successfully
 */
router.post('/wipe-database', async (_req: Request, res: Response) => {
  try {
    log.warn('⚠️  DATABASE WIPE REQUESTED - Deleting all data');

    // Delete in correct order to avoid foreign key constraints
    tournamentService.deleteTournament(); // This already deletes tournament, matches, and events

    // Also delete teams and servers
    const { db } = await import('../config/database');
    db.exec('DELETE FROM teams');
    db.exec('DELETE FROM servers');

    log.success('✅ Database wiped successfully');

    return res.json({
      success: true,
      message: 'Database wiped successfully. All data has been deleted.',
    });
  } catch (error) {
    log.error('Error wiping database', error as Error);
    const err = error as Error;
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to wipe database',
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
 *           enum: [teams, servers, tournament, matches]
 *     responses:
 *       200:
 *         description: Table wiped successfully
 */
router.post('/wipe-table/:table', async (req: Request, res: Response) => {
  try {
    const { table } = req.params;
    const allowedTables = ['teams', 'servers', 'tournament', 'matches'];

    if (!allowedTables.includes(table)) {
      return res.status(400).json({
        success: false,
        error: `Invalid table. Allowed: ${allowedTables.join(', ')}`,
      });
    }

    log.warn(`⚠️  TABLE WIPE REQUESTED - Deleting all data from ${table}`);

    const { db } = await import('../config/database');

    // Handle special cases for foreign key constraints
    if (table === 'tournament') {
      tournamentService.deleteTournament();
    } else if (table === 'matches') {
      db.exec('DELETE FROM match_events');
      db.exec('DELETE FROM matches');
    } else {
      db.exec(`DELETE FROM ${table}`);
    }

    log.success(`✅ Table ${table} wiped successfully`);

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

export default router;
