import { Router, Request, Response } from 'express';
import {
  SEARCH_MIN_LENGTH,
  getPlayableGames,
  getPlayerAccountBySteamId,
  getPopularGames,
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
 *       the local `games` table); otherwise searches Wikidata, which needs no
 *       API key and is the default so search works out of the box. Always
 *       includes the built-in games for installed game modules first. When
 *       neither is configured to answer, or the active one fails or times
 *       out, only the built-in list is searched. At most 10 results. Rate
 *       limited per IP.
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
 *                 fromWikidata:
 *                   type: boolean
 *                   description: True when any result came from Wikidata (show the Wikidata credit)
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

/**
 * @openapi
 * /api/games/popular:
 *   get:
 *     tags: [Games]
 *     summary: Every built-in game, for the "/welcome/games" onboarding grid
 *     description: |
 *       Installed game modules, then popular esports titles — the full
 *       built-in catalogue, in the same order `suggestions` uses. Unlike
 *       `suggestions`, this is never filtered by what the viewer already
 *       picked (or capped at three): the onboarding page's card grid needs
 *       every built-in on screen so a game already picked still shows up,
 *       selected. Works anonymously.
 *     responses:
 *       200:
 *         description: The built-in games
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
router.get('/popular', async (_req: Request, res: Response) => {
  try {
    const games = await getPopularGames();
    return res.json({ success: true, games });
  } catch (error) {
    log.error('Failed to load popular games', error);
    return res.status(500).json({ success: false, error: 'Failed to load popular games' });
  }
});

/**
 * @openapi
 * /api/games/playable:
 *   get:
 *     tags: [Games]
 *     summary: Games this instance can create a tournament for
 *     description: |
 *       The built-in catalogue, minus the popular titles no installed module
 *       runs. Each entry carries the module that would run it
 *       (`integrationId`), because the tournament setup wizard's steps differ
 *       by module: Counter-Strike 2 picks servers, maps and a veto, a manually
 *       reported game picks a series length and who confirms a result.
 *
 *       Not everything a module could run: manual reporting answers for any
 *       catalogue game, including one found through `/api/games/search`. This
 *       is the list an organizer picks from without searching. Works
 *       anonymously.
 *     responses:
 *       200:
 *         description: The playable games
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 games:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/GameSummary'
 *                       - type: object
 *                         properties:
 *                           gameRef:
 *                             type: string
 *                             description: |
 *                               What to send as `game` when creating the
 *                               tournament. The catalogue slug, except for a
 *                               module's own game (Counter-Strike 2), which
 *                               keeps the module id the column has always held
 *                               for it.
 *                             example: 'rocket-league'
 */
router.get('/playable', async (_req: Request, res: Response) => {
  try {
    const games = await getPlayableGames();
    return res.json({ success: true, games });
  } catch (error) {
    log.error('Failed to load playable games', error);
    return res.status(500).json({ success: false, error: 'Failed to load playable games' });
  }
});

export default router;
