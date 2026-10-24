import { validRecorderClaim } from '../demos/recorderLeases';
import { db } from '../../../config/database';
import { recorderFleetRouter } from './recorderFleet';
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
 *   GET  /api/game/cs2/library                        every clip and reel: ?sort=new|views|likes&kind=all|clips|reels&player&team&match&tournament&map&page&limit
 *   GET  /api/game/cs2/watch/stats                    ?video=<key>: its views and likes, and whether the viewer liked it
 *   POST /api/game/cs2/watch/view                     { video, browser? }: a view (once per viewer every 12 hours)
 *   PUT  /api/game/cs2/watch/like                     { video, liked }: a signed-in player's like
 *   GET  /api/game/cs2/watch/comments                 ?video=<key>: its comments, oldest first
 *   POST /api/game/cs2/watch/comments                 { video, body }: a signed-in player comments (rate limited)
 *   PUT  /api/game/cs2/watch/comments/:id             { body }: its author edits it
 *   DELETE /api/game/cs2/watch/comments/:id           its author or an admin removes it
 *   GET  /api/game/cs2/watch/related                  ?match&map | ?tournament: the players on that map and more reels
 *   GET  /api/game/cs2/frame-by-frame                 Frame by Frame in the newest recorder report: { status, cs2, checkedAt } or null
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

import { Router } from 'express';
import { requireRecorder } from '../demos/recorderKeys';
import { log } from '../../../utils/logger';
import { recorderLink } from '../demos/recorderLink';

import type { SqlValue } from '../../../config/database';
import { registerRecorderJobRoutes } from './highlightRecorderJobRoutes';
import { registerReelRoutes } from './highlightReelRoutes';
import { registerHighlightReadRoutes } from './highlightReadRoutes';
import { registerRecorderAdminRoutes } from './highlightRecorderAdminRoutes';

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
  let params: SqlValue[] = [];
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

// In this order: Express matches routes in the order they were added.
registerRecorderJobRoutes(router);
registerReelRoutes(router);
registerHighlightReadRoutes(router);
registerRecorderAdminRoutes(router);

export default router;
