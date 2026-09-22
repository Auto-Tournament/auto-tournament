import { Router, Request, Response } from 'express';
import { mapService } from '../services/mapService';
import { CreateMapInput, UpdateMapInput } from '../types/map.types';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { fetchCS2MapsFromWiki } from '../utils/fetchCS2Maps';
import path from 'path';
import fs from 'fs';

const router = Router();

// Directory for storing map images - under api/public
const MAP_IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'map-images');

// Ensure map images directory exists
if (!fs.existsSync(MAP_IMAGES_DIR)) {
  fs.mkdirSync(MAP_IMAGES_DIR, { recursive: true });
  log.server(`Created map images directory: ${MAP_IMAGES_DIR}`);
}

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
 * POST /api/maps/:id/upload-image
 * Upload image for a map (accepts base64 encoded image)
 */
router.post('/:id/upload-image', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { imageData, imageType } = req.body;

    // Check if map exists
    const map = await mapService.getMapById(id);
    if (!map) {
      return res.status(404).json({
        success: false,
        error: `Map '${id}' not found`,
      });
    }

    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'imageData is required and must be a base64 string',
      });
    }

    // Parse base64 data URL (data:image/png;base64,...)
    let base64Data = imageData;
    let imageExtension = 'png';

    // Handle data URL format
    if (imageData.startsWith('data:')) {
      const matches = imageData.match(/^data:image\/([^;]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({
          success: false,
          error: 'Invalid image data format. Expected base64 data URL.',
        });
      }
      imageExtension = matches[1].toLowerCase();
      base64Data = matches[2];
    } else if (imageType) {
      // Use provided image type
      imageExtension = imageType.toLowerCase().replace('image/', '');
    }

    // Validate image type
    const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    if (!validExtensions.includes(imageExtension)) {
      return res.status(400).json({
        success: false,
        error: `Invalid image type. Allowed: ${validExtensions.join(', ')}`,
      });
    }

    // Convert base64 to buffer
    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64Data, 'base64');
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 data',
      });
    }

    if (imageBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Image data is empty',
      });
    }

    // Save image file
    const filename = `${id}.${imageExtension}`;
    const filepath = path.join(MAP_IMAGES_DIR, filename);
    fs.writeFileSync(filepath, imageBuffer);

    // Generate URL (relative to public directory)
    const imageUrl = `/map-images/${filename}`;

    // Update map with new image URL
    await mapService.updateMap(id, { imageUrl });

    log.success(`Map image uploaded for ${id}`, { filename, imageUrl });

    return res.json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
    });
  } catch (error) {
    log.error('Error in image upload endpoint', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process image upload',
    });
  }
});

/**
 * POST /api/maps/sync
 * Sync maps from GitHub repository (only adds new maps, doesn't duplicate existing ones)
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    log.info('Starting map sync from GitHub repository...');

    // Fetch maps from GitHub
    const fetchedMaps = await fetchCS2MapsFromWiki();

    if (fetchedMaps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No maps found in GitHub repository',
      });
    }

    // Get all existing maps to check for duplicates
    const existingMaps = await mapService.getAllMaps();
    const existingMapIds = new Set(existingMaps.map((m) => m.id));

    // Add only new maps (that don't already exist)
    let addedCount = 0;
    const errors: string[] = [];

    for (const mapData of fetchedMaps) {
      if (existingMapIds.has(mapData.id)) {
        // Map already exists, skip it
        continue;
      }

      try {
        await mapService.createMap(
          {
            id: mapData.id,
            displayName: mapData.displayName,
            imageUrl: mapData.imageUrl,
          },
          false // Don't upsert - we already checked it doesn't exist
        );
        addedCount++;
        log.info(`Added new map: ${mapData.displayName} (${mapData.id})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${mapData.id}: ${errorMessage}`);
        log.warn(`Failed to add map ${mapData.id}`, { error });
      }
    }

    const skippedCount = fetchedMaps.length - addedCount - errors.length;

    log.success(`Map sync completed: ${addedCount} added, ${skippedCount} skipped, ${errors.length} errors`);

    return res.json({
      success: true,
      message: `Sync completed: ${addedCount} new map(s) added, ${skippedCount} already existed`,
      stats: {
        total: fetchedMaps.length,
        added: addedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to sync maps';
    log.error('Error syncing maps from GitHub', error);
    
    // Check if it's a rate limit error
    const isRateLimit = errorMessage.toLowerCase().includes('rate limit') || 
                       errorMessage.toLowerCase().includes('rate limit exceeded');
    
    // Check if it's a GitHub API error
    const isGitHubError = errorMessage.toLowerCase().includes('github');
    
    let userMessage = errorMessage;
    let statusCode = 500;
    
    if (isRateLimit) {
      statusCode = 429; // Too Many Requests
      userMessage = 'GitHub API rate limit exceeded. Please try again in a few minutes, or set GITHUB_TOKEN environment variable to increase the limit.';
    } else if (isGitHubError) {
      statusCode = 503; // Service Unavailable
      userMessage = `Unable to reach GitHub repository. ${errorMessage}. Please try again later.`;
    }
    
    return res.status(statusCode).json({
      success: false,
      error: userMessage,
      errorType: isRateLimit ? 'rate_limit' : isGitHubError ? 'github_error' : 'unknown',
      originalError: errorMessage,
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

    // Get map first to check for image URL
    const map = await mapService.getMapById(id);
    if (!map) {
      return res.status(404).json({
        success: false,
        error: `Map '${id}' not found`,
      });
    }

    // Delete the map from database
    await mapService.deleteMap(id);

    // Delete associated image file if it exists
    if (map.imageUrl) {
      // Check if it's a local image (starts with /map-images/)
      if (map.imageUrl.startsWith('/map-images/')) {
        const filename = map.imageUrl.replace('/map-images/', '');
        const imagePath = path.join(MAP_IMAGES_DIR, filename);
        if (fs.existsSync(imagePath)) {
          try {
            fs.unlinkSync(imagePath);
            log.debug(`Deleted map image: ${imagePath}`);
          } catch (err) {
            log.warn(`Failed to delete map image: ${imagePath}`, { error: err });
            // Don't fail the request if image deletion fails
          }
        }
      }
    }

    // Also try to delete by pattern (fallback in case imageUrl wasn't set correctly)
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    for (const ext of imageExtensions) {
      const imagePath = path.join(MAP_IMAGES_DIR, `${id}.${ext}`);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
          log.debug(`Deleted map image (fallback): ${imagePath}`);
        } catch (err) {
          log.warn(`Failed to delete map image (fallback): ${imagePath}`, { error: err });
          // Don't fail the request if image deletion fails
        }
      }
    }

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
