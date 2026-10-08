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
 *   PUT  /api/game/cs2/recorder/team-reels/:slug/:team       a team's reel of a match (video/mp4 body)
 *   POST /api/game/cs2/recorder/team-reels/:slug/:team/fail  { error }: it could not make it
 *   POST /api/game/cs2/recorder/tournament-reels/:id/fail    { error }: it could not make it
 *   PUT  …/jobs/:id/clip/<twin>, …/reels/:slug/:map/:player/<twin>, …/match-reels/:slug/:map/<twin>,
 *        …/team-reels/:slug/:team/<twin>, …/tournament-reels/:id/<twin>   after the video: a reel's crowd
 *        track (`crowd`, audio/mp4), the clean twin (`clean`, video/mp4) or the overlay's recipe (`overlay`, JSON)
 *   PUT  /api/game/cs2/recorder/redress/:file          a video dressed again from its clean twin (video/mp4 body)
 *   POST /api/game/cs2/recorder/redress/:file/fail     { error }: it could not
 *   GET  /api/game/cs2/redress                         admin: the redress queue ({ queued, working, failed, available })
 *   POST /api/game/cs2/redress                         admin: { files? }: dress these (default: every video with a clean twin) again
 *
 * A clip's upload carries `X-AT-Markers` (JSON: where its kills and slow
 * motion are, in seconds); a reel's carries `X-AT-Clips` (the highlight ids it
 * joins, in order) and `X-AT-Starts` (where each starts in it, in seconds),
 * for the player's scrubber and chapters.
 *
 * Public:
 *   GET  /api/game/cs2/players/:playerId/highlights   a player's reels, highlights and favourite (?all=1: every one)
 *   PUT  /api/game/cs2/players/me/highlights/favourite  { highlightId | null }: the signed-in player picks theirs
 *   GET  /api/game/cs2/tournaments/:id/highlights     a tournament's reel, best plays and match reels
 *   GET  /api/game/cs2/matches/:slug/reels            a match's reels per map, and its team reels (`teams`)
 *   GET  /api/game/cs2/watch/clip/:id                 one highlight to watch
 *   GET  /api/game/cs2/watch/reel/:slug/:map/:player  a player's reel of a map
 *   GET  /api/game/cs2/watch/match/:slug/:map         a map's match reel
 *   GET  /api/game/cs2/watch/tournament/:id           a tournament's reel
 *   GET  /api/game/cs2/watch/team/:slug/:team         a team's reel of a match
 *   GET  /api/game/cs2/watch/related                  ?match&map | ?tournament: the players on that map and more reels
 *   GET  /api/game/cs2/highlights/:file               a clip (`<id>.mp4`) or reel (`reel-…`, `match-…`, `tournament-…`), with range requests;
 *                                                     ?crowd=1, ?music=<track>&intro=<s>: a download with its crowd track and/or that music mixed in (../demos/music.ts)
 *                                                     ?clean=1: its clean twin instead (as recorded: no card, kill feed or logo)
 *                                                     `<video>.clean.mp4`: the clean twin; `<reel>.crowd.m4a`: a reel's crowd track;
 *                                                     `<video>.overlay.json`: the overlay's recipe
 *   GET  /api/game/cs2/highlights/:reel/music/:track  a reel's own mix of a library track (?intro=<s>), for the player
 *   GET  /api/game/cs2/music                          the tracks reels play ({ tracks }), the whole library ({ all }), and where to find more ({ suggestions })
 *   POST /api/game/cs2/music                          admin: add a track (the audio as the body; ?title&artist&genre&source&contentId)
 *   POST /api/game/cs2/music/from-link                admin: { url, title, artist, genre, source, contentId }: add a track the server downloads
 *   PUT  /api/game/cs2/music/:id                      admin: { title, artist, genre, source, contentId }
 *   DELETE /api/game/cs2/music/:id                    admin: remove a track
 *   GET  /api/game/cs2/music/:id/file                 admin: the track's own file
 */

import fs from 'fs';
import path from 'path';
import express, { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import {
  claimTournamentReel,
  clipView,
  failTournamentReel,
  favouriteOf,
  matchReelView,
  watchRelated,
  recordingQueue,
  playerClips,
  playerReelView,
  playerReelViews,
  saveTournamentReel,
  setFavourite,
  tournamentHighlights,
  tournamentReel,
  tournamentReelFile,
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
  parseClipStarts,
  crowdFileOf,
  matchReelFile,
  reelFile,
  saveTwin,
  TWIN_CONTENT_TYPE,
  twinFileOf,
  type VideoTwin,
  parseMarkers,
  saveClip,
  saveReel,
} from '../demos/highlights';
import {
  claimRedress,
  failRedress,
  queueRedress,
  REDRESS_FILE,
  redressStatus,
  saveRedressed,
} from '../demos/redress';
import {
  addTrack,
  allTracks,
  enabledTracks,
  fetchTrack,
  MUSIC_MAX_BYTES,
  MusicUploadError,
  reelMusic,
  removeTrack,
  trackById,
  trackFile,
  updateTrack,
  withSound,
} from '../demos/music';
import {
  claimTeamReel,
  failTeamReel,
  matchTeamReels,
  saveTeamReel,
  teamReelFile,
  teamReelView,
} from '../demos/teamReels';
import { MUSIC_SUGGESTIONS } from '../demos/musicSuggestions';

const router = Router();

const idOf = (req: Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A reel upload's `X-AT-Starts`, one per clip of its `X-AT-Clips`. */
const startsOf = (req: Request, ids: number[] | null) =>
  ids ? parseClipStarts(req.headers['x-at-starts'], ids.length) : null;

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
    // Team reels from recorder version 5.
    if (Number(req.body?.version ?? 0) >= 5) {
      const team = await claimTeamReel(recorder);
      if (team) return give(team);
    }
    // A recorder from version 4 records a map (or its share of one, when
    // other recorders are idle too) in one CS2 session.
    if (Number(req.body?.version ?? 0) >= 4) {
      const map = await claimMapJob(recorder, idle);
      if (map) return give(map);
      // Nothing to record: overlays to draw again (recorder version 6).
      if (Number(req.body?.version ?? 0) >= 6) {
        const redress = await claimRedress();
        if (redress) return give(redress);
      }
      return res.status(204).end();
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
      const ids = parseClipIds(req.headers['x-at-clips']);
      const bytes = await saveReel(
        req.params.slug,
        map,
        req.params.player,
        req,
        ids,
        startsOf(req, ids)
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
    const ids = parseClipIds(req.headers['x-at-clips']);
    const bytes = await saveMatchReel(
      req.params.slug,
      map,
      Number.isInteger(clips) ? clips : 0,
      req,
      ids,
      startsOf(req, ids)
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
    const [reels, teams] = await Promise.all([
      matchReels(req.params.slug),
      matchTeamReels(req.params.slug),
    ]);
    return res.json({ success: true, reels, teams });
  } catch (error) {
    log.error('[HIGHLIGHTS] match reels failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not read the match reels' });
  }
});

/**
 * A video's twins, after the video itself (demos/highlights.ts VideoTwin): a
 * reel's crowd track (the player plays it beside it), the clean twin and the
 * overlay's recipe.
 */
const twinUpload =
  (fileOf: (req: Request) => string | null) => async (req: Request, res: Response) => {
    const video = fileOf(req);
    if (!video) return res.status(400).json({ success: false, error: 'Which video' });
    const twin = req.params.twin as VideoTwin;
    if (!String(req.headers['content-type'] ?? '').startsWith(TWIN_CONTENT_TYPE[twin])) {
      return res.status(400).json({ success: false, error: `A ${TWIN_CONTENT_TYPE[twin]} body` });
    }
    if (!fs.existsSync(video))
      return res.status(404).json({ success: false, error: 'Upload the video first' });
    try {
      return res.json({ success: true, bytes: await saveTwin(video, twin, req) });
    } catch (error) {
      log.error('[HIGHLIGHTS] twin save failed', { error, video: path.basename(video), twin });
      return res.status(500).json({ success: false, error: `Could not store the ${twin} file` });
    }
  };

const TWIN = ':twin(crowd|clean|overlay)';

router.put(
  `/recorder/jobs/:id/clip/${TWIN}`,
  requireAuth,
  twinUpload((req) => {
    const id = idOf(req);
    return id ? clipFile(id) : null;
  })
);
router.put(
  `/recorder/reels/:slug/:map/:player/${TWIN}`,
  requireAuth,
  twinUpload((req) => {
    const map = Number(req.params.map);
    return Number.isInteger(map) && map >= 0 && /^\d{1,20}$/.test(req.params.player)
      ? reelFile(req.params.slug, map, req.params.player)
      : null;
  })
);
router.put(
  `/recorder/match-reels/:slug/:map/${TWIN}`,
  requireAuth,
  twinUpload((req) => {
    const map = Number(req.params.map);
    return Number.isInteger(map) && map >= 0 ? matchReelFile(req.params.slug, map) : null;
  })
);
router.put(
  `/recorder/team-reels/:slug/:team/${TWIN}`,
  requireAuth,
  twinUpload((req) => teamReelFile(req.params.slug, req.params.team))
);
router.put(
  `/recorder/tournament-reels/:id/${TWIN}`,
  requireAuth,
  twinUpload((req) => {
    const id = idOf(req);
    return id ? tournamentReelFile(id) : null;
  })
);

router.put('/recorder/team-reels/:slug/:team', requireAuth, async (req: Request, res: Response) => {
  if (!String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body' });
  }
  try {
    const ids = parseClipIds(req.headers['x-at-clips']);
    const bytes = await saveTeamReel(
      req.params.slug,
      req.params.team,
      req,
      ids,
      startsOf(req, ids)
    );
    return res.json({ success: true, bytes });
  } catch (error) {
    log.error('[HIGHLIGHTS] team reel save failed', { error, slug: req.params.slug });
    return res.status(500).json({ success: false, error: 'Could not store the team reel' });
  }
});

router.post(
  '/recorder/team-reels/:slug/:team/fail',
  requireAuth,
  async (req: Request, res: Response) => {
    await failTeamReel(
      req.params.slug,
      req.params.team,
      typeof req.body?.error === 'string' ? req.body.error : 'unknown'
    );
    return res.json({ success: true });
  }
);

router.put('/recorder/redress/:file', requireAuth, async (req: Request, res: Response) => {
  if (
    !REDRESS_FILE.test(req.params.file) ||
    !String(req.headers['content-type'] ?? '').startsWith('video/mp4')
  ) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body for a clip or reel' });
  }
  try {
    return res.json({ success: true, bytes: await saveRedressed(req.params.file, req) });
  } catch (error) {
    log.error('[HIGHLIGHTS] redressed video save failed', { error, file: req.params.file });
    return res.status(500).json({ success: false, error: 'Could not store the video' });
  }
});

router.post('/recorder/redress/:file/fail', requireAuth, async (req: Request, res: Response) => {
  if (!REDRESS_FILE.test(req.params.file))
    return res.status(400).json({ success: false, error: 'A clip or reel' });
  await failRedress(
    req.params.file,
    typeof req.body?.error === 'string' ? req.body.error : 'unknown'
  );
  return res.json({ success: true });
});

// Admin: how the redress stands, and queue it (every video with a clean twin, or `files`).
router.get('/redress', requireAuth, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, ...(await redressStatus()) });
  } catch (error) {
    log.error('[HIGHLIGHTS] redress status failed', { error });
    return res.status(500).json({ success: false, error: 'Could not read the redress queue' });
  }
});

router.post('/redress', requireAuth, async (req: Request, res: Response) => {
  const files = Array.isArray(req.body?.files)
    ? (req.body.files as unknown[]).filter((f): f is string => typeof f === 'string')
    : undefined;
  try {
    return res.json({ success: true, queued: await queueRedress(files) });
  } catch (error) {
    log.error('[HIGHLIGHTS] redress queue failed', { error });
    return res.status(500).json({ success: false, error: 'Could not queue the redress' });
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
    const ids = parseClipIds(req.headers['x-at-clips']);
    const bytes = await saveTournamentReel(id, req, ids, startsOf(req, ids));
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

router.get(
  '/watch/team/:slug/:team',
  read('team reel', async (req: Request, res: Response) => {
    const reel = await teamReelView(req.params.slug, req.params.team);
    if (!reel) return res.status(404).json({ success: false, error: 'No such reel' });
    return res.json({ success: true, reel });
  })
);

router.get(
  '/watch/related',
  read('related reels', async (req: Request, res: Response) => {
    const match = typeof req.query.match === 'string' && req.query.match ? req.query.match : null;
    const map = req.query.map === undefined ? null : Number(req.query.map);
    const tournament = req.query.tournament === undefined ? null : Number(req.query.tournament);
    if (map !== null && !(Number.isInteger(map) && map >= 0))
      return res.status(400).json({ success: false, error: 'A map number' });
    if (tournament !== null && !(Number.isInteger(tournament) && tournament > 0))
      return res.status(400).json({ success: false, error: 'A tournament id' });
    if (!match && tournament === null)
      return res.status(400).json({ success: false, error: 'A match or a tournament' });
    return res.json({ success: true, ...(await watchRelated(match, map, tournament)) });
  })
);

router.get('/highlights/:file', async (req: Request, res: Response) => {
  const twinOf =
    /^(\d+|(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?)\.(crowd|overlay)\.(?:m4a|json)$/.exec(
      req.params.file
    );
  if (twinOf) {
    // A reel's crowd track (played beside it), or a video's overlay recipe.
    const twin = path.join(path.dirname(clipFile(0)), req.params.file);
    if (!fs.existsSync(twin)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(twin, {
      headers: { 'Content-Type': TWIN_CONTENT_TYPE[twinOf[2] as VideoTwin] },
    });
  }
  // A video, or its clean twin (as recorded: no caption card, kill feed or logo).
  const named =
    /^(\d+|(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?)(\.clean)?\.mp4$/.exec(
      req.params.file
    );
  if (!named) return res.status(404).end();
  const dressed = /^\d+$/.test(named[1]!)
    ? clipFile(Number(named[1]))
    : path.join(path.dirname(clipFile(0)), `${named[1]}.mp4`);
  // ?clean=1 on a download: the same video without the overlay.
  const file = named[2] || req.query.clean === '1' ? twinFileOf(dressed, 'clean') : dressed;
  if (!fs.existsSync(file)) return res.status(404).end();
  const downloadName =
    file === dressed
      ? path.basename(dressed)
      : path.basename(dressed).replace(/\.mp4$/, '-clean.mp4');
  const music = typeof req.query.music === 'string' ? await trackById(req.query.music) : undefined;
  const crowd = req.query.crowd === '1' ? crowdFileOf(dressed) : null;
  if (req.query.music !== undefined || req.query.crowd !== undefined) {
    // A download with its crowd and/or music: mixed once (a few seconds), then kept.
    if (req.query.music !== undefined && !music)
      return res.status(404).json({ success: false, error: 'No such track' });
    if (crowd && !fs.existsSync(crowd))
      return res.status(404).json({ success: false, error: 'This video has no crowd track' });
    if (!music && !crowd) return res.download(file, downloadName);
    try {
      const mixed = await withSound(file, {
        track: music,
        crowd,
        intro: Number(req.query.intro) || 0,
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
  }
  if (req.query.clean === '1') return res.download(file, downloadName);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'video/mp4' } });
});

// A reel's own mix of a library track, for the player (never the track's file).
router.get('/highlights/:file/music/:track', async (req: Request, res: Response) => {
  if (!/^(?:reel|match|tournament|team)-[A-Za-z0-9_.-]+\.mp4$/.test(req.params.file))
    return res.status(404).end();
  const video = path.join(path.dirname(clipFile(0)), req.params.file);
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

router.get(
  '/music',
  read('music', async (_req: Request, res: Response) => {
    const [tracks, all] = await Promise.all([enabledTracks(), allTracks()]);
    return res.json({ success: true, tracks, all, suggestions: MUSIC_SUGGESTIONS });
  })
);

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

// An admin adds a track they have the rights to (the audio file as the body).
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

// An admin adds a track from a link to its audio file (the server downloads it).
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

// The track's own file, for the admin's library (listening before picking).
router.get('/music/:id/file', requireAuth, async (req: Request, res: Response) => {
  const track = await trackById(req.params.id);
  if (!track || !fs.existsSync(track.file)) return res.status(404).end();
  return res.sendFile(trackFile(track), { headers: { 'Content-Type': 'audio/mpeg' } });
});

export default router;
