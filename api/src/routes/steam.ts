import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { steamService } from '../services/steamService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { URLSearchParams } from 'url';

const router = Router();

// Protect all Steam routes
router.use(requireAuth);

/**
 * @openapi
 * /api/steam/status:
 *   get:
 *     tags:
 *       - Steam
 *     summary: Check Steam API connectivity
 *     description: Verifies whether a Steam Web API key is configured and reachable.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Steam API status. Returns configured=true when key is set and reachable, otherwise configured=false.
 *       503:
 *         description: Steam API key is set but Steam could not be reached
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const health = await steamService.checkSteamWebApiHealth({ force: true });

    if (!health.configured) {
      return res.json({
        success: false,
        configured: false,
        valid: false,
        errorType: health.errorType,
        // Keep wording generic for operators; details are in server logs.
        error: 'Steam integration is not configured on the server.',
      });
    }

    if (health.ok) {
      return res.json({
        success: true,
        configured: true,
        valid: true,
        message: 'Steam integration is configured and reachable.',
      });
    }

    return res.json({
      success: false,
      configured: true,
      valid: false,
      errorType: health.errorType,
      statusCode: health.statusCode,
      // Keep wording generic for the UI. Admins can still inspect API logs for details.
      error: 'Steam integration is currently unavailable. Check server configuration and connectivity.',
    });
  } catch (error) {
    log.error('Error in Steam status endpoint', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check Steam API status',
    });
  }
});

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
    if (!(await steamService.isAvailable())) {
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
      player: {
        steamId: player.steamId,
        name: player.name,
        avatar: player.avatarUrl,
      },
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
    if (!(await steamService.isAvailable())) {
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
      player: {
        steamId: player.steamId,
        name: player.name,
        avatar: player.avatarUrl,
      },
    });
  } catch (error) {
    log.error('Error fetching Steam player info', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch player info',
    });
  }
});

function extractWorkshopId(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  // Plain numeric ID.
  if (/^\d{6,}$/.test(raw)) return raw;
  // URLs: try common workshop patterns, then fallback to any long numeric.
  const m =
    raw.match(/[?&]id=(\d{6,})/i) ||
    raw.match(/\/sharedfiles\/filedetails\/\?id=(\d{6,})/i) ||
    raw.match(/\/filedetails\/(\d{6,})/i) ||
    raw.match(/(\d{6,})/);
  return m?.[1] ?? null;
}

/**
 * GET /api/steam/workshop-map?input=<url-or-id>
 *
 * Resolves a Steam Workshop published file ID to a title + preview image URL.
 * Does not require a Steam Web API key (uses RemoteStorage endpoint).
 */
router.get('/workshop-map', async (req: Request, res: Response) => {
  try {
    const input = typeof req.query.input === 'string' ? req.query.input : '';
    const workshopId = extractWorkshopId(input);
    if (!workshopId) {
      return res.status(400).json({ success: false, error: 'Invalid workshop input' });
    }

    const form = new URLSearchParams();
    form.set('itemcount', '1');
    form.set('publishedfileids[0]', workshopId);

    const response = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST',
        body: form,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: `Steam RemoteStorage error (${response.status})`,
      });
    }

    type WorkshopDetailsResponse = {
      response?: {
        publishedfiledetails?: Array<{
          result?: number;
          title?: string;
          preview_url?: string;
        }>;
      };
    };
    const data = (await response.json()) as WorkshopDetailsResponse;
    const details = data?.response?.publishedfiledetails?.[0];
    const result = typeof details?.result === 'number' ? details.result : 0;
    if (result !== 1) {
      return res.status(404).json({
        success: false,
        error: 'Workshop item not found',
        result,
      });
    }

    const title = typeof details?.title === 'string' ? details.title : null;
    const previewUrl = typeof details?.preview_url === 'string' ? details.preview_url : null;

    return res.json({
      success: true,
      workshopId,
      title,
      previewUrl,
    });
  } catch (error) {
    log.error('Error in Steam workshop-map endpoint', error);
    return res.status(500).json({ success: false, error: 'Failed to resolve workshop map' });
  }
});

export default router;
