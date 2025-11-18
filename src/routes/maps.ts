import { Router, Request, Response } from 'express';
import { mapService } from '../services/mapService';
import { CreateMapInput, UpdateMapInput } from '../types/map.types';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Protect all map routes
router.use(requireAuth);

/**
 * GET /api/maps
 * Get all maps
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const maps = await mapService.getAllMaps();

    return res.json({
      success: true,
      count: maps.length,
      maps,
    });
  } catch (error) {
    console.error('Error fetching maps:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch maps',
    });
  }
});

/**
 * GET /api/maps/:id
 * Get a specific map
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const map = await mapService.getMapById(id);

    if (!map) {
      return res.status(404).json({
        success: false,
        error: `Map '${id}' not found`,
      });
    }

    return res.json({
      success: true,
      map,
    });
  } catch (error) {
    console.error('Error fetching map:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch map',
    });
  }
});

/**
 * POST /api/maps
 * Create a new map
 * Query param: ?upsert=true to update if exists instead of error
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateMapInput = req.body;
    const upsert = req.query.upsert === 'true';

    // Validate required fields
    if (!input.id || !input.displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, displayName',
      });
    }

    const map = await mapService.createMap(input, upsert);

    return res.status(upsert ? 200 : 201).json({
      success: true,
      message: upsert ? 'Map created or updated successfully' : 'Map created successfully',
      map,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create map';
    const statusCode = message.includes('already exists') ? 409 : 400;

    console.error('Error creating map:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/maps/:id
 * Update a map
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateMapInput = req.body;

    const map = await mapService.updateMap(id, input);

    return res.json({
      success: true,
      message: 'Map updated successfully',
      map,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update map';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error updating map:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PATCH /api/maps/:id
 * Partially update a map
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: UpdateMapInput = req.body;

    const map = await mapService.updateMap(id, input);

    return res.json({
      success: true,
      message: 'Map updated successfully',
      map,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update map';
    const statusCode = message.includes('not found') ? 404 : 400;

    console.error('Error updating map:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/maps/:id
 * Delete a map
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await mapService.deleteMap(id);

    return res.json({
      success: true,
      message: 'Map deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete map';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error deleting map:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

export default router;
