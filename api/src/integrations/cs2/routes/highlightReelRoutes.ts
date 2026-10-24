/** Reels, redress and favourites (highlights.ts). */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { requireRecorder } from '../demos/recorderKeys';
import { bodyOf } from '../demos/uploadParts';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import {
  failTournamentReel,
  saveTournamentReel,
  setFavourite,
  tournamentReelFile,
} from '../demos/highlightViews';
import {
  matchReels,
  clipFile,
  failRecordJob,
  parseClipIds,
  matchReelFile,
  reelFile,
  saveTwin,
  saveCut,
  CUT_NAME,
  TWIN_CONTENT_TYPE,
  type VideoTwin,
  SERIES_REEL,
} from '../demos/highlights';
import {
  failRedress,
  queueRedress,
  REDRESS_FILE,
  redressStatus,
  saveRedressed,
} from '../demos/redress';
import { failTeamReel, matchTeamReels, saveTeamReel, teamReelFile } from '../demos/teamReels';

import { recorderFault } from '../demos/recorders';

import type { Untrusted } from '../../../utils/untrusted';
import { idOf, recorderName, startsOf, TWIN } from './highlightRouteHelpers';

export function registerReelRoutes(router: Router): void {
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
      const cut = CUT_NAME.test(req.params.twin);
      const type = cut ? 'video/mp4' : TWIN_CONTENT_TYPE[twin];
      if (!String(req.headers['content-type'] ?? '').startsWith(type)) {
        return res.status(400).json({ success: false, error: `A ${type} body` });
      }
      if (!fs.existsSync(video))
        return res.status(404).json({ success: false, error: 'Upload the video first' });
      try {
        const bytes = cut
          ? await saveCut(video, req.params.twin, bodyOf(req))
          : await saveTwin(video, twin, bodyOf(req));
        return res.json({ success: true, bytes });
      } catch (error) {
        log.error('[HIGHLIGHTS] twin save failed', { error, video: path.basename(video), twin });
        return res.status(500).json({ success: false, error: `Could not store the ${twin} file` });
      }
    };

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
      return Number.isInteger(map) && map >= SERIES_REEL
        ? matchReelFile(req.params.slug, map)
        : null;
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
      ? (req.body.files as Untrusted[]).filter((f): f is string => typeof f === 'string')
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
      ? (req.body.ids as Untrusted[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
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
        return res
          .status(500)
          .json({ success: false, error: 'Could not store the tournament reel' });
      }
    }
  );

  router.post(
    '/recorder/tournament-reels/:id/fail',
    requireRecorder,
    async (req: Request, res: Response) => {
      const id = idOf(req);
      if (!id) return res.status(400).json({ success: false, error: 'A tournament id' });
      await failTournamentReel(
        id,
        typeof req.body?.error === 'string' ? req.body.error : 'unknown'
      );
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
}
