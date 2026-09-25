import { Router, Request, Response } from 'express';
import { gameIconPath, scheduleGameIconRefresh } from '../services/gameIconService';
import {
  SEARCH_MIN_LENGTH,
  getPlayableGames,
  getPopularGames,
  searchGames,
} from '../services/gameCatalogService';
import { createRateLimiter } from '../utils/rateLimit';
import { log } from '../utils/logger';

const router = Router();

/**
 * Per-IP limit on search. The client debounces (~250 ms), so a person typing
 * stays far below this; it exists to protect the instance's Wikidata quota.
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
 *       Searches Wikidata (results are stored in the local `games` table),
 *       which needs no API key, so search works out of the box. Always
 *       includes the built-in games for installed game modules first. When
 *       Wikidata fails or times out, only the built-in list is searched. At
 *       most 10 results. Rate limited per IP.
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
    // New rows get their app icons in the background; this answer never waits.
    scheduleGameIconRefresh();
    return res.json({ success: true, ...result });
  } catch (error) {
    log.error('Game search failed', error);
    return res.status(500).json({ success: false, error: 'Game search failed' });
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
 *       built-in catalogue, games with a tournament open or running here
 *       first. Never filtered by what the viewer already picked: the
 *       onboarding page's card grid needs every built-in on screen so a game
 *       already picked still shows up, selected. Works anonymously.
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
 *                           moduleIcon:
 *                             type: string
 *                             nullable: true
 *                             description: |
 *                               The module's own square tile for this game, as
 *                               a path the client serves. Shipped with the
 *                               module, not taken from the games catalogue:
 *                               the setup wizard lists what this instance can
 *                               run, so the art is ours and every card reads
 *                               the same. `null` when the module ships none,
 *                               and the wizard shows a text mark.
 *                             example: '/games/rocket-league.svg'
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

/**
 * @openapi
 * /api/games/icons/{file}:
 *   get:
 *     tags: [Games]
 *     summary: A game's cached app icon
 *     description: |
 *       The Steam client icon this instance fetched for a game no module or
 *       pack ships an icon for, scaled to 128 px and stored as PNG. The file
 *       name is a hash of its bytes, so a URL never changes meaning and is
 *       cached for a year. `GameSummary.appIconUrl` points here.
 *     parameters:
 *       - in: path
 *         name: file
 *         required: true
 *         schema: { type: string, pattern: '^[a-f0-9]{16}\.png$' }
 *     responses:
 *       200:
 *         description: The icon
 *         content:
 *           image/png: {}
 *       404:
 *         description: No such icon
 */
router.get('/icons/:file', async (req: Request, res: Response) => {
  const file = gameIconPath(req.params.file);
  if (!file) {
    res.status(404).json({ success: false, error: 'No such icon' });
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) {
      res.removeHeader('Cache-Control');
      res.status(404).json({ success: false, error: 'No such icon' });
    }
  });
});

export default router;
