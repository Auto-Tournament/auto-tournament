/**
 * Admin calls: players asking for an admin from a game server
 * (services/adminCallService.ts). Admin only. Calls arrive through the game's
 * own event ingest (CS2: `admin_called` on /api/events), not here.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { log } from '../utils/logger';
import {
  DEFAULT_RESOLVED_WINDOW_SECONDS,
  getAdminCall,
  listAdminCalls,
  resolveAdminCall,
  resolveAllAdminCalls,
} from '../services/adminCallService';

const router = Router();

router.use(requireAuth);

/** At most 30 days of resolved calls in one listing. */
const MAX_RESOLVED_WINDOW_SECONDS = 30 * 24 * 60 * 60;

function resolvedWindow(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_RESOLVED_WINDOW_SECONDS;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Math.min(Number(raw), MAX_RESOLVED_WINDOW_SECONDS);
}

function noteFrom(req: Request): unknown {
  return (req.body as { note?: unknown } | undefined)?.note;
}

/**
 * @openapi
 * /api/admin-calls:
 *   get:
 *     tags: [Admin calls]
 *     summary: Open admin calls and recently resolved ones
 *     description: |
 *       `open` is every call no admin has resolved yet, oldest first.
 *       `resolved` is the calls resolved within `resolvedWithin` seconds
 *       (default 86400, at most 30 days, 0 for none), newest first, at most
 *       100. New calls and resolutions are also sent to signed-in admins as
 *       the Socket.IO events `admin:call` and `admin:call:resolved` (after
 *       `admin:subscribe`).
 *     parameters:
 *       - in: query
 *         name: resolvedWithin
 *         schema: { type: integer, minimum: 0 }
 *         description: How many seconds back to list resolved calls
 *     responses:
 *       200:
 *         description: The calls
 *       400:
 *         description: resolvedWithin is not a whole number
 */
router.get('/', async (req: Request, res: Response) => {
  const window = resolvedWindow(req.query.resolvedWithin);
  if (window === null) {
    return res
      .status(400)
      .json({ success: false, error: 'resolvedWithin must be a whole number of seconds' });
  }
  try {
    const { open, resolved } = await listAdminCalls(window);
    return res.json({ success: true, open, resolved });
  } catch (error) {
    log.error('Failed to list admin calls', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to list admin calls' });
  }
});

/**
 * @openapi
 * /api/admin-calls/resolve-all:
 *   post:
 *     tags: [Admin calls]
 *     summary: Resolve every open admin call
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, description: Optional resolution note (500 characters at most) }
 *     responses:
 *       200:
 *         description: The ids resolved (empty when nothing was open)
 */
router.post('/resolve-all', async (req: Request, res: Response) => {
  try {
    const ids = await resolveAllAdminCalls(requestActorId(req), noteFrom(req));
    return res.json({ success: true, resolved: ids });
  } catch (error) {
    log.error('Failed to resolve every admin call', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to resolve the admin calls' });
  }
});

/**
 * @openapi
 * /api/admin-calls/{id}:
 *   get:
 *     tags: [Admin calls]
 *     summary: One admin call
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The call
 *       404:
 *         description: No such call
 */
router.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ success: false, error: 'Admin call not found' });
  }
  try {
    const call = await getAdminCall(id);
    if (!call) return res.status(404).json({ success: false, error: 'Admin call not found' });
    return res.json({ success: true, call });
  } catch (error) {
    log.error('Failed to read an admin call', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to read the admin call' });
  }
});

/**
 * @openapi
 * /api/admin-calls/{id}/resolve:
 *   post:
 *     tags: [Admin calls]
 *     summary: Mark an admin call resolved
 *     description: |
 *       Idempotent: resolving a call that is already resolved keeps the first
 *       resolution and answers 200 with `alreadyResolved: true`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, description: Optional resolution note (500 characters at most) }
 *     responses:
 *       200:
 *         description: The resolved call
 *       404:
 *         description: No such call
 */
router.post('/:id/resolve', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ success: false, error: 'Admin call not found' });
  }
  try {
    const result = await resolveAdminCall(id, requestActorId(req), noteFrom(req));
    if (!result) return res.status(404).json({ success: false, error: 'Admin call not found' });
    return res.json({ success: true, call: result.call, alreadyResolved: !result.changed });
  } catch (error) {
    log.error('Failed to resolve an admin call', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to resolve the admin call' });
  }
});

export default router;
