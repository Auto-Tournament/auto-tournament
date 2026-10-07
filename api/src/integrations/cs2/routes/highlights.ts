/**
 * Highlights (../demos/highlights.ts).
 *
 * For the recorder (`at-worker record`), with an API token:
 *   POST /api/game/cs2/recorder/claim                 a player's moments on one map not yet recorded, or 204
 *   PUT  /api/game/cs2/recorder/jobs/:id/clip         one moment's MP4 (video/mp4 body)
 *   PUT  /api/game/cs2/recorder/reels/:slug/:map/:player  the player's reel of that map (video/mp4 body)
 *   POST /api/game/cs2/recorder/fail                  { ids, error }: it could not record them
 *
 * Public:
 *   GET  /api/game/cs2/players/:playerId/highlights   a player's reels and highlights
 *   GET  /api/game/cs2/highlights/:file               a clip (`<id>.mp4`) or reel (`reel-….mp4`), with range requests
 */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  claimRecordJob,
  clipFile,
  failRecordJob,
  playerHighlights,
  playerReels,
  saveClip,
  saveReel,
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

router.put(
  '/recorder/reels/:slug/:map/:player',
  requireAuth,
  async (req: Request, res: Response) => {
    const map = Number(req.params.map);
    if (!Number.isInteger(map) || map < 0 || !/^\d{1,20}$/.test(req.params.player)) {
      return res.status(400).json({ success: false, error: 'A match, map number and SteamID64' });
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
      return res.status(400).json({ success: false, error: 'A video/mp4 body' });
    }
    try {
      const bytes = await saveReel(req.params.slug, map, req.params.player, req);
      return res.json({ success: true, bytes });
    } catch (error) {
      log.error('[HIGHLIGHTS] reel save failed', { error, slug: req.params.slug });
      return res.status(500).json({ success: false, error: 'Could not store the reel' });
    }
  }
);

router.post('/recorder/fail', requireAuth, async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ success: false, error: 'Highlight ids' });
  await failRecordJob(ids, typeof req.body?.error === 'string' ? req.body.error : 'unknown');
  return res.json({ success: true });
});

router.get('/players/:playerId/highlights', async (req: Request, res: Response) => {
  const [reels, highlights] = await Promise.all([
    playerReels(req.params.playerId),
    playerHighlights(req.params.playerId),
  ]);
  return res.json({ success: true, reels, highlights });
});

router.get('/highlights/:file', (req: Request, res: Response) => {
  const clip = /^(\d+)\.mp4$/.exec(req.params.file);
  const reel = /^reel-[A-Za-z0-9_.-]+\.mp4$/.test(req.params.file);
  if (!clip && !reel) return res.status(404).end();
  const file = clip ? clipFile(Number(clip[1])) : path.join(path.dirname(clipFile(0)), req.params.file);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'video/mp4' } });
});

export default router;
