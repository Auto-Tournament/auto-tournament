/** The public highlight reads and files (highlights.ts). */

import fs from 'fs';
import path from 'path';
import { URLSearchParams } from 'url';
import { Router, type Request, type Response } from 'express';
import { checkAdminAccess, requestActorId } from '../../../middleware/auth';
import { frameByFrameStatus } from '../demos/recorders';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import { countView, libraryPage, setLike, videoKey, videoStats } from '../demos/library';
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
  clipView,
  favouriteOf,
  matchReelView,
  watchRelated,
  recordingQueue,
  playerClips,
  playerReelView,
  playerReelViews,
  tournamentHighlights,
  tournamentReel,
} from '../demos/highlightViews';
import { clipFile, TWIN_CONTENT_TYPE, twinFileOf, type VideoTwin } from '../demos/highlights';
import { teamReelView } from '../demos/teamReels';

import type { Untrusted } from '../../../utils/untrusted';
import { idOf, read } from './highlightRouteHelpers';

export function registerHighlightReadRoutes(router: Router): void {
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
    '/frame-by-frame',
    read('Frame by Frame status', async (_req: Request, res: Response) => {
      return res.json({ success: true, frameByFrame: await frameByFrameStatus() });
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
      const str = (v: Untrusted) =>
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
        map: str(q.map),
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
        return res
          .status(403)
          .json({ success: false, error: 'Stop impersonating to like videos.' });
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
      res.setHeader('Cache-Control', 'public, max-age=300');
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
    // A redone clip or reel keeps its name: cached for a day, viewers (and the
    // CDN) kept the old video. Five minutes still spares repeat views.
    res.setHeader('Cache-Control', 'public, max-age=300');
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
}
