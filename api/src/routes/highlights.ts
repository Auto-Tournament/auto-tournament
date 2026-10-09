/**
 * Highlights, the parts every game shares: the music library under reels and
 * the mixes made from it (services/highlights/music.ts). The videos
 * themselves are each game's (CS2: /api/game/cs2/highlights/...); they all
 * live in DATA_DIR/highlights, which is where these mixes read them from.
 */
import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import {
  addTrack,
  allTracks,
  enabledTracks,
  fetchTrack,
  HIGHLIGHTS_DIR,
  MUSIC_MAX_BYTES,
  musicLevel,
  MusicUploadError,
  reelMusic,
  removeTrack,
  trackById,
  trackFile,
  updateTrack,
  withSound,
} from '../services/highlights/music';
import { MUSIC_SUGGESTIONS } from '../services/highlights/musicSuggestions';

const router = Router();

/** A video in DATA_DIR/highlights: a clip (`123`) or a reel (`reel-…`, `match-…`, `team-…`, `tournament-…`). */
const VIDEO = /^(\d+|(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?)\.mp4$/;
const REEL = /^(?:reel|match|tournament|team)-[A-Za-z0-9_.-]+\.mp4$/;

/**
 * @openapi
 * /api/highlights/music:
 *   get:
 *     tags: [Highlights]
 *     summary: The music library
 *     description: "`tracks`: the ones reels play (the Highlights setting), `all`: every track, `suggestions`: where to find music."
 *     responses:
 *       200:
 *         description: The library
 */
router.get('/music', async (_req: Request, res: Response) => {
  try {
    const [tracks, all] = await Promise.all([enabledTracks(), allTracks()]);
    return res.json({ success: true, tracks, all, suggestions: MUSIC_SUGGESTIONS });
  } catch (error) {
    log.error('[HIGHLIGHTS] music list failed', { error });
    return res.status(500).json({ success: false, error: 'Could not read the music' });
  }
});

/** The library's form fields, from a query string or a JSON body. */
const trackFields = (src: Record<string, unknown>) => {
  const str = (k: string) => (typeof src[k] === 'string' ? (src[k] as string).trim() : undefined);
  return {
    title: str('title'),
    artist: str('artist'),
    genre: str('genre'),
    source: str('source'),
    contentId:
      src.contentId === undefined
        ? undefined
        : src.contentId === true || src.contentId === '1' || src.contentId === 'true',
  };
};

/**
 * @openapi
 * /api/highlights/music:
 *   post:
 *     tags: [Highlights]
 *     summary: Add a track (admin)
 *     description: The audio file as the body; title, artist, genre, source and contentId in the query.
 *     responses:
 *       200:
 *         description: "`track`"
 *       400:
 *         description: No title, or not audio
 */
router.post(
  '/music',
  requireAuth,
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MUSIC_MAX_BYTES }),
  async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      return res.status(415).json({ success: false, error: 'Send the track as an audio file.' });
    const f = trackFields(req.query as Record<string, unknown>);
    if (!f.title) return res.status(400).json({ success: false, error: 'A title' });
    try {
      const track = await addTrack(req.body, {
        title: f.title,
        artist: f.artist ?? '',
        genre: f.genre ?? '',
        source: f.source ?? '',
        contentId: f.contentId ?? false,
      });
      return res.json({ success: true, track });
    } catch (error) {
      if (error instanceof MusicUploadError)
        return res.status(400).json({ success: false, error: error.message });
      log.error('[HIGHLIGHTS] music upload failed', { error });
      return res.status(500).json({ success: false, error: 'Could not add the track' });
    }
  }
);

/**
 * @openapi
 * /api/highlights/music/from-link:
 *   post:
 *     tags: [Highlights]
 *     summary: Add a track from a link to its audio file (admin)
 *     responses:
 *       200:
 *         description: "`track`"
 */
router.post('/music/from-link', requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const f = trackFields(body);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return res.status(400).json({ success: false, error: 'A link' });
  try {
    const audio = await fetchTrack(url);
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(
      /\.[^.]+$/,
      ''
    );
    const track = await addTrack(audio, {
      title: f.title || name.replace(/[-_]+/g, ' ').trim() || 'Untitled',
      artist: f.artist ?? '',
      genre: f.genre ?? '',
      source: f.source || url,
      contentId: f.contentId ?? false,
    });
    return res.json({ success: true, track });
  } catch (error) {
    if (error instanceof MusicUploadError)
      return res.status(400).json({ success: false, error: error.message });
    log.warn('[HIGHLIGHTS] music from a link failed', { error: String(error) });
    return res.status(502).json({ success: false, error: 'Could not download that link' });
  }
});

/**
 * @openapi
 * /api/highlights/music/{id}:
 *   put:
 *     tags: [Highlights]
 *     summary: Edit a track's details (admin)
 *     responses:
 *       200:
 *         description: "`track`"
 *       404:
 *         description: No such track
 *   delete:
 *     tags: [Highlights]
 *     summary: Remove a track (admin)
 *     responses:
 *       200:
 *         description: Removed
 *       404:
 *         description: No such track
 */
router.put('/music/:id', requireAuth, async (req: Request, res: Response) => {
  const f = trackFields((req.body ?? {}) as Record<string, unknown>);
  const track = await updateTrack(req.params.id, {
    ...(f.title ? { title: f.title } : {}),
    ...(f.artist !== undefined ? { artist: f.artist } : {}),
    ...(f.genre !== undefined ? { genre: f.genre } : {}),
    ...(f.source !== undefined ? { source: f.source } : {}),
    ...(f.contentId !== undefined ? { contentId: f.contentId } : {}),
  });
  if (!track) return res.status(404).json({ success: false, error: 'No such track' });
  return res.json({ success: true, track });
});

router.delete('/music/:id', requireAuth, async (req: Request, res: Response) => {
  if (!(await removeTrack(req.params.id)))
    return res.status(404).json({ success: false, error: 'No such track' });
  return res.json({ success: true });
});

/**
 * @openapi
 * /api/highlights/music/{id}/file:
 *   get:
 *     tags: [Highlights]
 *     summary: A track's own file, to listen to in the library (admin)
 *     responses:
 *       200:
 *         description: The audio
 */
router.get('/music/:id/file', requireAuth, async (req: Request, res: Response) => {
  const track = await trackById(req.params.id);
  if (!track || !fs.existsSync(track.file)) return res.status(404).end();
  return res.sendFile(trackFile(track), { headers: { 'Content-Type': 'audio/mpeg' } });
});

/**
 * @openapi
 * /api/highlights/videos/{file}/music/{track}:
 *   get:
 *     tags: [Highlights]
 *     summary: A reel's own mix of a library track, for the player
 *     description: Cut to the reel, evened out and faded; never the track's file. `intro` is where the reel's intro ends (seconds).
 *     responses:
 *       200:
 *         description: The mix (audio/mp4)
 */
router.get('/videos/:file/music/:track', async (req: Request, res: Response) => {
  if (!REEL.test(req.params.file)) return res.status(404).end();
  const video = path.join(HIGHLIGHTS_DIR, req.params.file);
  const track = await trackById(req.params.track);
  if (!track || !fs.existsSync(video)) return res.status(404).end();
  try {
    const mix = await reelMusic(video, track, Number(req.query.intro) || 0);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(mix, { headers: { 'Content-Type': 'audio/mp4' } });
  } catch (error) {
    log.warn("[HIGHLIGHTS] Could not mix a reel's music", {
      error: String(error),
      track: track.id,
    });
    return res.status(502).end();
  }
});

/**
 * @openapi
 * /api/highlights/videos/{file}/download:
 *   get:
 *     tags: [Highlights]
 *     summary: Download a video with its crowd and/or a music track mixed in
 *     description: |
 *       `music` (a track id), `crowd=1`, `intro` (seconds), `level` (the music's
 *       level, 0 to 1), `clean=1` (without the overlay). Mixed once, then kept.
 *     responses:
 *       200:
 *         description: The video
 *       404:
 *         description: No such video, track or crowd track
 */
router.get('/videos/:file/download', async (req: Request, res: Response) => {
  const named = VIDEO.exec(req.params.file);
  if (!named) return res.status(404).end();
  const dressed = path.join(HIGHLIGHTS_DIR, `${named[1]}.mp4`);
  const file = req.query.clean === '1' ? dressed.replace(/\.mp4$/, '.clean.mp4') : dressed;
  if (!fs.existsSync(file)) return res.status(404).end();
  const downloadName =
    file === dressed
      ? path.basename(dressed)
      : path.basename(dressed).replace(/\.mp4$/, '-clean.mp4');
  const music = typeof req.query.music === 'string' ? await trackById(req.query.music) : undefined;
  if (req.query.music !== undefined && !music)
    return res.status(404).json({ success: false, error: 'No such track' });
  const crowd = req.query.crowd === '1' ? dressed.replace(/\.mp4$/, '.crowd.m4a') : null;
  if (crowd && !fs.existsSync(crowd))
    return res.status(404).json({ success: false, error: 'This video has no crowd track' });
  if (!music && !crowd) return res.download(file, downloadName);
  try {
    const mixed = await withSound(file, {
      track: music,
      crowd,
      intro: Number(req.query.intro) || 0,
      level: musicLevel(req.query.level),
    });
    return res.download(mixed, downloadName, {
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (error) {
    log.error('[HIGHLIGHTS] Could not mix sound into a video', {
      error,
      file: req.params.file,
      track: music?.id,
    });
    return res.status(502).json({ success: false, error: 'Could not add the sound' });
  }
});

export default router;
