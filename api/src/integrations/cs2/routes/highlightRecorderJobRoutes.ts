/** The recorder protocol: hello, updates, claims, uploads and finished clips (highlights.ts). */
import {
  recoverRecordingLeases,
  recorderHasActiveClaim,
  registerRecorderClaim,
} from '../demos/recorderLeases';
import { db } from '../../../config/database';
import {
  acknowledgeRecorderUpdate,
  newerRecorderAgent,
  refreshRecorderRelease,
} from '../demos/recorderUpdates';
import { recorderAcceptsWork, requestRecorderUpdate } from '../demos/recorderFleet';

import { Router, type Request, type Response } from 'express';
import { requireRecorder } from '../demos/recorderKeys';
import { appendPart, bodyOf, startUpload, UploadError } from '../demos/uploadParts';
import { log } from '../../../utils/logger';
import { recorderLink } from '../demos/recorderLink';
import { claimTournamentReel } from '../demos/highlightViews';
import {
  claimMapJob,
  loadedMapOf,
  idleRecorderCount,
  recorderBusy,
  claimMatchReel,
  claimRecordJob,
  failMatchReel,
  saveMatchReel,
  parseClipIds,
  parseMarkers,
  saveClip,
  saveReel,
  queueMatchReelFor,
  SERIES_REEL,
} from '../demos/highlights';
import { claimRedress } from '../demos/redress';
import { claimTeamReel } from '../demos/teamReels';

import {
  isPaused,
  clipKept,
  RECORDER_QUALITY_VERSION,
  recorderSettings,
  seenRecorder,
} from '../demos/recorders';
import { benchmarkJob, wantsBenchmark } from '../demos/recorderBenchmark';

import { dropOrphanJobs } from '../demos/jobs';
import { claimLock, idOf, startsOf } from './highlightRouteHelpers';

export function registerRecorderJobRoutes(router: Router): void {
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
      return res
        .status(400)
        .json({ error: 'A hostname, machine ID and agent version are required' });
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
        return res
          .status(409)
          .json({ error: 'This recorder name belongs to another installation' });
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

  router.post(
    '/recorder/claim',
    requireRecorder,
    claimLock,
    async (req: Request, res: Response) => {
      try {
        const recorder = typeof req.body?.recorder === 'string' ? req.body.recorder : 'recorder';
        const version = Number(req.body?.version ?? 0);
        const me = await seenRecorder(
          recorder,
          { version, gpu: req.body?.gpu, platform: req.body?.platform },
          (res.locals.recorderKey as { name?: string } | undefined)?.name
        );
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
        const give = async (job: object) => {
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
    }
  );

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
}
