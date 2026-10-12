import {
  recoverRecordingLeases,
  recorderHasActiveClaim,
  registerRecorderClaim,
  validRecorderClaim,
  heartbeatRecorderClaim,
} from '../demos/recorderLeases';
import { db } from '../../../config/database';
import { recorderFleetRouter } from './recorderFleet';
import {
  acknowledgeRecorderUpdate,
  newerRecorderAgent,
  refreshRecorderRelease,
} from '../demos/recorderUpdates';
import { recorderAcceptsWork, requestRecorderUpdate } from '../demos/recorderFleet';
/**
 * Highlights (../demos/highlights.ts).
 *
 * For the recorder (`at-worker record`), with an API token:
 *   POST /api/game/cs2/recorder/claim                 a player's moments on one map not yet recorded, or 204
 *   PUT  /api/game/cs2/recorder/jobs/:id/clip         one moment's MP4 (video/mp4 body)
 *   PUT  /api/game/cs2/recorder/reels/:slug/:map/:player  the player's reel of that map (video/mp4 body)
 *   POST /api/game/cs2/recorder/fail                  { ids, error, fault? }: it could not record them (fault 'recorder': its CS2 would not start; they retry with bounded attempts)
 *   PUT  /api/game/cs2/recorder/match-reels/:slug/:map       a map's match reel (video/mp4 body; ?clips=N)
 *   POST /api/game/cs2/recorder/match-reels/:slug/:map/fail  { error }: it could not make it
 *   PUT  /api/game/cs2/recorder/tournament-reels/:id         a tournament's reel (video/mp4 body)
 *   PUT  /api/game/cs2/recorder/team-reels/:slug/:team       a team's reel of a match (video/mp4 body)
 *   POST /api/game/cs2/recorder/team-reels/:slug/:team/fail  { error }: it could not make it
 *   POST /api/game/cs2/recorder/tournament-reels/:id/fail    { error }: it could not make it
 *   POST /api/game/cs2/recorder/uploads               a file sent in parts: { id } (any PUT above then takes X-AT-Upload: <id> and no body)
 *   PUT  /api/game/cs2/recorder/uploads/:id?offset=N  one part (under 100 MB; 409 with { bytes } when the offset is not where the upload ends)
 *   PUT  …/jobs/:id/clip/<twin>, …/reels/:slug/:map/:player/<twin>, …/match-reels/:slug/:map/<twin>,
 *        …/team-reels/:slug/:team/<twin>, …/tournament-reels/:id/<twin>   after the video: a reel's crowd
 *        track (`crowd`, audio/mp4), the clean twin (`clean`, video/mp4) or the overlay's recipe (`overlay`, JSON)
 *   PUT  /api/game/cs2/recorder/redress/:file          a video dressed again from its clean twin (video/mp4 body);
 *                                                     a clip's carries `X-AT-Start`: where it starts in its twin (no caption card)
 *   POST /api/game/cs2/recorder/redress/:file/fail     { error }: it could not
 *   GET  /api/game/cs2/redress                         admin: the redress queue ({ queued, working, failed, available })
 *   POST /api/game/cs2/redress                         admin: { files? }: dress these (default: every video with a clean twin) again
 *   GET  /api/game/cs2/recorder-keys                   admin: the recorder keys (never the keys themselves)
 *   POST /api/game/cs2/recorder-keys                   admin: { name }: a recorder key, in this answer only
 *   DELETE /api/game/cs2/recorder-keys/:id             admin: revoke it
 *   GET  /api/game/cs2/clips                           admin: recent matches' clips and match reels, what each was made at, which are outdated (?outdated=1)
 *   POST /api/game/cs2/clips/redo                      admin: { clipIds?, matchSlugs?, reels?, outdated? }: make them again
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
 *   GET  /api/game/cs2/library                        every clip and reel: ?sort=new|views|likes&kind=all|clips|reels&player&team&match&tournament&page&limit
 *   GET  /api/game/cs2/watch/stats                    ?video=<key>: its views and likes, and whether the viewer liked it
 *   POST /api/game/cs2/watch/view                     { video, browser? }: a view (once per viewer every 12 hours)
 *   PUT  /api/game/cs2/watch/like                     { video, liked }: a signed-in player's like
 *   GET  /api/game/cs2/watch/comments                 ?video=<key>: its comments, oldest first
 *   POST /api/game/cs2/watch/comments                 { video, body }: a signed-in player comments (rate limited)
 *   PUT  /api/game/cs2/watch/comments/:id             { body }: its author edits it
 *   DELETE /api/game/cs2/watch/comments/:id           its author or an admin removes it
 *   GET  /api/game/cs2/watch/related                  ?match&map | ?tournament: the players on that map and more reels
 *   GET  /api/game/cs2/highlights/:file               a clip (`<id>.mp4`) or reel (`reel-…`, `match-…`, `tournament-…`), with range requests;
 *                                                     ?crowd=1, ?music=<track>&intro=<s>[&level=<0–2>]: a download with its crowd track and/or that music mixed in (../demos/music.ts)
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
import { URLSearchParams } from 'url';
import { Router, type Request, type Response } from 'express';
import { checkAdminAccess, requestActorId, requireAuth } from '../../../middleware/auth';
import {
  createRecorderKey,
  listRecorderKeys,
  requireRecorder,
  revokeRecorderKey,
} from '../demos/recorderKeys';
import { appendPart, bodyOf, startUpload, UploadError } from '../demos/uploadParts';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import { countView, libraryPage, setLike, videoKey, videoStats } from '../demos/library';
import { recorderLink } from '../demos/recorderLink';
import {
  addComment,
  cleanBody,
  COMMENT_MAX,
  commentById,
  deleteComment,
  editComment,
  listComments,
  postLimit,
} from '../demos/comments';
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
  loadedMapOf,
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
  matchReelFile,
  reelFile,
  saveTwin,
  TWIN_CONTENT_TYPE,
  twinFileOf,
  type VideoTwin,
  parseMarkers,
  saveClip,
  saveReel,
  renewClaims,
  queueMatchReelFor,
  SERIES_REEL,
} from '../demos/highlights';
import {
  listClips,
  redo,
  reviewClip,
  type RedoRequest,
  type ReviewVerdict,
} from '../demos/clipsAdmin';
import {
  claimRedress,
  failRedress,
  queueRedress,
  REDRESS_FILE,
  redressStatus,
  saveRedressed,
} from '../demos/redress';
import {
  claimTeamReel,
  failTeamReel,
  matchTeamReels,
  saveTeamReel,
  teamReelFile,
  teamReelView,
} from '../demos/teamReels';

import {
  benchmarkJob,
  wantsBenchmark,
  forgetRecorder,
  setRecorderLabel,
  isPaused,
  recorderFault,
  clipKept,
  listRecorders,
  listRuns,
  RECORDER_QUALITY_VERSION,
  RecorderError,
  recorderSettings,
  requestBenchmark,
  resumeRecorder,
  runLog,
  saveBenchmark,
  saveRun,
  seenRecorder,
} from '../demos/recorders';

import { dropOrphanJobs } from '../demos/jobs';

const router = Router();
// The Recorders page follows changes live instead of polling: any change to
// a recorder, its group, key or job (not heartbeats or upload chunks) tells
// it to read the list again (../demos/recorderLink.ts).
router.use((req, res, next) => {
  if (
    req.method !== 'GET' &&
    /^\/(recorder|recorders|recorder-groups|recorder-keys|clips|redress)(\/|$)/.test(req.path) &&
    !/\/(heartbeat|uploads)(\/|$)/.test(req.path)
  ) {
    res.on('finish', () => {
      if (res.statusCode < 400) recorderLink.changed();
    });
  }
  next();
});
router.use(recorderFleetRouter);

// Updated workers identify writes, so a late upload/failure cannot change a
// claim another machine owns. Old recorder binaries remain compatible.
router.use('/recorder', requireRecorder, async (req, res, next) => {
  const recorder = req.header('X-AT-Recorder');
  if (!recorder || !['PUT', 'POST'].includes(req.method)) return next();
  if (typeof req.body?.recorder === 'string' && req.body.recorder.slice(0, 120) !== recorder)
    return res.status(400).json({ error: 'Recorder header and body must agree' });
  const claim = req.header('X-AT-Claim');
  if (claim && !['/claim', '/update', '/runs'].includes(req.path)) {
    try {
      if (!(await validRecorderClaim(recorder, claim)))
        return res.status(409).json({ error: 'Recorder claim expired or was replaced' });
    } catch (error) {
      log.error('[RECORDER] claim check failed', { error });
      return res.status(500).json({ error: 'Could not check recorder claim' });
    }
  }
  const clip = /^\/jobs\/(\d+)(?:\/|$)/.exec(req.path);
  const reel = /^\/(match-reels|team-reels)\/([^/]+)\/([^/]+)/.exec(req.path);
  const tournament = /^\/tournament-reels\/(\d+)/.exec(req.path);
  let sql = '';
  let params: unknown[] = [];
  if (clip) {
    sql = 'SELECT 1 FROM cs2_highlights WHERE id = ? AND recorder = ?';
    params = [Number(clip[1]), recorder];
  } else if (reel) {
    if (reel[1] === 'match-reels' && !Number.isInteger(Number(reel[3]))) return next();
    const table = reel[1] === 'match-reels' ? 'cs2_match_reels' : 'cs2_team_reels';
    const column = reel[1] === 'match-reels' ? 'map_number' : 'team_id';
    sql = `SELECT 1 FROM ${table} WHERE match_slug = ? AND ${column} = ? AND recorder = ?`;
    params = [decodeURIComponent(reel[2]), reel[3], recorder];
  } else if (tournament) {
    sql = 'SELECT 1 FROM cs2_tournament_reels WHERE tournament_id = ? AND recorder = ?';
    params = [Number(tournament[1]), recorder];
  } else if (req.path === '/fail' && Array.isArray(req.body?.ids) && req.body.ids.length) {
    const ids = req.body.ids.map(Number);
    if (ids.some((id: number) => !Number.isSafeInteger(id) || id <= 0)) return next();
    sql = `SELECT 1 FROM cs2_highlights WHERE id IN (${ids.map(() => '?').join(', ')}) AND recorder IS DISTINCT FROM ? LIMIT 1`;
    params = [...ids, recorder];
  }
  if (!sql) return next();
  try {
    const found = await db.queryOneAsync(sql, params);
    const belongs = req.path === '/fail' ? !found : !!found;
    if (!belongs)
      return res
        .status(409)
        .json({ success: false, error: 'This job is owned by another recorder' });
    return next();
  } catch (error) {
    log.error('[HIGHLIGHTS] recorder ownership check failed', { error });
    return res.status(500).json({ success: false, error: 'Could not check the recorder claim' });
  }
});

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

router.post('/recorder/hello', requireRecorder, async (req, res) => {
  const { name, hostname, hostId, agentVersion, image, revision } = req.body ?? {};
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 120 ||
    typeof hostname !== 'string' ||
    !hostname.trim() ||
    hostname.length > 120 ||
    typeof hostId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(hostId) ||
    typeof agentVersion !== 'string' ||
    agentVersion.length > 80 ||
    (image != null &&
      (typeof image !== 'string' ||
        !/^sivertio\/auto-tournament-recorder@sha256:[0-9a-f]{64}$/.test(image))) ||
    (revision != null && (typeof revision !== 'string' || revision.length > 80))
  )
    return res.status(400).json({ error: 'A hostname, machine ID and agent version are required' });
  try {
    const existing = await db.queryOneAsync<{ name: string }>(
      'SELECT name FROM cs2_recorders WHERE host_id = ?',
      [hostId]
    );
    if (existing) {
      await db.runAsync(
        'UPDATE cs2_recorders SET host_name = ?, agent_version = ?, recorder_image = COALESCE(?, recorder_image), recorder_revision = COALESCE(?, recorder_revision), agent_seen = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE host_id = ?',
        [hostname, agentVersion, image ?? null, revision ?? null, hostId]
      );
      return res.json({ success: true, name: existing.name });
    }
    const row = await db.queryOneAsync<{ name: string }>(
      `INSERT INTO cs2_recorders (name, enabled, host_id, host_name, agent_version, recorder_image, recorder_revision, agent_seen) VALUES (?, 0, ?, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
      ON CONFLICT (name) DO UPDATE SET host_id = EXCLUDED.host_id, host_name = EXCLUDED.host_name, agent_version = EXCLUDED.agent_version, recorder_image = COALESCE(EXCLUDED.recorder_image, cs2_recorders.recorder_image), recorder_revision = COALESCE(EXCLUDED.recorder_revision, cs2_recorders.recorder_revision), agent_seen = EXCLUDED.agent_seen
      WHERE cs2_recorders.host_id IS NULL OR cs2_recorders.host_id = EXCLUDED.host_id RETURNING name`,
      [name, hostId, hostname, agentVersion, image ?? null, revision ?? null]
    );
    if (!row)
      return res.status(409).json({ error: 'This recorder name belongs to another installation' });
    return res.json({ success: true, name: row.name });
  } catch (error) {
    log.error('[RECORDER] hello failed', { error });
    return res.status(500).json({ error: 'Could not register recorder host' });
  }
});

/** Protocol 1 updates carry a durable request ID; stale acknowledgements cannot finish a newer request. */
router.get('/recorder/update', requireRecorder, async (req, res) => {
  const name = req.header('X-AT-Recorder');
  if (!name) return res.status(400).json({ error: 'Recorder name required' });
  try {
    const protocol = req.query.protocol === '1' ? 1 : 0;
    await db.runAsync(
      'UPDATE cs2_recorders SET update_agent_seen = EXTRACT(EPOCH FROM NOW())::INTEGER, update_protocol = ? WHERE name = ?',
      [protocol, name]
    );
    const row = await db.queryOneAsync<{
      update_status: string;
      update_target: string | null;
      update_id: string | null;
      update_agent_version: string | null;
      update_agent_url: string | null;
      update_agent_sha: string | null;
      busy: boolean;
    }>(
      `SELECT update_status, update_target, update_id, update_agent_version, update_agent_url, update_agent_sha, EXISTS (SELECT 1 FROM cs2_recorder_claims WHERE recorder = r.name) AS busy FROM cs2_recorders r WHERE name = ?`,
      [name]
    );
    return res.json({
      status: row?.update_status ?? 'current',
      image: row?.update_target ?? null,
      id: row?.update_id ?? null,
      busy: row?.busy ?? false,
      agentVersion: row?.update_agent_version ?? null,
      agentURL: row?.update_agent_url ?? null,
      agentSHA: row?.update_agent_sha ?? null,
    });
  } catch (error) {
    log.error('[RECORDER UPDATE] poll failed', { error });
    return res.status(500).json({ error: 'Could not read update request' });
  }
});
router.post('/recorder/update', requireRecorder, async (req, res) => {
  const name = req.header('X-AT-Recorder');
  const { status, id, image, revision, agentVersion, error: updateError } = req.body ?? {};
  if (!name || !['check', 'updating', 'current', 'failed'].includes(status))
    return res.status(400).json({ error: 'Valid recorder and update status required' });
  if (
    image != null &&
    (typeof image !== 'string' ||
      !/^sivertio\/auto-tournament-recorder@sha256:[0-9a-f]{64}$/.test(image))
  )
    return res.status(400).json({ error: 'Official recorder image digest required' });
  try {
    if (status === 'check') {
      await db.runAsync(
        `UPDATE cs2_recorders SET recorder_image = ?, recorder_revision = ?, update_agent_seen = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE name = ?`,
        [image ?? null, typeof revision === 'string' ? revision.slice(0, 80) : null, name]
      );
      return res.json({ success: true });
    }
    if (id != null && (typeof id !== 'string' || id.length > 80))
      return res.status(400).json({ error: 'Update request ID required' });
    const accepted = await acknowledgeRecorderUpdate(name, {
      id: typeof id === 'string' ? id : '',
      status,
      image,
      revision,
      agentVersion,
      error: updateError,
    });
    if (!accepted)
      return res
        .status(409)
        .json({ error: 'Stale request or installed image differs from the requested build' });
    // The Recorders page follows the update live: its step while it runs
    // (draining, pulling, restarting, checking), the result when done.
    const step = req.body?.step;
    recorderLink.updateProgress(
      name,
      status === 'updating' && typeof step === 'string' && /^[a-z-]{1,24}$/.test(step)
        ? step
        : null,
      status
    );
    return res.json({ success: true });
  } catch (error) {
    log.error('[RECORDER UPDATE] acknowledgement failed', { error });
    return res.status(500).json({ error: 'Could not save update result' });
  }
});

/**
 * What a host's own `at-recorder update --check` asks: whether a newer
 * recorder image or host agent is out for it, and whether the platform can
 * update it (a host agent with managed updates seen in the last 5 minutes).
 */
router.get('/recorder/update/available', requireRecorder, async (req, res) => {
  const name = req.header('X-AT-Recorder');
  if (!name) return res.status(400).json({ error: 'Recorder name required' });
  try {
    await refreshRecorderRelease();
    const row = await db.queryOneAsync<{
      recorder_image: string | null;
      latest_image: string | null;
      agent_version: string | null;
      latest_agent_version: string | null;
      update_status: string | null;
      update_error: string | null;
      managed: boolean;
    }>(
      `SELECT recorder_image, latest_image, agent_version, latest_agent_version, update_status, update_error,
              (update_protocol = 1 AND update_agent_seen > EXTRACT(EPOCH FROM NOW()) - 300) AS managed
         FROM cs2_recorders WHERE name = ?`,
      [name]
    );
    if (!row) return res.status(404).json({ error: 'No such recorder' });
    return res.json({
      success: true,
      managed: row.managed === true,
      status: row.update_status ?? 'current',
      error: row.update_error,
      image: {
        installed: row.recorder_image,
        latest: row.latest_image,
        newer: !!(
          row.latest_image &&
          row.recorder_image &&
          row.latest_image !== row.recorder_image
        ),
      },
      agent: {
        installed: row.agent_version,
        latest: row.latest_agent_version,
        newer: newerRecorderAgent(row.latest_agent_version, row.agent_version),
      },
    });
  } catch (error) {
    log.error('[RECORDER UPDATE] availability failed', { error });
    return res.status(500).json({ error: 'Could not check for updates' });
  }
});

/**
 * A host's own `at-recorder update`: the same request as the platform's
 * Update button (pinned release, drained before it runs, rolled back when it
 * fails). `queued` is 0 when nothing is newer, it is already queued or the
 * host agent cannot take managed updates.
 */
router.post('/recorder/update/request', requireRecorder, async (req, res) => {
  const name = req.header('X-AT-Recorder');
  if (!name) return res.status(400).json({ error: 'Recorder name required' });
  try {
    return res.json({ success: true, queued: await requestRecorderUpdate(name) });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) return res.status(404).json({ error: 'No such recorder' });
    log.error('[RECORDER UPDATE] self request failed', { error });
    return res.status(500).json({ error: 'Could not request the update' });
  }
});

router.post('/recorder/complete', requireRecorder, async (req, res) => {
  const recorder = req.header('X-AT-Recorder'),
    token = req.header('X-AT-Claim');
  if (!recorder || !token) return res.status(400).json({ error: 'Recorder claim required' });
  try {
    await db.runAsync('DELETE FROM cs2_recorder_claims WHERE recorder = ? AND token = ?', [
      recorder,
      token,
    ]);
    return res.json({ success: true });
  } catch (error) {
    log.error('[RECORDER] completion failed', { error });
    return res.status(500).json({ error: 'Could not complete claim' });
  }
});

// Serialize claims from duplicate processes on one host, including benchmarks.
const claimLock = async (req: Request, res: Response, next: import('express').NextFunction) => {
  const name =
    typeof req.body?.recorder === 'string' ? req.body.recorder.slice(0, 120) : 'recorder';
  try {
    await db.withClient(async (client) => {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 125)) AS locked',
        [name]
      );
      if (!result.rows[0].locked) {
        res.status(204).end();
        return;
      }
      try {
        await new Promise<void>((resolve) => {
          res.once('finish', resolve);
          res.once('close', resolve);
          next();
        });
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 125))', [name]);
      }
    });
  } catch (error) {
    log.error('[RECORDER] claim lock failed', { error });
    if (!res.headersSent) res.status(500).json({ error: 'Could not lock recorder' });
  }
};
router.post('/recorder/claim', requireRecorder, claimLock, async (req: Request, res: Response) => {
  try {
    const recorder = typeof req.body?.recorder === 'string' ? req.body.recorder : 'recorder';
    const version = Number(req.body?.version ?? 0);
    const me = await seenRecorder(recorder, {
      version,
      gpu: req.body?.gpu,
      platform: req.body?.platform,
    });
    await queueMatchReelFor(await recoverRecordingLeases());
    if (await recorderHasActiveClaim(recorder)) return res.status(204).end();
    // Paused after too many turned-down clips (demos/recorders.ts).
    if (isPaused(me) || !(await recorderAcceptsWork(recorder))) return res.status(204).end();
    // Here but not ready (CS2 still installing): it shows up, no work.
    if (typeof req.body?.notReady === 'string') return res.status(204).end();
    // Moments of a deleted match can't be recorded (demos/jobs.ts).
    await dropOrphanJobs();
    idleRecorderCount(recorder);
    const settings = recorderSettings(me);
    const give = async (job: unknown) => {
      recorderBusy(recorder);
      return res.json({
        success: true,
        claimToken: version >= 8 ? await registerRecorderClaim(recorder) : undefined,
        job: job && typeof job === 'object' ? { ...(job as object), settings } : job,
      });
    };
    // A new recorder (or one an admin asked) measures itself first.
    // One that carries the shipped benchmark demo measures itself on it once.
    const benchDemo = req.body?.benchDemo === true;
    if (version >= RECORDER_QUALITY_VERSION && wantsBenchmark(me, benchDemo)) {
      const benchmark = await benchmarkJob(benchDemo);
      if (benchmark) return await give(benchmark);
    }
    // A match reel only joins clips already made: hand those out first.
    const reel = await claimMatchReel(recorder);
    if (reel) return await give(reel);
    // Then a finished tournament's reel, once all of it is recorded. Older
    // recorders (version < 3) don't know the kind: they only get player jobs.
    if (Number(req.body?.version ?? 0) >= 3) {
      const tournament = await claimTournamentReel(recorder);
      if (tournament) return await give(tournament);
    }
    // Team reels from recorder version 5.
    if (Number(req.body?.version ?? 0) >= 5) {
      const team = await claimTeamReel(recorder);
      if (team) return await give(team);
    }
    // A recorder from version 4 records a map's players one at a time in
    // the CS2 session it keeps (demos/highlights.ts claimMapJob).
    if (Number(req.body?.version ?? 0) >= 4) {
      // The map whose demo it has loaded, to go on with (the worker's liveGame).
      const map = await claimMapJob(recorder, loadedMapOf(req.body?.loaded));
      if (map) return await give(map);
      // Nothing to record: overlays to draw again (recorder version 6).
      if (Number(req.body?.version ?? 0) >= 6) {
        const redress = await claimRedress(recorder);
        if (redress) return await give(redress);
      }
      return res.status(204).end();
    }
    const job = await claimRecordJob(recorder);
    if (!job) return res.status(204).end();
    return await give({ kind: 'player', ...job });
  } catch (error) {
    log.error('[HIGHLIGHTS] claim failed', { error });
    return res.status(500).json({ success: false, error: 'Could not hand out a highlight' });
  }
});

// A file sent in parts (../demos/uploadParts.ts): Cloudflare turns down bodies over 100 MB.
router.post('/recorder/uploads', requireRecorder, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, id: await startUpload() });
  } catch (error) {
    log.error('[HIGHLIGHTS] upload start failed', { error });
    return res.status(500).json({ success: false, error: 'Could not start the upload' });
  }
});

router.put('/recorder/uploads/:id', requireRecorder, async (req: Request, res: Response) => {
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return res.status(400).json({ success: false, error: 'An offset' });
  }
  try {
    return res.json({ success: true, bytes: await appendPart(req.params.id, offset, req) });
  } catch (error) {
    if (error instanceof UploadError) {
      req.resume();
      return res
        .status(error.status)
        .json({ success: false, error: error.message, bytes: error.bytes });
    }
    log.error('[HIGHLIGHTS] upload part failed', { error });
    return res.status(500).json({ success: false, error: 'Could not store the part' });
  }
});

router.put('/recorder/jobs/:id/clip', requireRecorder, async (req: Request, res: Response) => {
  const id = idOf(req);
  if (!id || !String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body for a highlight' });
  }
  try {
    await clipKept(id);
    const seconds = Number(req.headers['x-at-seconds']);
    const bytes = await saveClip(
      id,
      bodyOf(req),
      parseMarkers(req.headers['x-at-markers']),
      Number.isFinite(seconds) && seconds > 0 && seconds < 86_400
        ? Math.round(seconds * 10) / 10
        : null
    );
    return res.json({ success: true, bytes });
  } catch (error) {
    log.error('[HIGHLIGHTS] clip save failed', { error, id });
    return res.status(500).json({ success: false, error: 'Could not store the clip' });
  }
});

router.put(
  '/recorder/reels/:slug/:map/:player',
  requireRecorder,
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
        bodyOf(req),
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

router.put(
  '/recorder/match-reels/:slug/:map',
  requireRecorder,
  async (req: Request, res: Response) => {
    const map = Number(req.params.map);
    const clips = Number(req.query.clips ?? 0);
    if (!Number.isInteger(map) || map < SERIES_REEL) {
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
        bodyOf(req),
        ids,
        startsOf(req, ids)
      );
      return res.json({ success: true, bytes });
    } catch (error) {
      log.error('[HIGHLIGHTS] match reel save failed', { error, slug: req.params.slug });
      return res.status(500).json({ success: false, error: 'Could not store the match reel' });
    }
  }
);

router.post(
  '/recorder/match-reels/:slug/:map/fail',
  requireRecorder,
  async (req: Request, res: Response) => {
    const map = Number(req.params.map);
    if (!Number.isInteger(map) || map < SERIES_REEL)
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
      return res.json({ success: true, bytes: await saveTwin(video, twin, bodyOf(req)) });
    } catch (error) {
      log.error('[HIGHLIGHTS] twin save failed', { error, video: path.basename(video), twin });
      return res.status(500).json({ success: false, error: `Could not store the ${twin} file` });
    }
  };

const TWIN = ':twin(crowd|clean|overlay)';

router.put(
  `/recorder/jobs/:id/clip/${TWIN}`,
  requireRecorder,
  twinUpload((req) => {
    const id = idOf(req);
    return id ? clipFile(id) : null;
  })
);
router.put(
  `/recorder/reels/:slug/:map/:player/${TWIN}`,
  requireRecorder,
  twinUpload((req) => {
    const map = Number(req.params.map);
    return Number.isInteger(map) && map >= 0 && /^\d{1,20}$/.test(req.params.player)
      ? reelFile(req.params.slug, map, req.params.player)
      : null;
  })
);
router.put(
  `/recorder/match-reels/:slug/:map/${TWIN}`,
  requireRecorder,
  twinUpload((req) => {
    const map = Number(req.params.map);
    return Number.isInteger(map) && map >= SERIES_REEL ? matchReelFile(req.params.slug, map) : null;
  })
);
router.put(
  `/recorder/team-reels/:slug/:team/${TWIN}`,
  requireRecorder,
  twinUpload((req) => teamReelFile(req.params.slug, req.params.team))
);
router.put(
  `/recorder/tournament-reels/:id/${TWIN}`,
  requireRecorder,
  twinUpload((req) => {
    const id = idOf(req);
    return id ? tournamentReelFile(id) : null;
  })
);

router.put(
  '/recorder/team-reels/:slug/:team',
  requireRecorder,
  async (req: Request, res: Response) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
      return res.status(400).json({ success: false, error: 'A video/mp4 body' });
    }
    try {
      const ids = parseClipIds(req.headers['x-at-clips']);
      const bytes = await saveTeamReel(
        req.params.slug,
        req.params.team,
        bodyOf(req),
        ids,
        startsOf(req, ids)
      );
      return res.json({ success: true, bytes });
    } catch (error) {
      log.error('[HIGHLIGHTS] team reel save failed', { error, slug: req.params.slug });
      return res.status(500).json({ success: false, error: 'Could not store the team reel' });
    }
  }
);

router.post(
  '/recorder/team-reels/:slug/:team/fail',
  requireRecorder,
  async (req: Request, res: Response) => {
    await failTeamReel(
      req.params.slug,
      req.params.team,
      typeof req.body?.error === 'string' ? req.body.error : 'unknown'
    );
    return res.json({ success: true });
  }
);

router.put('/recorder/redress/:file', requireRecorder, async (req: Request, res: Response) => {
  if (
    !REDRESS_FILE.test(req.params.file) ||
    !String(req.headers['content-type'] ?? '').startsWith('video/mp4')
  ) {
    return res.status(400).json({ success: false, error: 'A video/mp4 body for a clip or reel' });
  }
  try {
    // A clip dressed to be watched on its own says where it starts in its clean twin.
    const start = Number(req.headers['x-at-start']);
    const at =
      req.headers['x-at-start'] !== undefined && Number.isFinite(start) && start >= 0
        ? start
        : null;
    return res.json({
      success: true,
      bytes: await saveRedressed(req.params.file, bodyOf(req), at),
    });
  } catch (error) {
    log.error('[HIGHLIGHTS] redressed video save failed', { error, file: req.params.file });
    return res.status(500).json({ success: false, error: 'Could not store the video' });
  }
});

router.post(
  '/recorder/redress/:file/fail',
  requireRecorder,
  async (req: Request, res: Response) => {
    if (!REDRESS_FILE.test(req.params.file))
      return res.status(400).json({ success: false, error: 'A clip or reel' });
    await failRedress(
      req.params.file,
      typeof req.body?.error === 'string' ? req.body.error : 'unknown'
    );
    return res.json({ success: true });
  }
);

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

router.post('/recorder/fail', requireRecorder, async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ success: false, error: 'Highlight ids' });
  const error = typeof req.body?.error === 'string' ? req.body.error : 'unknown';
  // The recorder's CS2 would not start: not the moments' fault.
  if (req.body?.fault === 'recorder') await recorderFault(recorderName(req), ids, error);
  else await failRecordJob(ids, error);
  return res.json({ success: true });
});

router.put(
  '/recorder/tournament-reels/:id',
  requireRecorder,
  async (req: Request, res: Response) => {
    const id = idOf(req);
    if (!id || !String(req.headers['content-type'] ?? '').startsWith('video/mp4')) {
      return res
        .status(400)
        .json({ success: false, error: 'A tournament id and a video/mp4 body' });
    }
    try {
      const ids = parseClipIds(req.headers['x-at-clips']);
      const bytes = await saveTournamentReel(id, bodyOf(req), ids, startsOf(req, ids));
      return res.json({ success: true, bytes });
    } catch (error) {
      log.error('[HIGHLIGHTS] tournament reel save failed', { error, id });
      return res.status(500).json({ success: false, error: 'Could not store the tournament reel' });
    }
  }
);

router.post(
  '/recorder/tournament-reels/:id/fail',
  requireRecorder,
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

// The highlights library (../demos/library.ts): every clip and reel, sorted and filtered.
router.get(
  '/library',
  read('library', async (req: Request, res: Response) => {
    const q = req.query;
    const str = (v: unknown) =>
      typeof v === 'string' && v.trim() && v.length <= 200 ? v : undefined;
    const sort = q.sort === 'views' || q.sort === 'likes' ? q.sort : 'new';
    const kind = q.kind === 'clips' || q.kind === 'reels' ? q.kind : 'all';
    const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
    const limit = Math.max(1, Math.min(48, Number(q.limit) || 24));
    const tournament = Number(q.tournament);
    const viewer = await resolveViewerAccount(req);
    const { items, total } = await libraryPage({
      sort,
      kind,
      player: str(q.player),
      team: str(q.team),
      match: str(q.match),
      tournament: Number.isInteger(tournament) && tournament > 0 ? tournament : undefined,
      page,
      limit,
      viewer: viewer.playerId,
    });
    return res.json({ success: true, items, total, page, limit });
  })
);

// One video's views and likes (`?video=clip/185`), and whether the viewer liked it.
router.get(
  '/watch/stats',
  read('video stats', async (req: Request, res: Response) => {
    const key = videoKey(req.query.video);
    if (!key) return res.status(400).json({ success: false, error: 'Which video?' });
    const viewer = await resolveViewerAccount(req);
    return res.json({ success: true, ...(await videoStats(key, viewer.playerId)) });
  })
);

// A view: { video, browser? } (browser: the anonymous viewer's own id).
router.post(
  '/watch/view',
  read('view', async (req: Request, res: Response) => {
    const key = videoKey(req.body?.video);
    if (!key) return res.status(400).json({ success: false, error: 'Which video?' });
    const viewer = await resolveViewerAccount(req);
    const browser = req.body?.browser;
    const who = viewer.playerId
      ? viewer.playerId
      : typeof browser === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(browser)
        ? `anon:${browser}`
        : null;
    if (!who) return res.status(400).json({ success: false, error: 'Who is watching?' });
    const counted = await countView(key, who);
    return res.json({ success: true, counted });
  })
);

// A signed-in player's like: { video, liked }.
router.put(
  '/watch/like',
  read('like', async (req: Request, res: Response) => {
    const key = videoKey(req.body?.video);
    if (!key || typeof req.body?.liked !== 'boolean')
      return res.status(400).json({ success: false, error: '{ video, liked }' });
    const viewer = await resolveViewerAccount(req);
    if (!viewer.playerId) return res.status(401).json({ success: false, error: 'Sign in first' });
    if (viewer.isImpersonating)
      return res.status(403).json({ success: false, error: 'Stop impersonating to like videos.' });
    await setLike(key, viewer.playerId, req.body.liked);
    return res.json({ success: true, ...(await videoStats(key, viewer.playerId)) });
  })
);

// Comments on a video (../demos/comments.ts).
router.get(
  '/watch/comments',
  read('comments', async (req: Request, res: Response) => {
    const key = videoKey(req.query.video);
    if (!key) return res.status(400).json({ success: false, error: 'Which video?' });
    return res.json({ success: true, comments: await listComments(key) });
  })
);

router.post(
  '/watch/comments',
  read('comment', async (req: Request, res: Response) => {
    const key = videoKey(req.body?.video);
    const body = cleanBody(req.body?.body);
    if (!key || !body)
      return res
        .status(400)
        .json({ success: false, error: `{ video, body } (at most ${COMMENT_MAX} characters)` });
    const viewer = await resolveViewerAccount(req);
    if (!viewer.playerId) return res.status(401).json({ success: false, error: 'Sign in first' });
    if (viewer.isImpersonating)
      return res.status(403).json({ success: false, error: 'Stop impersonating to comment.' });
    const limit = await postLimit(viewer.playerId);
    if (limit)
      return res.status(429).json({
        success: false,
        error: limit === 'slow' ? 'Wait a few seconds' : 'Too many comments this hour',
      });
    return res.json({ success: true, comment: await addComment(key, viewer.playerId, body) });
  })
);

router.put(
  '/watch/comments/:id',
  read('comment', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = cleanBody(req.body?.body);
    if (!Number.isInteger(id) || !body)
      return res.status(400).json({ success: false, error: '{ body }' });
    const viewer = await resolveViewerAccount(req);
    const comment = await commentById(id);
    if (!comment) return res.status(404).json({ success: false, error: 'No such comment' });
    if (!viewer.playerId || viewer.isImpersonating || comment.playerId !== viewer.playerId)
      return res.status(403).json({ success: false, error: 'Only its author can edit it' });
    return res.json({ success: true, comment: await editComment(id, body) });
  })
);

router.delete(
  '/watch/comments/:id',
  read('comment', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ success: false, error: 'Which comment?' });
    const comment = await commentById(id);
    if (!comment) return res.status(404).json({ success: false, error: 'No such comment' });
    const viewer = await resolveViewerAccount(req);
    const own =
      !!viewer.playerId && !viewer.isImpersonating && comment.playerId === viewer.playerId;
    const admin = !own && (await checkAdminAccess(req)).ok;
    if (!own && !admin)
      return res
        .status(403)
        .json({ success: false, error: 'Only its author or an admin can delete it' });
    await deleteComment(id, own ? viewer.playerId! : `admin:${requestActorId(req) ?? 'admin'}`);
    return res.json({ success: true });
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
  // With its crowd and/or music: core mixes it (routes/highlights.ts, shared by
  // every game's highlights).
  if (req.query.music !== undefined || req.query.crowd !== undefined) {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    return res.redirect(
      307,
      `/api/highlights/videos/${encodeURIComponent(path.basename(dressed))}/download?${query}`
    );
  }
  if (req.query.clean === '1') return res.download(file, downloadName);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'video/mp4' } });
});

// A reel's own mix of a library track: core makes it (routes/highlights.ts).
router.get('/highlights/:file/music/:track', (req: Request, res: Response) => {
  const query = new URLSearchParams(req.query as Record<string, string>).toString();
  return res.redirect(
    307,
    `/api/highlights/videos/${encodeURIComponent(req.params.file)}/music/${encodeURIComponent(req.params.track)}${query ? `?${query}` : ''}`
  );
});

const recorderName = (req: Request): string =>
  typeof req.body?.recorder === 'string' && req.body.recorder ? req.body.recorder : 'recorder';

function recorderFail(res: Response, error: unknown, what: string): Response {
  if (error instanceof RecorderError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  log.error(`[RECORDERS] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `Could not ${what}` });
}

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
    await saveRun(recorderName(req), (req.body ?? {}) as Record<string, unknown>);
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
    const picked = await saveBenchmark(recorderName(req), (req.body ?? {}) as { tries?: unknown });
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

export default router;
