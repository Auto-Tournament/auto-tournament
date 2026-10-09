/**
 * Player reports: a signed-in player reports another to the admins; admins
 * list, dismiss, or ban from a report (services/playerReports.ts).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';
import { ModerationError } from '../services/playerModeration';
import {
  banFromReport,
  createReport,
  dismissReport,
  listReports,
  openReportCount,
  ReportError,
} from '../services/playerReports';
import type { Actor } from '../services/matchHolds';

const router = Router();

function guardWrite(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req) && !req.headers.authorization) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  next();
}

function actorOf(req: Request): Actor {
  const id = requestActorId(req) ?? 'admin';
  return { userId: id, name: id };
}

function fail(res: Response, error: unknown, fallback: string): Response {
  if (error instanceof ReportError || error instanceof ModerationError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: (error as ReportError).code });
  }
  log.error(`[REPORTS] ${fallback}`, error as Error);
  return res.status(500).json({ success: false, error: fallback });
}

/**
 * @openapi
 * /api/player-reports:
 *   post:
 *     tags: [Reports]
 *     summary: Report a player to the admins
 *     description: |
 *       Signed-in players only, not while impersonating. `reason` is cheating,
 *       toxic, griefing, name or other (`details` required for other). One
 *       open report per player, 10 a day. Every admin is notified.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               playerId: { type: string }
 *               reason: { type: string, enum: [cheating, toxic, griefing, name, other] }
 *               details: { type: string }
 *     responses:
 *       201:
 *         description: Sent
 *       400:
 *         description: No reason, no details for other, or yourself
 *       401:
 *         description: Not signed in
 *       409:
 *         description: You already have an open report about this player
 *       429:
 *         description: Too many reports today
 */
router.post('/', guardWrite, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId)
    return res.status(401).json({ success: false, error: 'Sign in to report a player' });
  if (identity.isImpersonating) {
    return res.status(403).json({ success: false, error: 'Stop impersonating first' });
  }
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const created = await createReport(identity.realSteamId, {
      playerId: body.playerId,
      reason: body.reason,
      details: body.details,
    });
    return res.status(201).json({ success: true, ...created });
  } catch (error) {
    return fail(res, error, 'Could not send the report');
  }
});

/**
 * @openapi
 * /api/player-reports:
 *   get:
 *     tags: [Reports]
 *     summary: Reports (admin)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, all] }
 *     responses:
 *       200:
 *         description: "`reports`, newest first, and `open`: how many are open"
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = req.query.status === 'all' ? 'all' : 'open';
    return res.json({
      success: true,
      reports: await listReports(status),
      open: await openReportCount(),
    });
  } catch (error) {
    return fail(res, error, 'Could not load the reports');
  }
});

/**
 * @openapi
 * /api/player-reports/{id}/dismiss:
 *   post:
 *     tags: [Reports]
 *     summary: Dismiss a report (admin); its reporter hears it was reviewed
 *     responses:
 *       200:
 *         description: Dismissed
 *       404:
 *         description: No open report with that id
 */
router.post('/:id/dismiss', requireAuth, guardWrite, async (req: Request, res: Response) => {
  try {
    await dismissReport(Number(req.params.id), actorOf(req));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Could not dismiss the report');
  }
});

/**
 * @openapi
 * /api/player-reports/{id}/ban:
 *   post:
 *     tags: [Reports]
 *     summary: Ban the reported player (admin); every open report about them closes
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Banned
 *       404:
 *         description: No open report with that id
 *       409:
 *         description: The player is an admin, or deleted
 */
router.post('/:id/ban', requireAuth, guardWrite, async (req: Request, res: Response) => {
  try {
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason : null;
    await banFromReport(Number(req.params.id), reason, actorOf(req));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Could not ban the player');
  }
});

export default router;
