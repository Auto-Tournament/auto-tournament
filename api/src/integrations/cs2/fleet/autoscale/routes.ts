/**
 * Admin routes for automatic server scaling, mounted at `/api/fleet`:
 *
 *   GET  /api/fleet/autoscale            settings, what the scaler sees and would do now, recent activity
 *   PUT  /api/fleet/autoscale/settings   {enabled?, leadTimeSeconds?, cooldownSeconds?, maxServersPerHost?}
 *   POST /api/fleet/autoscale/run        run a pass now (the timer runs one every 15 s)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../../middleware/auth';
import { log } from '../../../../utils/logger';
import { validateAutoscalePatch } from './plan';
import { autoscaleStatus, runScalerPass } from './scaler';
import { setAutoscaleSettings } from './settings';

export const fleetAutoscaleRouter = Router();
fleetAutoscaleRouter.use(requireAuth);

function handler(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error) => {
      log.error(`[AUTOSCALE] ${what} failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: `Failed to ${what}` });
    });
  };
}

function activityLimit(req: Request): number {
  const n = Number(req.query.activity);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 20;
}

fleetAutoscaleRouter.get(
  '/autoscale',
  handler('read the scaler', async (req, res) => {
    return res.json({ success: true, ...(await autoscaleStatus(activityLimit(req))) });
  })
);

fleetAutoscaleRouter.put(
  '/autoscale/settings',
  handler('save the scaler settings', async (req, res) => {
    const check = validateAutoscalePatch(req.body);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    await setAutoscaleSettings(check.patch, requestActorId(req));
    return res.json({ success: true, ...(await autoscaleStatus(activityLimit(req))) });
  })
);

fleetAutoscaleRouter.post(
  '/autoscale/run',
  handler('run the scaler', async (_req, res) => {
    const pass = await runScalerPass();
    return res.json({
      success: true,
      desired: pass?.plan.desired ?? 0,
      warm: pass?.plan.warm ?? 0,
      reserve: pass?.plan.reserve ?? 0,
      note: pass?.plan.note ?? null,
      demand: pass?.demand ?? null,
      linked: pass?.linked ?? 0,
      actions: pass?.outcomes ?? [],
    });
  })
);
