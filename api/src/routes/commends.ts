/**
 * Commends after a match (services/commends.ts): what the viewer gave in a
 * match, giving or taking one back, and a player's counts.
 */
import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { isSameSiteRequest } from '../utils/accountConnections';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';
import { CommendError, commendCounts, commendState, setCommend } from '../services/commends';
import type { Untrusted } from '../utils/untrusted';

const router = Router();

function guardWrite(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req) && !req.headers.authorization) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  next();
}

function fail(res: Response, error: unknown, fallback: string): Response {
  if (error instanceof CommendError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: error.code });
  }
  log.error(`[COMMENDS] ${fallback}`, error as Error);
  return res.status(500).json({ success: false, error: fallback });
}

/**
 * @openapi
 * /api/commends/match/{slug}:
 *   get:
 *     tags: [Commends]
 *     summary: Commends in a match, for the signed-in player
 *     description: |
 *       The match's players by team, whether the viewer can commend (they
 *       played, and it is within 24 hours of the end), when that closes, and
 *       what they gave. Never who else gave what.
 *     responses:
 *       200:
 *         description: "`open`, `closesAt`, `max`, `given` and `sides`"
 */
router.get('/match/:slug', async (req: Request, res: Response) => {
  try {
    const { effectiveSteamId } = await resolveViewerIdentity(req);
    return res.json({ success: true, ...(await commendState(req.params.slug, effectiveSteamId)) });
  } catch (error) {
    return fail(res, error, 'Could not load commends');
  }
});

/**
 * @openapi
 * /api/commends/match/{slug}/{playerId}:
 *   put:
 *     tags: [Commends]
 *     summary: Commend a player from the match, change it, or take it back
 *     description: |
 *       `kind` is friendly, leader, teacher or good_sport; null takes it back.
 *       Up to 3 players per match, not yourself, for 24 hours after it ends.
 *     responses:
 *       200:
 *         description: The viewer's commends in the match, as GET returns them
 *       409:
 *         description: Closed, or already 3 given
 */
router.put('/match/:slug/:playerId', guardWrite, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    return res.status(401).json({ success: false, error: 'Sign in to commend a player' });
  }
  if (identity.isImpersonating) {
    return res.status(403).json({ success: false, error: 'Stop impersonating first' });
  }
  try {
    const kind = (req.body as { kind?: Untrusted } | undefined)?.kind ?? null;
    const state = await setCommend(
      req.params.slug,
      identity.realSteamId,
      req.params.playerId,
      kind
    );
    return res.json({ success: true, ...state });
  } catch (error) {
    return fail(res, error, 'Could not save the commend');
  }
});

/**
 * @openapi
 * /api/commends/player/{playerId}:
 *   get:
 *     tags: [Commends]
 *     summary: A player's commends, counts only
 *     responses:
 *       200:
 *         description: "`total`, `matches` and `kinds` (count per kind)"
 */
router.get('/player/:playerId', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, ...(await commendCounts(req.params.playerId)) });
  } catch (error) {
    return fail(res, error, 'Could not load commends');
  }
});

export default router;
