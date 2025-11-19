import { Router, Request, Response } from 'express';
import { mapPoolService } from '../services/mapPoolService';
import { CreateMapPoolInput, UpdateMapPoolInput } from '../types/mapPool.types';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Protect all map pool routes
router.use(requireAuth);

/**
 * GET /api/map-pools
 * Get all map pools
 * Query param: ?enabled=true to only get enabled pools
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const enabledOnly = req.query.enabled === 'true';
    const pools = await mapPoolService.getAllMapPools(enabledOnly);

    return res.json({
      success: true,
      count: pools.length,
      mapPools: pools,
    });
  } catch (error) {
    console.error('Error fetching map pools:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch map pools',
    });
  }
});

/**
 * GET /api/map-pools/:id
 * Get a specific map pool
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    const pool = await mapPoolService.getMapPoolById(poolId);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: `Map pool with ID ${id} not found`,
      });
    }

    return res.json({
      success: true,
      mapPool: pool,
    });
  } catch (error) {
    console.error('Error fetching map pool:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch map pool',
    });
  }
});

/**
 * POST /api/map-pools
 * Create a new map pool
 * Query param: ?upsert=true to update if exists instead of error
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateMapPoolInput = req.body;
    const upsert = req.query.upsert === 'true';

    // Validate required fields
    if (!input.name || !input.mapIds) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, mapIds',
      });
    }

    if (!Array.isArray(input.mapIds)) {
      return res.status(400).json({
        success: false,
        error: 'mapIds must be an array',
      });
    }

    const pool = await mapPoolService.createMapPool(input, upsert);

    return res.status(upsert ? 200 : 201).json({
      success: true,
      message: upsert
        ? 'Map pool created or updated successfully'
        : 'Map pool created successfully',
      mapPool: pool,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create map pool';
    const statusCode = message.includes('already exists') ? 409 : 400;

    console.error('Error creating map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/map-pools/:id/enable
 * Enable a map pool
 */
router.put('/:id/enable', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    const pool = await mapPoolService.setMapPoolEnabled(poolId, true);

    return res.json({
      success: true,
      message: 'Map pool enabled successfully',
      mapPool: pool,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable map pool';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error enabling map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/map-pools/:id/disable
 * Disable a map pool
 */
router.put('/:id/disable', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    const pool = await mapPoolService.setMapPoolEnabled(poolId, false);

    return res.json({
      success: true,
      message: 'Map pool disabled successfully',
      mapPool: pool,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to disable map pool';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error disabling map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/map-pools/:id/set-default
 * Set a map pool as the default
 * This route must be defined before /:id to ensure proper matching
 */
router.put('/:id/set-default', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    const pool = await mapPoolService.setDefaultMapPool(poolId);

    return res.json({
      success: true,
      message: 'Default map pool updated successfully',
      mapPool: pool,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set default map pool';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error setting default map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/map-pools/:id
 * Update a map pool
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    const input: UpdateMapPoolInput = req.body;

    if (input.mapIds !== undefined && !Array.isArray(input.mapIds)) {
      return res.status(400).json({
        success: false,
        error: 'mapIds must be an array',
      });
    }

    const pool = await mapPoolService.updateMapPool(poolId, input);

    return res.json({
      success: true,
      message: 'Map pool updated successfully',
      mapPool: pool,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update map pool';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error updating map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/map-pools/:id
 * Delete a map pool
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map pool ID',
      });
    }

    await mapPoolService.deleteMapPool(poolId);

    return res.json({
      success: true,
      message: 'Map pool deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete map pool';
    const statusCode = message.includes('not found')
      ? 404
      : message.includes('Cannot delete')
      ? 400
      : 500;

    console.error('Error deleting map pool:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

export default router;
