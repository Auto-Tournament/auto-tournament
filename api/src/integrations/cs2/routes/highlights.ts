/**
 * Highlights (../demos/highlights.ts).
 *
 * For the recorder (`at-worker record`), with an API token:
 *   POST /api/game/cs2/recorder/claim                 the best moment not yet recorded, or 204
 *   PUT  /api/game/cs2/recorder/jobs/:id/clip         the finished MP4 (video/mp4 body)
 *   POST /api/game/cs2/recorder/jobs/:id/fail         it could not record it
 *
 * Public:
 *   GET  /api/game/cs2/players/:playerId/highlights   a player's highlights, best first
 *   GET  /api/game/cs2/highlights/:file               a clip (`<id>.mp4`), with range requests
 */

import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  claimRecordJob,
  clipFile,
  failRecordJob,
  playerHighlights,
  saveClip,
} from '../demos/highlights';

const router = Router();

const idOf = (req: Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.post('/recorder/claim', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await claimRecordJob(
      typeof req.body?.recorder === 'string' ? req.body.recorder : 'recorder'
    );
    if (!job) return res.status(204).end();
    return res.json({ success: true, job });
  } catch (error) {
    log.error('[HIGHLIGHTS] claim failed', { error });
    return res.status(500).json({ success: false, error: 'Could not hand out a highlight' });
  }
});

router.put('/recorder/jobs/:id/clip', requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req);
  if (!id || !String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body for a highlight' });
  }
  try {
    const bytes = await saveClip(id, req);
    return res.json({ success: true, bytes });
  } catch (error) {
    log.error('[HIGHLIGHTS] clip save failed', { error, id });
    return res.status(500).json({ success: false, error: 'Could not store the clip' });
  }
});

router.post('/recorder/jobs/:id/fail', requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ success: false, error: 'A highlight id' });
  await failRecordJob(id, typeof req.body?.error === 'string' ? req.body.error : 'unknown');
  return res.json({ success: true });
});

router.get('/players/:playerId/highlights', async (req: Request, res: Response) => {
  return res.json({ success: true, highlights: await playerHighlights(req.params.playerId) });
});

router.get('/highlights/:file', (req: Request, res: Response) => {
  const m = /^(\d+)\.mp4$/.exec(req.params.file);
  if (!m) return res.status(404).end();
  const file = clipFile(Number(m[1]));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'video/mp4' } });
});

export default router;
