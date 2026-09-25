/**
 * The platform process itself. Admin-only; writes must be same-site JSON
 * (the catalog's CSRF check), and a read-only API token cannot write.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { restartSupport, scheduleRestart } from '../utils/restart';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /api/system/restart:
 *   get:
 *     tags: [System]
 *     summary: Whether this instance can restart itself
 *     description: |
 *       `supported` is true when a supervisor brings the process back after it
 *       exits (the Docker image with a restart policy, or
 *       `AT_RESTART_SUPERVISED=true`); otherwise `reason` says why not.
 *   post:
 *     tags: [System]
 *     summary: Restart the platform
 *     description: |
 *       Answers 202, then shuts down cleanly and exits for the supervisor to
 *       start it again (loading module updates that wait for a restart). 409
 *       when nothing would bring it back: restart it yourself. Same-site JSON only.
 */
router.get('/restart', (_req: Request, res: Response) => {
  res.json({ success: true, ...restartSupport() });
});

router.post('/restart', (req: Request, res: Response) => {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return;
  }
  const support = restartSupport();
  if (!support.supported) {
    res.status(409).json({ success: false, error: support.reason, code: 'unsupervised' });
    return;
  }
  if (!scheduleRestart(requestActorId(req))) {
    res.status(409).json({ success: false, error: 'A restart is already under way.', code: 'restarting' });
    return;
  }
  res.status(202).json({ success: true, message: 'Restarting.' });
});

export default router;
