/**
 * Highlights (../demos/highlights.ts).
 *
 * For the recorder (`at-worker record`), with an API token:
 *   POST /api/game/cs2/recorder/claim                 a player's moments on one map not yet recorded, or 204
 *   PUT  /api/game/cs2/recorder/jobs/:id/clip         one moment's MP4 (video/mp4 body)
 *   PUT  /api/game/cs2/recorder/reels/:slug/:map/:player  the player's reel of that map (video/mp4 body)
 *   POST /api/game/cs2/recorder/fail                  { ids, error }: it could not record them
 *   PUT  /api/game/cs2/recorder/match-reels/:slug/:map       a map's match reel (video/mp4 body; ?clips=N)
 *   POST /api/game/cs2/recorder/match-reels/:slug/:map/fail  { error }: it could not make it
 *   PUT  /api/game/cs2/recorder/tournament-reels/:id         a tournament's reel (video/mp4 body)
 *   POST /api/game/cs2/recorder/tournament-reels/:id/fail    { error }: it could not make it
 *
 * A clip's upload carries `X-AT-Markers` (JSON: where its kills and slow
 * motion are, in seconds); a reel's carries `X-AT-Clips` (the highlight ids it
 * joins, in order), for the player's scrubber and chapters.
 *
 * Public:
 *   GET  /api/game/cs2/players/:playerId/highlights   a player's reels, highlights and favourite (?all=1: every one)
 *   PUT  /api/game/cs2/players/me/highlights/favourite  { highlightId | null }: the signed-in player picks theirs
 *   GET  /api/game/cs2/tournaments/:id/highlights     a tournament's reel, best plays and match reels
 *   GET  /api/game/cs2/matches/:slug/reels            a match's reels per map
 *   GET  /api/game/cs2/watch/clip/:id                 one highlight to watch
 *   GET  /api/game/cs2/watch/reel/:slug/:map/:player  a player's reel of a map
 *   GET  /api/game/cs2/watch/match/:slug/:map         a map's match reel
 *   GET  /api/game/cs2/watch/tournament/:id           a tournament's reel
 *   GET  /api/game/cs2/highlights/:file               a clip (`<id>.mp4`) or reel (`reel-…`, `match-…`, `tournament-…`), with range requests;
 *                                                     ?music=<track>&intro=<s>: a download with that track mixed in (../demos/music.ts)
 *   GET  /api/game/cs2/music                          the tracks reels play ({ tracks }), and every one there is ({ all })
 *   GET  /api/game/cs2/music/:id.mp3                  one track, with range requests
 */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import {
  claimTournamentReel,
  clipView,
  failTournamentReel,
  favouriteOf,
  matchReelView,
  recordingQueue,
  playerClips,
  playerReelView,
  playerReelViews,
  saveTournamentReel,
  setFavourite,
  tournamentHighlights,
  tournamentReel,
} from '../demos/highlightViews';
import {
  claimMapJob,
  idleRecorderCount,
  recorderBusy,
  claimMatchReel,
  claimRecordJob,
  failMatchReel,
  matchReels,
  saveMatchReel,
  clipFile,
  failRecordJob,
  parseClipIds,
  parseMarkers,
  saveClip,
  saveReel,
} from '../demos/highlights';
import { enabledTracks, trackById, trackFile, withMusic } from '../demos/music';
import { MUSIC_TRACKS } from '../demos/musicTracks';

const router = Router();

const idOf = (req: Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A public read that answers 500 when the database fails, instead of hanging. */
const read =
  (what: string, handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      log.error(`[HIGHLIGHTS] ${what} failed`, { error, path: req.path });
      if (!res.headersSent)
        res.status(500).json({ success: false, error: `Could not read the ${what}` });
    }
  };

router.post('/recorder/claim', requireAuth, async (req: Request, res: Response) => {
  try {
    const recorder = typeof req.body?.recorder === 'string' ? req.body.recorder : 'recorder';
    const idle = idleRecorderCount(recorder);
    const give = (job: unknown) => {
      recorderBusy(recorder);
      return res.json({ success: true, job });
    };
    // A match reel only joins clips already made: hand those out first.
    const reel = await claimMatchReel(recorder);
    if (reel) return give(reel);
    // Then a finished tournament's reel, once all of it is recorded. Older
    // recorders (version < 3) don't know the kind: they only get player jobs.
    if (Number(req.body?.version ?? 0) >= 3) {
      const tournament = await claimTournamentReel(recorder);
      if (tournament) return give(tournament);
    }
    // A recorder from version 4 records a map (or its share of one, when
    // other recorders are idle too) in one CS2 session.
    if (Number(req.body?.version ?? 0) >= 4) {
      const map = await claimMapJob(recorder, idle);
      if (!map) return res.status(204).end();
      return give(map);
    }
    const job = await claimRecordJob(recorder);
    if (!job) return res.status(204).end();
    return give({ kind: 'player', ...job });
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
    const bytes = await saveClip(id, req, parseMarkers(req.headers['x-at-markers']));
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
      const bytes = await saveReel(
        req.params.slug,
        map,
        req.params.player,
        req,
        parseClipIds(req.headers['x-at-clips'])
      );
      return res.json({ success: true, bytes });
    } catch (error) {
      log.error('[HIGHLIGHTS] reel save failed', { error, slug: req.params.slug });
      return res.status(500).json({ success: false, error: 'Could not store the reel' });
    }
  }
);

router.put('/recorder/match-reels/:slug/:map', requireAuth, async (req: Request, res: Response) => {
  const map = Number(req.params.map);
  const clips = Number(req.query.clips ?? 0);
  if (!Number.isInteger(map) || map < 0) {
    return res.status(400).json({ success: false, error: 'A match and map number' });
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body' });
  }
  try {
    const bytes = await saveMatchReel(
      req.params.slug,
      map,
      Number.isInteger(clips) ? clips : 0,
      req,
      parseClipIds(req.headers['x-at-clips'])
    );
    return res.json({ success: true, bytes });
  } catch (error) {
    log.error('[HIGHLIGHTS] match reel save failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not store the match reel' });
  }
});

router.post(
  '/recorder/match-reels/:slug/:map/fail',
  requireAuth,
  async (req: Request, res: Response) => {
    const map = Number(req.params.map);
    if (!Number.isInteger(map) || map < 0)
      return res.status(400).json({ success: false, error: 'A map number' });
    await failMatchReel(
      req.params.slug,
      map,
      typeof req.body?.error === 'string' ? req.body.error : 'unknown'
    );
    return res.json({ success: true });
  }
);

router.get('/matches/:slug/reels', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, reels: await matchReels(req.params.slug) });
  } catch (error) {
    log.error('[HIGHLIGHTS] match reels failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not read the match reels' });
  }
});

router.post('/recorder/fail', requireAuth, async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ success: false, error: 'Highlight ids' });
  await failRecordJob(ids, typeof req.body?.error === 'string' ? req.body.error : 'unknown');
  return res.json({ success: true });
});

router.put('/recorder/tournament-reels/:id', requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req);
  if (!id || !String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
    return res.status(400).json({ success: false, error: 'A tournament id and a video/mp4 body' });
  }
  try {
    const bytes = await saveTournamentReel(id, req, parseClipIds(req.headers['x-at-clips']));
    return res.json({ success: true, bytes });
  } catch (error) {
    log.error('[HIGHLIGHTS] tournament reel save failed', { error, id });
    return res.status(500).json({ success: false, error: 'Could not store the tournament reel' });
  }
});

router.post(
  '/recorder/tournament-reels/:id/fail',
  requireAuth,
  async (req: Request, res: Response) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ success: false, error: 'A tournament id' });
    await failTournamentReel(id, typeof req.body?.error === 'string' ? req.body.error : 'unknown');
    return res.json({ success: true });
  }
);

router.put('/players/me/highlights/favourite', async (req: Request, res: Response) => {
  const viewer = await resolveViewerAccount(req);
  if (!viewer.playerId) return res.status(401).json({ success: false, error: 'Sign in first' });
  if (viewer.isImpersonating) {
    return res
      .status(403)
      .json({ success: false, error: 'Stop impersonating to pick a favourite.' });
  }
  const raw = req.body?.highlightId;
  const highlightId = raw === null ? null : Number(raw);
  if (highlightId !== null && !(Number.isInteger(highlightId) && highlightId > 0)) {
    return res.status(400).json({ success: false, error: 'A highlight id, or null' });
  }
  if (!(await setFavourite(viewer.playerId, highlightId))) {
    return res.status(404).json({ success: false, error: 'Not one of your recorded highlights' });
  }
  return res.json({ success: true, favourite: highlightId });
});

router.get(
  '/players/:playerId/highlights',
  read('highlights', async (req: Request, res: Response) => {
    const all = req.query.all === '1';
    const [reels, highlights, favourite, viewer, queue] = await Promise.all([
      playerReelViews(req.params.playerId, all ? 200 : 12),
      playerClips(req.params.playerId, all ? 300 : 24),
      favouriteOf(req.params.playerId),
      resolveViewerAccount(req),
      recordingQueue(req.params.playerId),
    ]);
    return res.json({
      success: true,
      reels,
      highlights,
      favourite,
      queue,
      isOwn:
        !!viewer.playerId && viewer.playerId === req.params.playerId && !viewer.isImpersonating,
    });
  })
);

router.get(
  '/tournaments/:id/highlights',
  read('tournament highlights', async (req: Request, res: Response) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ success: false, error: 'A tournament id' });
    return res.json({ success: true, ...(await tournamentHighlights(id)) });
  })
);

router.get(
  '/watch/clip/:id',
  read('highlight', async (req: Request, res: Response) => {
    const id = idOf(req);
    const clip = id ? await clipView(id) : null;
    if (!clip || !clip.video)
      return res.status(404).json({ success: false, error: 'No such highlight' });
    return res.json({ success: true, clip });
  })
);

router.get(
  '/watch/reel/:slug/:map/:player',
  read('reel', async (req: Request, res: Response) => {
    const reel = await playerReelView(req.params.slug, Number(req.params.map), req.params.player);
    if (!reel) return res.status(404).json({ success: false, error: 'No such reel' });
    return res.json({ success: true, reel });
  })
);

router.get(
  '/watch/match/:slug/:map',
  read('match reel', async (req: Request, res: Response) => {
    const reel = await matchReelView(req.params.slug, Number(req.params.map));
    if (!reel) return res.status(404).json({ success: false, error: 'No such reel' });
    return res.json({ success: true, reel });
  })
);

router.get(
  '/watch/tournament/:id',
  read('tournament reel', async (req: Request, res: Response) => {
    const id = idOf(req);
    const reel = id ? await tournamentReel(id) : null;
    if (!reel || !reel.video)
      return res.status(404).json({ success: false, error: 'No such reel' });
    return res.json({ success: true, reel: { ...reel, tournamentId: id } });
  })
);

router.get('/highlights/:file', async (req: Request, res: Response) => {
  const clip = /^(\d+)\.mp4$/.exec(req.params.file);
  const reel = /^(?:reel|match|tournament)-[A-Za-z0-9_.-]+\.mp4$/.test(req.params.file);
  if (!clip && !reel) return res.status(404).end();
  const file = clip
    ? clipFile(Number(clip[1]))
    : path.join(path.dirname(clipFile(0)), req.params.file);
  if (!fs.existsSync(file)) return res.status(404).end();
  const music = typeof req.query.music === 'string' ? trackById(req.query.music) : undefined;
  if (req.query.music !== undefined) {
    // A download with music: mixed once (a few seconds), then kept.
    if (!music) return res.status(404).json({ success: false, error: 'No such track' });
    try {
      const mixed = await withMusic(file, music, Number(req.query.intro) || 0);
      return res.download(mixed, path.basename(file), { headers: { 'Cache-Control': 'private, max-age=3600' } });
    } catch (error) {
      log.error('[HIGHLIGHTS] Could not mix music into a video', { error, file: req.params.file, track: music.id });
      return res.status(502).json({ success: false, error: 'Could not add the music' });
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'video/mp4' } });
});

router.get(
  '/music',
  read('music', async (_req: Request, res: Response) => {
    const strip = ({ audio: _audio, ...t }: (typeof MUSIC_TRACKS)[number]) => t;
    return res.json({ success: true, tracks: (await enabledTracks()).map(strip), all: MUSIC_TRACKS.map(strip) });
  })
);

router.get('/music/:file', async (req: Request, res: Response) => {
  const id = /^(\d+)\.mp3$/.exec(req.params.file)?.[1];
  const track = id ? trackById(id) : undefined;
  if (!track) return res.status(404).end();
  try {
    const file = await trackFile(track);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.sendFile(file, { headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (error) {
    log.warn('[HIGHLIGHTS] Could not fetch a music track', { track: track.id, error: String(error) });
    return res.status(502).end();
  }
});

export default router;
