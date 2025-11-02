import { Router, Request, Response } from 'express';
import { tournamentService } from '../services/tournamentService';
import { matchAllocationService } from '../services/matchAllocationService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import type { CreateTournamentInput, UpdateTournamentInput } from '../types/tournament.types';

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

    const tournament = tournamentService.createTournament(input);

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
 *     description: Delete the current tournament and all associated matches
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament deleted successfully
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    tournamentService.deleteTournament();

    return res.json({
      success: true,
      message: 'Tournament deleted successfully',
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
    const bracket = tournamentService.regenerateBracket(force === true);

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
 *     description: Deletes all matches and resets tournament status to setup
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tournament reset successfully
 */
router.post('/reset', requireAuth, async (_req: Request, res: Response) => {
  try {
    const tournament = tournamentService.resetTournament();

    return res.json({
      success: true,
      tournament,
      message: 'Tournament reset to setup mode. All matches have been deleted.',
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
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

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

export default router;
