import { Router, Request, Response } from 'express';
import { steamService } from '../services/steamService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';

const router = Router();

// Protect all Steam routes
router.use(requireAuth);

/**
 * @openapi
 * /api/steam/resolve:
 *   post:
 *     tags:
 *       - Steam
 *     summary: Resolve Steam vanity URL or ID to Steam ID64
 *     description: Resolves various Steam input formats (vanity URL, vanity ID, profile URL) to a Steam ID64 and fetches player info
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - input
 *             properties:
 *               input:
 *                 type: string
 *                 description: Steam vanity URL, vanity ID, profile URL, or Steam ID64
 *                 example: "gaben"
 *     responses:
 *       200:
 *         description: Successfully resolved
 *       404:
 *         description: Could not resolve input
 *       503:
 *         description: Steam API not configured
 */
router.post('/resolve', async (req: Request, res: Response) => {
  try {
    if (!steamService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Steam API is not configured. Add your Steam API key from the Settings page.',
      });
    }

    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Input is required and must be a string',
      });
    }

    const player = await steamService.resolvePlayer(input);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Could not resolve Steam ID from input. Please check the vanity URL/ID.',
      });
    }

    log.success(`Resolved Steam player: ${player.name} (${player.steamId})`);
    return res.json({
      success: true,
      player,
    });
  } catch (error) {
    log.error('Error in Steam resolve endpoint', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resolve Steam ID',
    });
  }
});

/**
 * @openapi
 * /api/steam/player/{steamId}:
 *   get:
 *     tags:
 *       - Steam
 *     summary: Get player information by Steam ID64
 *     description: Fetches player name and avatar from Steam API
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: steamId
 *         required: true
 *         schema:
 *           type: string
 *         description: Steam ID64
 *     responses:
 *       200:
 *         description: Player information retrieved
 *       404:
 *         description: Player not found
 *       503:
 *         description: Steam API not configured
 */
router.get('/player/:steamId', async (req: Request, res: Response) => {
  try {
    if (!steamService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Steam API is not configured. Add your Steam API key from the Settings page.',
      });
    }

    const { steamId } = req.params;
    const player = await steamService.getPlayerInfo(steamId);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Player not found',
      });
    }

    return res.json({
      success: true,
      player,
    });
  } catch (error) {
    log.error('Error fetching Steam player info', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch player info',
    });
  }
});

export default router;
