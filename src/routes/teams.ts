import { Router, Request, Response } from 'express';
import { teamService } from '../services/teamService';
import { CreateTeamInput, UpdateTeamInput } from '../types/team.types';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All team routes require authentication
router.use(requireAuth);

/**
 * GET /api/teams
 * Get all teams
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const teams = await teamService.getAllTeams();
    return res.json({
      success: true,
      count: teams.length,
      teams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/teams/:id
 * Get team by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const team = await teamService.getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: `Team '${id}' not found`,
      });
    }

    return res.json({
      success: true,
      team,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/teams
 * Create team(s) - supports single or batch creation
 * Query param: ?upsert=true to update if exists
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const upsert = req.query.upsert === 'true';
    const body = req.body;

    // Batch creation
    if (Array.isArray(body)) {
      const result = await teamService.createTeams(body as CreateTeamInput[], upsert);
      const statusCode = result.failed.length > 0 ? 207 : 201;

      return res.status(statusCode).json({
        success: result.failed.length === 0,
        message: `Created ${result.successful.length} team(s), ${result.failed.length} failed`,
        successful: result.successful,
        failed: result.failed,
        stats: {
          total: body.length,
          successful: result.successful.length,
          failed: result.failed.length,
        },
      });
    }

    // Single creation
    const input = body as CreateTeamInput;
    const team = await teamService.createTeam(input, upsert);

    return res.status(upsert ? 200 : 201).json({
      success: true,
      message: upsert ? `Team '${team.id}' created or updated` : `Team '${team.id}' created`,
      team,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/teams/:id
 * Update team
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input = req.body as UpdateTeamInput;

    const team = await teamService.updateTeam(id, input);

    return res.json({
      success: true,
      message: `Team '${id}' updated`,
      team,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PATCH /api/teams/batch
 * Batch update teams
 */
router.patch('/batch', async (req: Request, res: Response) => {
  try {
    const updates = req.body as { id: string; updates: UpdateTeamInput }[];

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be an array of { id, updates } objects',
      });
    }

    const result = await teamService.updateTeams(updates);
    const statusCode = result.failed.length > 0 ? 207 : 200;

    return res.status(statusCode).json({
      success: result.failed.length === 0,
      message: `Updated ${result.successful.length} team(s), ${result.failed.length} failed`,
      successful: result.successful,
      failed: result.failed,
      stats: {
        total: updates.length,
        successful: result.successful.length,
        failed: result.failed.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/teams/:id
 * Delete team
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await teamService.deleteTeam(id);

    return res.json({
      success: true,
      message: `Team '${id}' deleted`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message.includes('not found') ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

export default router;
