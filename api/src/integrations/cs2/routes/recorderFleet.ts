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
recorderFleetRouter.get(
  '/recorder-groups',
  requireAuth,
  handle(async () => ({ groups: await listRecorderGroups() }))
);
recorderFleetRouter.post(
  '/recorder-groups',
  requireAuth,
  handle(async (req) => ({ id: await createRecorderGroup(req.body?.name) }))
);
recorderFleetRouter.put(
  '/recorder-groups/:id',
  requireAuth,
  handle(async (req) => {
    await setGroupEnabled(Number(req.params.id), req.body?.enabled);
    return { success: true };
  })
);
recorderFleetRouter.put(
  '/recorders/:name/controls',
  requireAuth,
  handle(async (req) => {
    await setRecorderControls(req.params.name, req.body ?? {});
    return { success: true };
  })
);
recorderFleetRouter.get(
  '/matches/:slug/recording-group',
  requireAuth,
  handle(async (req) => ({ groupId: await matchRecordingGroup(req.params.slug) }))
);
recorderFleetRouter.put(
  '/matches/:slug/recording-group',
  requireAuth,
  handle(async (req) => {
    await setMatchRecordingGroup(req.params.slug, req.body?.groupId);
    return { success: true };
  })
);
