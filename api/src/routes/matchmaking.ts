/**
 * Matchmaking (docs/design/matchmaking.md). Experimental: every route here
 * answers 404 until the `matchmaking` feature is on, and is admin only while
 * it is being built. Only a status endpoint exists so far.
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireExperimentalFeature } from '../services/experimentalFeatures';

const router = Router();

// The flag first: while it is off, even an anonymous caller gets a 404.
router.use(requireExperimentalFeature('matchmaking'));
router.use(requireAuth);

/**
 * @openapi
 * /api/matchmaking/status:
 *   get:
 *     tags: [Matchmaking]
 *     summary: Matchmaking status (experimental)
 *     description: |
 *       404 unless the experimental `matchmaking` feature is on. Admin only
 *       while matchmaking is being built. No queue exists yet.
 *     responses:
 *       200:
 *         description: Matchmaking is on
 *       404:
 *         description: Matchmaking is off
 */
router.get('/status', (_req: Request, res: Response) => {
  return res.json({ success: true, enabled: true, queue: null });
});

export default router;
