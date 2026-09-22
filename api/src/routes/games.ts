import { Router, Request, Response } from 'express';
import {
  SEARCH_MIN_LENGTH,
  getPlayerAccountBySteamId,
  getSuggestions,
  searchGames,
} from '../services/gameCatalogService';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { createRateLimiter } from '../utils/rateLimit';
import { log } from '../utils/logger';

const router = Router();

/**
 * Per-IP limit on search. The client debounces (~250 ms), so a person typing
 * stays far below this; it exists to protect the instance's IGDB quota.
 */
export const gameSearchLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: 'Too many game searches, try again in a minute',
});

/**
 * @openapi
 * /api/games/search:
 *   get:
 *     tags: [Games]
 *     summary: Search the game catalogue
 *     description: |
 *       Searches IGDB when credentials are configured (results are stored in
 *       the local `games` table) and always includes the built-in games for
 *       installed game modules first. Without IGDB, or when it fails, only the
 *       built-in list is searched. At most 10 results. Rate limited per IP.
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *     responses:
 *       200:
 *         description: Matching games
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 fromIgdb:
 *                   type: boolean
 *                   description: True when any result came from IGDB (show the IGDB credit)
 *                 games:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GameSummary'
 *       400:
 *         description: Query shorter than 2 characters
 *       429:
 *         description: Too many searches from this address
 */
router.get('/search', gameSearchLimiter, async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < SEARCH_MIN_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `q must be at least ${SEARCH_MIN_LENGTH} characters`,
    });
  }
  if (q.length > 100) {
    return res.status(400).json({ success: false, error: 'q must be at most 100 characters' });
  }

  try {
    const result = await searchGames(q);
    return res.json({ success: true, ...result });
  } catch (error) {
    log.error('Game search failed', error);
    return res.status(500).json({ success: false, error: 'Game search failed' });
  }
});

/**
 * @openapi
 * /api/games/suggestions:
 *   get:
 *     tags: [Games]
 *     summary: Up to three games to suggest
 *     description: |
 *       Games with a tournament open or running on this instance first, then
 *       popular built-in games. Games the signed-in viewer already picked are
 *       left out. Works anonymously (nothing is excluded then).
 *     responses:
 *       200:
 *         description: Suggested games
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 games:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GameSummary'
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const identity = await resolveViewerIdentity(req);
    const account = identity.effectiveSteamId
      ? await getPlayerAccountBySteamId(identity.effectiveSteamId)
      : null;
    const games = await getSuggestions(account?.uid ?? null);
    return res.json({ success: true, games });
  } catch (error) {
    log.error('Game suggestions failed', error);
    return res.status(500).json({ success: false, error: 'Failed to load game suggestions' });
  }
});

export default router;
