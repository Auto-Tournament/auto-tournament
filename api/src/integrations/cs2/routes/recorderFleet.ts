import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  FleetError,
  listRecorderGroups,
  createRecorderGroup,
  setGroupEnabled,
  setRecorderControls,
  matchRecordingGroup,
  setMatchRecordingGroup,
} from '../demos/recorderFleet';
export const recorderFleetRouter = Router();
const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    return res.json(await fn(req));
  } catch (error) {
    if (error instanceof FleetError)
      return res.status(error.status).json({ success: false, error: error.message });
    log.error('[RECORDER FLEET] action failed', { error });
    return res.status(500).json({ success: false, error: 'Could not update recorder fleet' });
  }
};
/**
 * @openapi
 * /api/game/cs2/recorder-groups:
 *   get:
 *     tags: [Highlight recorders]
 *     summary: List recorder groups (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.get(
  '/recorder-groups',
  requireAuth,
  handle(async () => ({ groups: await listRecorderGroups() }))
);
/**
 * @openapi
 * /api/game/cs2/recorder-groups:
 *   post:
 *     tags: [Highlight recorders]
 *     summary: Create a recorder group (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 80 }
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.post(
  '/recorder-groups',
  requireAuth,
  handle(async (req) => ({ id: await createRecorderGroup(req.body?.name) }))
);
/**
 * @openapi
 * /api/game/cs2/recorder-groups/{id}:
 *   put:
 *     tags: [Highlight recorders]
 *     summary: Enable or drain a recorder group (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
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
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.put(
  '/recorder-groups/:id',
  requireAuth,
  handle(async (req) => {
    await setGroupEnabled(Number(req.params.id), req.body?.enabled);
    return { success: true };
  })
);
/**
 * @openapi
 * /api/game/cs2/recorders/{name}/controls:
 *   put:
 *     tags: [Highlight recorders]
 *     summary: Change recorder availability or group (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               groupId: { type: integer, nullable: true }
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.put(
  '/recorders/:name/controls',
  requireAuth,
  handle(async (req) => {
    await setRecorderControls(req.params.name, req.body ?? {});
    return { success: true };
  })
);
/**
 * @openapi
 * /api/game/cs2/matches/{slug}/recording-group:
 *   get:
 *     tags: [Highlight recorders]
 *     summary: Read the recorder group selected for a match (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.get(
  '/matches/:slug/recording-group',
  requireAuth,
  handle(async (req) => ({ groupId: await matchRecordingGroup(req.params.slug) }))
);
/**
 * @openapi
 * /api/game/cs2/matches/{slug}/recording-group:
 *   put:
 *     tags: [Highlight recorders]
 *     summary: Select the recorder group for future match jobs (admin)
 *     description: Disabling drains existing work. Group selection applies to future claims; null allows all recorders.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               groupId: { type: integer, nullable: true }
 *     responses:
 *       200:
 *         description: Recorder fleet settings
 *       400:
 *         description: Invalid settings
 *       401:
 *         description: Admin authentication required
 */
recorderFleetRouter.put(
  '/matches/:slug/recording-group',
  requireAuth,
  handle(async (req) => {
    await setMatchRecordingGroup(req.params.slug, req.body?.groupId);
    return { success: true };
  })
);
