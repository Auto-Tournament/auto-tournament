/**
 * Experimental features (services/experimentalFeatures): list them and turn
 * one on or off. Admin only; writes must be same-site JSON.
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { log } from '../utils/logger';
import {
  findExperimentalFeature,
  listExperimentalFeatures,
  setExperimentalFeature,
  type ExperimentalFeatureId,
} from '../services/experimentalFeatures';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /api/experimental:
 *   get:
 *     tags: [Experimental]
 *     summary: List experimental features
 *     description: |
 *       Every experimental feature with `enabled` and where that came from
 *       (`source`: `env`, `setting` or `default`). When `source` is `env`,
 *       the environment variable named in `env` decides and the admin toggle
 *       has no effect. Admin only.
 *     responses:
 *       200:
 *         description: The features
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, features: await listExperimentalFeatures() });
  } catch (error) {
    log.error('[EXPERIMENTAL] Could not list features', error as Error);
    return res.status(500).json({ success: false, error: 'Could not list features' });
  }
});

/**
 * @openapi
 * /api/experimental/{id}:
 *   put:
 *     tags: [Experimental]
 *     summary: Turn an experimental feature on or off
 *     description: |
 *       Body `{ "enabled": boolean }`. Stored as a setting; an environment
 *       override still wins. Admin only; same-site JSON.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The feature's new state
 *       400:
 *         description: "`enabled` is not a boolean"
 *       404:
 *         description: No such feature
 */
router.put('/:id', async (req: Request, res: Response) => {
  if (!isSameSiteRequest(req)) {
    return res.status(403).json({ success: false, error: 'Request refused' });
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ success: false, error: 'Send this request as JSON' });
  }
  const feature = findExperimentalFeature(req.params.id);
  if (!feature) {
    return res.status(404).json({ success: false, error: 'Unknown experimental feature' });
  }
  const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: '`enabled` must be true or false' });
  }
  try {
    const state = await setExperimentalFeature(feature.id as ExperimentalFeatureId, enabled);
    return res.json({ success: true, feature: state });
  } catch (error) {
    log.error('[EXPERIMENTAL] Could not save feature', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save feature' });
  }
});

export default router;
