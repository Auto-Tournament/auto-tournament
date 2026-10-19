/** Heartbeats, runs, benchmarks and the admin pages for recorders, clips and keys (highlights.ts). */
import { heartbeatRecorderClaim } from '../demos/recorderLeases';

import { Router, type Request, type Response } from 'express';
import { requestActorId, requireAuth } from '../../../middleware/auth';
import {
  createRecorderKey,
  listRecorderKeys,
  requireRecorder,
  revokeRecorderKey,
} from '../demos/recorderKeys';
import { log } from '../../../utils/logger';
import { renewClaims } from '../demos/highlights';
import {
  listClips,
  redo,
  reviewClip,
  type RedoRequest,
  type ReviewVerdict,
} from '../demos/clipsAdmin';

import {
  forgetRecorder,
  setRecorderLabel,
  listRecorders,
  listRuns,
  requestBenchmark,
  resumeRecorder,
  runLog,
  saveRun,
} from '../demos/recorders';
import { saveBenchmark } from '../demos/recorderBenchmark';

import type { Untrusted } from '../../../utils/untrusted';
import { idOf, recorderFail, recorderName } from './highlightRouteHelpers';

export function registerRecorderAdminRoutes(router: Router): void {
  /**
   * @openapi
   * /api/game/cs2/recorder/runs:
   *   post:
   *     tags: [Highlights]
   *     summary: A recorder's finished job, its timings and log (recorder)
   *     description: |
   *       `recorder`, `kind` (map, match_reel, redress, benchmark, ...),
   *       `matchSlug`, `mapNumber`, `startedAt` (unix seconds), `seconds`, `ok`,
   *       `clips`, `rejected`, `error`, `log` (the job's log lines, the last
   *       200 kB are kept). The newest 200 runs per recorder are kept.
   *     responses:
   *       200:
   *         description: Stored
   */
  /**
   * @openapi
   * /api/game/cs2/recorder/heartbeat:
   *   post:
   *     tags: [Highlights]
   *     summary: A recorder at a job says it still is; what it claimed stays its own
   *     description: "`recorder`: its name. Sent every few minutes during a job."
   *     responses:
   *       200:
   *         description: How many claims were renewed
   */
  router.post('/recorder/heartbeat', requireRecorder, async (req: Request, res: Response) => {
    const recorder = typeof req.body?.recorder === 'string' ? req.body.recorder.trim() : '';
    if (!recorder) return res.status(400).json({ success: false, error: 'A recorder name' });
    try {
      const token = req.header('X-AT-Claim');
      if (token) await heartbeatRecorderClaim(recorder, token);
      return res.json({ success: true, renewed: await renewClaims(recorder) });
    } catch (error) {
      log.error('[HIGHLIGHTS] heartbeat failed', { error });
      return res.status(500).json({ success: false, error: 'Could not renew the claims' });
    }
  });

  router.post('/recorder/runs', requireRecorder, async (req: Request, res: Response) => {
    try {
      await saveRun(recorderName(req), (req.body ?? {}) as Record<string, Untrusted>);
      return res.json({ success: true });
    } catch (error) {
      return recorderFail(res, error, 'store the run');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorder/benchmark:
   *   post:
   *     tags: [Highlights]
   *     summary: A recorder's benchmark results (recorder)
   *     description: |
   *       `recorder` and `tries`: per refresh rate (`gamescopeHz`) the seconds
   *       the moment took, the capture frame rate and `ok`. The fastest finished
   *       try's rate is kept and sent with every job after (`settings.gamescopeHz`).
   *     responses:
   *       200:
   *         description: "`gamescopeHz`: the pick, or null when no try finished"
   */
  router.post('/recorder/benchmark', requireRecorder, async (req: Request, res: Response) => {
    try {
      const picked = await saveBenchmark(
        recorderName(req),
        (req.body ?? {}) as { tries?: Untrusted }
      );
      return res.json({ success: true, ...picked });
    } catch (error) {
      return recorderFail(res, error, 'store the benchmark');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders:
   *   get:
   *     tags: [Highlights]
   *     summary: The highlight recorders (admin)
   *     description: |
   *       Each recorder with its GPU, version, last seen, pause, benchmark
   *       (each try and the pick), clips kept, seconds per clip
   *       over its map jobs, and its last error.
   *     responses:
   *       200:
   *         description: "`recorders`"
   */
  router.get('/recorders', requireAuth, async (_req: Request, res: Response) => {
    try {
      return res.json({ success: true, recorders: await listRecorders() });
    } catch (error) {
      return recorderFail(res, error, 'list the recorders');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders/{name}/runs:
   *   get:
   *     tags: [Highlights]
   *     summary: A recorder's recent runs, newest first (admin)
   *     responses:
   *       200:
   *         description: "`runs`, without their logs"
   */
  router.get('/recorders/:name/runs', requireAuth, async (req: Request, res: Response) => {
    try {
      return res.json({
        success: true,
        runs: await listRuns(req.params.name, Number(req.query.limit ?? 50)),
      });
    } catch (error) {
      return recorderFail(res, error, 'list the runs');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorder-runs/{id}/log:
   *   get:
   *     tags: [Highlights]
   *     summary: A run's log, as plain text (admin)
   *     responses:
   *       200:
   *         description: The log
   *       404:
   *         description: No run with that id
   */
  router.get('/recorder-runs/:id/log', requireAuth, async (req: Request, res: Response) => {
    try {
      const text = await runLog(Number(req.params.id));
      return res.type('text/plain').send(text);
    } catch (error) {
      return recorderFail(res, error, 'read the log');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders/{name}/resume:
   *   post:
   *     tags: [Highlights]
   *     summary: Give a paused recorder work again (admin)
   *     responses:
   *       200:
   *         description: Resumed
   *       404:
   *         description: No recorder with that name
   */
  router.post('/recorders/:name/resume', requireAuth, async (req: Request, res: Response) => {
    try {
      await resumeRecorder(req.params.name);
      return res.json({ success: true });
    } catch (error) {
      return recorderFail(res, error, 'resume the recorder');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders/{name}/benchmark:
   *   post:
   *     tags: [Highlights]
   *     summary: Have a recorder run its benchmark again on its next claim (admin)
   *     responses:
   *       200:
   *         description: Asked
   *       404:
   *         description: No recorder with that name
   */
  router.post('/recorders/:name/benchmark', requireAuth, async (req: Request, res: Response) => {
    try {
      await requestBenchmark(req.params.name);
      return res.json({ success: true });
    } catch (error) {
      return recorderFail(res, error, 'ask for a benchmark');
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders/{name}:
   *   delete:
   *     tags: [Highlights]
   *     summary: Forget a recorder and its runs (admin); it shows up again when it next asks for work
   *     responses:
   *       200:
   *         description: Forgotten
   *       404:
   *         description: No recorder with that name
   */
  /**
   * @openapi
   * /api/game/cs2/clips:
   *   get:
   *     tags: [Highlights]
   *     summary: Every recent match's clips and match reels, what each was made at, and which are outdated (admin)
   *     parameters:
   *       - in: query
   *         name: outdated
   *         schema: { type: boolean }
   *         description: Only the outdated ones
   *     responses:
   *       200:
   *         description: The clips
   */
  router.get('/clips', requireAuth, async (req: Request, res: Response) => {
    try {
      return res.json({ success: true, ...(await listClips(req.query.outdated === '1')) });
    } catch (error) {
      log.error('[HIGHLIGHTS] clips list failed', { error });
      return res.status(500).json({ success: false, error: 'Could not read the clips' });
    }
  });

  /**
   * @openapi
   * /api/game/cs2/clips/redo:
   *   post:
   *     tags: [Highlights]
   *     summary: Make clips and match reels again (admin)
   *     description: |
   *       `clipIds`, `reels` ([{ slug, mapNumber }], -1 for a series reel) and/or
   *       `outdated: true` (everything made at other settings). A redone clip's
   *       reels are made again once it is recorded.
   *     responses:
   *       200:
   *         description: How many clips and reels were queued
   */
  router.post('/clips/redo', requireAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as RedoRequest;
      return res.json({ success: true, ...(await redo(body)) });
    } catch (error) {
      log.error('[HIGHLIGHTS] redo failed', { error });
      return res.status(500).json({ success: false, error: 'Could not queue the clips' });
    }
  });

  /**
   * @openapi
   * /api/game/cs2/clips/{id}/review:
   *   post:
   *     tags: [Highlights]
   *     summary: An admin's verdict on a recorded clip
   *     description: |
   *       `verdict`: `approved`; `redo` (it stutters or looks broken: recorded
   *       again, preferably by another recorder); `weapon` (the weapon and hands
   *       are missing for a stretch: recorded again without TrueView); or `drop` (not worth showing:
   *       not recorded again, left out of every reel, its reels made again).
   *       `note` is optional. 404 when the clip is not recorded.
   *     responses:
   *       200:
   *         description: How many clips and reels were queued
   */
  router.post('/clips/:id/review', requireAuth, async (req: Request, res: Response) => {
    const id = idOf(req);
    const verdict = req.body?.verdict as ReviewVerdict;
    if (!id || !['approved', 'redo', 'weapon', 'drop'].includes(verdict)) {
      return res
        .status(400)
        .json({ success: false, error: 'A clip and a verdict: approved, redo, weapon or drop' });
    }
    try {
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      const result = await reviewClip(id, verdict, note, requestActorId(req));
      if (!result)
        return res.status(404).json({ success: false, error: 'No recorded clip with that id' });
      return res.json({ success: true, ...result });
    } catch (error) {
      log.error('[HIGHLIGHTS] review failed', { error, id });
      return res.status(500).json({ success: false, error: 'Could not save the review' });
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorder-keys:
   *   get:
   *     tags: [Highlights]
   *     summary: The recorder keys (admin); never the keys themselves
   *     responses:
   *       200:
   *         description: The keys
   *   post:
   *     tags: [Highlights]
   *     summary: Make a recorder key (admin); the key is in this answer only
   *     description: "`name`: what it is for, e.g. lan-seat-12."
   *     responses:
   *       200:
   *         description: The key and its token
   */
  router.get('/recorder-keys', requireAuth, async (_req: Request, res: Response) => {
    try {
      return res.json({ success: true, keys: await listRecorderKeys() });
    } catch (error) {
      log.error('[HIGHLIGHTS] recorder keys failed', { error });
      return res.status(500).json({ success: false, error: 'Could not read the recorder keys' });
    }
  });

  router.post('/recorder-keys', requireAuth, async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      return res.status(400).json({ success: false, error: 'A name, up to 80 characters' });
    }
    try {
      const { key, token } = await createRecorderKey(name, requestActorId(req));
      log.info(`[HIGHLIGHTS] recorder key ${key.id} (${key.name}) made`);
      return res.json({ success: true, key, token });
    } catch (error) {
      log.error('[HIGHLIGHTS] recorder key failed', { error });
      return res.status(500).json({ success: false, error: 'Could not make the recorder key' });
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorder-keys/{id}:
   *   delete:
   *     tags: [Highlights]
   *     summary: Revoke a recorder key (admin); a recorder using it stops getting work
   *     responses:
   *       200:
   *         description: Revoked
   *       404:
   *         description: No live key with that id
   */
  router.delete('/recorder-keys/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await revokeRecorderKey(req.params.id)))
        return res.status(404).json({ success: false, error: 'No such key' });
      log.info(`[HIGHLIGHTS] recorder key ${req.params.id} revoked`);
      return res.json({ success: true });
    } catch (error) {
      log.error('[HIGHLIGHTS] revoking a recorder key failed', { error });
      return res.status(500).json({ success: false, error: 'Could not revoke the key' });
    }
  });

  /**
   * @openapi
   * /api/game/cs2/recorders/{name}:
   *   put:
   *     tags: [Highlights]
   *     summary: Name a recorder (admin)
   *     description: "`label`: what the Recorders tab and the Clips list call it; empty for its own name."
   *     responses:
   *       200:
   *         description: Named
   *       404:
   *         description: No recorder by that name
   */
  router.put('/recorders/:name', requireAuth, async (req: Request, res: Response) => {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (label.length > 80)
      return res.status(400).json({ success: false, error: 'Up to 80 characters' });
    try {
      if (!(await setRecorderLabel(req.params.name, label || null)))
        return res.status(404).json({ success: false, error: 'No such recorder' });
      return res.json({ success: true });
    } catch (error) {
      return recorderFail(res, error, 'name the recorder');
    }
  });

  router.delete('/recorders/:name', requireAuth, async (req: Request, res: Response) => {
    try {
      await forgetRecorder(req.params.name);
      return res.json({ success: true });
    } catch (error) {
      return recorderFail(res, error, 'forget the recorder');
    }
  });
}
