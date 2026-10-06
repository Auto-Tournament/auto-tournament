/**
 * Demo analysis (../demos/jobs.ts).
 *
 * For the worker container, with an API token:
 *   POST /api/game/cs2/demo-worker/claim                        the next demo to read, or 204
 *   PUT  /api/game/cs2/demo-worker/jobs/:slug/:map/replay       the 2D replay (gzip JSON)
 *   POST /api/game/cs2/demo-worker/jobs/:slug/:map/result       the analysis
 *   POST /api/game/cs2/demo-worker/jobs/:slug/:map/fail         it could not read the demo
 *
 * Public, like the match's demos:
 *   GET  /api/game/cs2/matches/:slug/maps/:map/analysis         rounds and kills
 *   GET  /api/game/cs2/matches/:slug/maps/:map/replay           the 2D replay frames
 */

import fs from 'fs';
import express, { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  claimDemoJob,
  completeDemoJob,
  failDemoJob,
  readDemoAnalysis,
  replayFile,
  saveReplay,
  type DemoAnalysisPayload,
  type DemoJob,
} from '../demos/jobs';

const router = Router();

/** Replays are a few MB at most; a 40-round map at 4 frames a second is under 2. */
const REPLAY_MAX_BYTES = 32 * 1024 * 1024;

function jobOf(req: Request): DemoJob | null {
  const mapNumber = Number(req.params.map);
  if (!req.params.slug || !Number.isInteger(mapNumber) || mapNumber < 0) return null;
  return { matchSlug: req.params.slug, mapNumber };
}

const workerName = (req: Request) =>
  typeof req.body?.worker === 'string' ? req.body.worker.slice(0, 120) : 'worker';

router.post('/demo-worker/claim', requireAuth, async (req: Request, res: Response) => {
  try {
    const version = Number(req.body?.analyzerVersion);
    const job = await claimDemoJob(workerName(req), Number.isInteger(version) ? version : 0);
    if (!job) return res.status(204).end();
    return res.json({ success: true, job });
  } catch (error) {
    log.error('[DEMO-JOBS] claim failed', { error });
    return res.status(500).json({ success: false, error: 'Could not hand out a job' });
  }
});

router.put(
  '/demo-worker/jobs/:slug/:map/replay',
  requireAuth,
  express.raw({ type: 'application/gzip', limit: REPLAY_MAX_BYTES }),
  async (req: Request, res: Response) => {
    const job = jobOf(req);
    if (
      !job ||
      !Buffer.isBuffer(req.body) ||
      req.body.length < 2 ||
      req.body[0] !== 0x1f ||
      req.body[1] !== 0x8b
    ) {
      return res.status(400).json({ success: false, error: 'A gzip body for a job' });
    }
    try {
      await saveReplay(job, req.body);
      return res.json({ success: true });
    } catch (error) {
      log.error('[DEMO-JOBS] replay save failed', { error });
      return res.status(500).json({ success: false, error: 'Could not store the replay' });
    }
  }
);

router.post(
  '/demo-worker/jobs/:slug/:map/result',
  requireAuth,
  async (req: Request, res: Response) => {
    const job = jobOf(req);
    const analysis = req.body?.analysis as DemoAnalysisPayload | undefined;
    if (
      !job ||
      !analysis ||
      typeof analysis.players !== 'object' ||
      !Array.isArray(analysis.rounds)
    ) {
      return res.status(400).json({ success: false, error: 'An analysis for a job' });
    }
    try {
      await completeDemoJob(job, analysis);
      return res.json({ success: true });
    } catch (error) {
      log.error('[DEMO-JOBS] result failed', { error, job });
      await failDemoJob(job, `apply: ${(error as Error).message}`).catch(() => undefined);
      return res.status(500).json({ success: false, error: 'Could not apply the analysis' });
    }
  }
);

router.post(
  '/demo-worker/jobs/:slug/:map/fail',
  requireAuth,
  async (req: Request, res: Response) => {
    const job = jobOf(req);
    if (!job) return res.status(400).json({ success: false, error: 'A job' });
    await failDemoJob(job, typeof req.body?.error === 'string' ? req.body.error : 'unknown');
    return res.json({ success: true });
  }
);

router.get('/matches/:slug/maps/:map/analysis', async (req: Request, res: Response) => {
  const job = jobOf(req);
  if (!job) return res.status(400).json({ success: false, error: 'A match and a map number' });
  const analysis = await readDemoAnalysis(job);
  if (!analysis) return res.status(404).json({ success: false, error: 'No analysis for this map' });
  return res.json({ success: true, ...analysis });
});

router.get('/matches/:slug/maps/:map/replay', async (req: Request, res: Response) => {
  const job = jobOf(req);
  if (!job) return res.status(400).json({ success: false, error: 'A match and a map number' });
  const file = replayFile(job);
  if (!fs.existsSync(file))
    return res.status(404).json({ success: false, error: 'No replay for this map' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return fs.createReadStream(file).pipe(res);
});

export default router;
