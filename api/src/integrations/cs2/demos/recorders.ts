import {
  refreshRecorderRelease,
  newerRecorderAgent,
  expireRecorderUpdateRequests,
} from './recorderUpdates';
import { recordingFailureSql } from './recorderLeases';
/**
 * The highlight recorders as the platform sees them: who they are, how fast
 * and how fast they record, and a run log of every job.
 *
 * - Every claim updates the recorder's row (version, GPU, platform, last seen).
 * - Every clip a recorder uploads is kept (clipKept). There is no frame check:
 *   stutter comes from other work on the recorder's GPU, and the setup says
 *   not to run any. A recorder whose CS2 will not start gets no work for
 *   PAUSE_SECONDS (recorderFault); an admin can resume it sooner.
 * - A new recorder (and one an admin asks) first runs a benchmark: the same
 *   moment at each refresh rate in BENCHMARK_HZ, timed. It
 *   keeps the fastest one that finished, which comes back with every job after.
 * - Each job's log and timings land in cs2_recorder_runs for the Recorders page.
 */
import { db } from '../../../config/database';
import { recorderLink, wakeRecorders } from './recorderLink';
import { log } from '../../../utils/logger';
import { queueMatchReelFor } from './highlights';
import type { StoredBenchmark } from './recorderBenchmark';
import type { Untrusted } from '../../../utils/untrusted';

export const PAUSE_SECONDS = 15 * 60;
/** Jobs in a row whose CS2 would not start before the recorder is paused. */
export const FAULT_PAUSE_AFTER = 2;
export const BENCHMARK_HZ = [240, 120];
/** The recorder version that runs benchmarks and sends run logs. */
export const RECORDER_QUALITY_VERSION = 7;
const RUNS_KEPT = 200; // per recorder
const LOG_MAX = 200_000;

const now = () => Math.floor(Date.now() / 1000);

export class RecorderError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface RecorderRow {
  name: string;
  enabled: number;
  group_id: number | null;
  update_status: string;
  update_error: string | null;
  updated_at: number | null;
  update_requested_at?: number | null;
  host_name: string | null;
  host_id: string | null;
  agent_version: string | null;
  update_agent_seen: number | null;
  update_protocol: number | null;
  latest_agent_version: string | null;
  recorder_image: string | null;
  latest_image: string | null;
  recorder_revision: string | null;
  group_name?: string | null;
  group_enabled?: number;
  version: number | null;
  gpu: string | null;
  platform: string | null;
  first_seen: number;
  last_seen: number | null;
  paused_until: number | null;
  pause_reason: string | null;
  rejects_in_row: number;
  clips_ok: number;
  clips_rejected: number;
  benchmark: string | null;
  benchmark_at: number | null;
  benchmark_wanted: number;
  gamescope_hz: number | null;
  fbf_status?: string | null;
  fbf_cs2?: string | null;
  fbf_checked_at?: number | null;
}

const text = (v: Untrusted, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** New recorders get their numbered labels one at a time (two joining at once took the same). */
let labelling: Promise<void> = Promise.resolve();

/**
 * The label a new recorder gets from its key: `<key name>-<n>`, the next number after the
 * highest one in use, so one key pasted on a farm names it renderfarm-1, -2, ... in the order
 * they join. Rename them in the list afterwards.
 */
async function nextKeyLabel(keyName: string): Promise<string> {
  const base = keyName.trim().slice(0, 70);
  const rows = await db.queryAsync<{ label: string | null }>(
    'SELECT label FROM cs2_recorders WHERE label LIKE ?',
    [`${base.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`]
  );
  let max = 0;
  for (const r of rows) {
    const m = r.label?.slice(base.length).match(/^-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}-${max + 1}`;
}

/**
 * A claim: note the recorder and what it runs on. A recorder seen for the first time with a
 * recorder key gets a numbered label from the key's name (`keyName`).
 */
export async function seenRecorder(
  name: string,
  info: { version?: Untrusted; gpu?: Untrusted; platform?: Untrusted },
  keyName?: string | null
): Promise<RecorderRow> {
  // Keys made before the dialog asked for a name are called key-<date>: no numbering for those.
  if (keyName && !/^key-\d{4}-/.test(keyName)) {
    const job = labelling.then(async () => {
      const known = await db.queryOneAsync('SELECT 1 AS x FROM cs2_recorders WHERE name = ?', [
        name.slice(0, 120),
      ]);
      if (known) return;
      await db.runAsync(
        'INSERT INTO cs2_recorders (name, label, last_seen) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
        [name.slice(0, 120), await nextKeyLabel(keyName), now()]
      );
    });
    labelling = job.catch(() => undefined);
    await job.catch((error: unknown) => {
      log.warn(`[RECORDER] naming ${name} after its key failed: ${(error as Error).message}`);
    });
  }
  const version = Number.isInteger(Number(info.version)) ? Number(info.version) : null;
  const row = await db.queryOneAsync<RecorderRow>(
    `INSERT INTO cs2_recorders (name, version, gpu, platform, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET
       version = EXCLUDED.version,
       gpu = COALESCE(EXCLUDED.gpu, cs2_recorders.gpu),
       platform = COALESCE(EXCLUDED.platform, cs2_recorders.platform),
       last_seen = EXCLUDED.last_seen
     RETURNING *`,
    [name.slice(0, 120), version, text(info.gpu, 200), text(info.platform, 120), now()]
  );
  return row!;
}

export function isPaused(row: RecorderRow): boolean {
  return row.paused_until != null && Number(row.paused_until) > now();
}

/** What the recorder should record with (the benchmark's pick), sent with every job. */
export function recorderSettings(row: RecorderRow): { gamescopeHz?: number } {
  return row.gamescope_hz ? { gamescopeHz: Number(row.gamescope_hz) } : {};
}

/** A clip its recorder uploaded was kept: the recorder's streaks start over. */
export async function clipKept(highlightId: number): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_recorders SET clips_ok = clips_ok + 1, rejects_in_row = 0, faults_in_row = 0
      WHERE name = (SELECT recorder FROM cs2_highlights WHERE id = ?)`,
    [highlightId]
  );
}

/** A finished job's log and timings. */
export async function saveRun(name: string, body: Record<string, Untrusted>): Promise<void> {
  const kind = text(body.kind, 40) ?? 'unknown';
  const num = (v: Untrusted) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const logText = typeof body.log === 'string' ? body.log.slice(-LOG_MAX) : null;
  await db.runAsync(
    `INSERT INTO cs2_recorder_runs (recorder, kind, match_slug, map_number, started_at, seconds, ok, clips, rejected, failed, error, log)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name.slice(0, 120),
      kind,
      text(body.matchSlug, 120),
      num(body.mapNumber),
      num(body.startedAt) ?? now(),
      num(body.seconds),
      body.ok === true ? 1 : 0,
      num(body.clips) ?? 0,
      num(body.rejected) ?? 0,
      num(body.failed) ?? 0,
      text(body.error, 2000),
      logText,
    ]
  );
  // Frame by Frame's state in the CS2 it ran (worker/runlog.go), for the Recorders tab.
  if (body.fbf === 'actions' || body.fbf === 'movie' || body.fbf === 'off') {
    await db.runAsync(
      'UPDATE cs2_recorders SET fbf_status = ?, fbf_cs2 = ?, fbf_checked_at = ? WHERE name = ?',
      [body.fbf, text(body.cs2, 40), now(), name.slice(0, 120)]
    );
  }
  // Keep the newest runs per recorder.
  await db.runAsync(
    `DELETE FROM cs2_recorder_runs WHERE recorder = ? AND id NOT IN (
       SELECT id FROM cs2_recorder_runs WHERE recorder = ? ORDER BY id DESC LIMIT ?)`,
    [name.slice(0, 120), name.slice(0, 120), RUNS_KEPT]
  );
}

/** The Recorders page: every recorder with its numbers. */
export async function listRecorders() {
  await expireRecorderUpdateRequests();
  await refreshRecorderRelease();
  const rows = await db.queryAsync<
    RecorderRow & {
      runs: number;
      avg_clip_seconds: number | null;
      last_error: string | null;
      last_run_ok: number | null;
      working_player: string | null;
      working_clips: number | null;
      working_match: string | null;
      working_map: number | null;
      working_since: number | null;
    }
  >(
    `SELECT r.*, g.name AS group_name, COALESCE(g.enabled, 1) AS group_enabled,
            (SELECT COUNT(*)::int FROM cs2_recorder_runs x WHERE x.recorder = r.name) AS runs,
            (SELECT SUM(x.seconds) / NULLIF(SUM(x.clips), 0) FROM cs2_recorder_runs x
              WHERE x.recorder = r.name AND x.kind = 'map' AND x.ok = 1 AND x.clips > 0) AS avg_clip_seconds,
            -- Only while its latest run is the one that failed: a later good run clears it.
            (SELECT x.error FROM cs2_recorder_runs x WHERE x.recorder = r.name
              ORDER BY x.id DESC LIMIT 1) AS last_error,
            (SELECT x.ok FROM cs2_recorder_runs x WHERE x.recorder = r.name
              ORDER BY x.id DESC LIMIT 1) AS last_run_ok,
            -- What it is recording right now (a map job can take hours, with no
            -- word from it until it is done).
            (SELECT p.name FROM players p WHERE p.id = w.player_id) AS working_player, w.clips AS working_clips, w.match_slug AS working_match, w.map_number AS working_map, w.since AS working_since
       FROM cs2_recorders r
       LEFT JOIN cs2_recorder_groups g ON g.id = r.group_id
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS clips, MIN(h.match_slug) AS match_slug, MIN(h.map_number) AS map_number,
                                 MIN(h.claimed_at) AS since, MIN(h.player_id) AS player_id
                            FROM cs2_highlights h
                           WHERE h.recorder = r.name AND h.status = 'recording'
                           HAVING COUNT(*) > 0) w ON TRUE
      ORDER BY r.last_seen DESC NULLS LAST`,
    []
  );
  const t = now();
  const linked = recorderLink.linked();
  return rows.map((r) => {
    let benchmark: StoredBenchmark | null = null;
    try {
      benchmark = r.benchmark ? (JSON.parse(r.benchmark) as StoredBenchmark) : null;
    } catch {
      benchmark = null;
    }
    const paused = isPaused(r);
    return {
      name: r.name,
      enabled: Number(r.enabled) === 1,
      effectiveEnabled: Number(r.enabled) === 1 && Number(r.group_enabled) === 1,
      groupId: r.group_id == null ? null : Number(r.group_id),
      groupName: r.group_name ?? null,
      label: (r as RecorderRow & { label?: string | null }).label ?? null,
      version: r.version,
      gpu: r.gpu,
      platform: r.platform,
      firstSeen: Number(r.first_seen),
      lastSeen: r.last_seen ? Number(r.last_seen) : null,
      // Busy with a job counts as online, however long since it last asked;
      // so does a live link (./recorderLink.ts).
      online:
        linked.has(r.name) ||
        (!!r.last_seen && t - Number(r.last_seen) < 15 * 60) ||
        Number(r.working_clips ?? 0) > 0,
      // The live link: the platform pushes work to it, and it says what it is doing.
      linked: linked.has(r.name),
      progress: recorderLink.progressOf(r.name),
      working:
        Number(r.working_clips ?? 0) > 0
          ? {
              clips: Number(r.working_clips),
              playerName: r.working_player,
              matchSlug: r.working_match,
              mapNumber: Number(r.working_map),
              since: Number(r.working_since),
            }
          : null,
      paused,
      pausedUntil: paused ? Number(r.paused_until) : null,
      pauseReason: paused ? r.pause_reason : null,
      clipsOk: Number(r.clips_ok),
      benchmark,
      benchmarkAt: r.benchmark_at ? Number(r.benchmark_at) : null,
      benchmarkWanted: Number(r.benchmark_wanted) === 1,
      gamescopeHz: r.gamescope_hz,
      runs: Number(r.runs),
      avgClipSeconds: r.avg_clip_seconds != null ? Number(r.avg_clip_seconds) : null,
      hostname: r.host_name ?? r.name,
      hostId: r.host_id,
      agentVersion: r.agent_version,
      latestAgentVersion: r.latest_agent_version,
      updateSupported:
        r.update_protocol === 1 &&
        r.update_agent_seen != null &&
        Number(r.update_agent_seen) > now() - 300,
      updateAvailable:
        (!!r.latest_image && !!r.recorder_image && r.latest_image !== r.recorder_image) ||
        newerRecorderAgent(r.latest_agent_version, r.agent_version),
      recorderImage: r.recorder_image,
      latestImage: r.latest_image,
      recorderRevision: r.recorder_revision,
      updateStatus: r.update_status,
      updateError: r.update_error,
      updatedAt: r.updated_at,
      /** When its last update was asked for: Update all's progress counts the recorders asked together. */
      updateRequestedAt: r.update_requested_at != null ? Number(r.update_requested_at) : null,
      lastError: r.last_error,
      lastRunFailed: r.last_run_ok === 0,
      /** Frame by Frame in the last CS2 it ran: "actions" is all on; "movie" (frame actions
       * off: slower) and "off" (no movie commands: the stream) mean a CS2 update broke it. */
      frameByFrame: r.fbf_status
        ? {
            status: r.fbf_status,
            cs2: r.fbf_cs2 ?? null,
            checkedAt: r.fbf_checked_at != null ? Number(r.fbf_checked_at) : null,
          }
        : null,
    };
  });
}

/**
 * Frame by Frame in the newest recorder report (saveRun): whether a recent CS2
 * still runs it, for the website's compatibility page. Null before any report.
 */
export async function frameByFrameStatus() {
  const row = await db.queryOneAsync<{
    fbf_status: string;
    fbf_cs2: string | null;
    fbf_checked_at: number;
  }>(
    `SELECT fbf_status, fbf_cs2, fbf_checked_at FROM cs2_recorders
      WHERE fbf_status IS NOT NULL ORDER BY fbf_checked_at DESC LIMIT 1`,
    []
  );
  return row
    ? { status: row.fbf_status, cs2: row.fbf_cs2, checkedAt: Number(row.fbf_checked_at) }
    : null;
}

/** A recorder's recent runs, newest first (without their logs). */
export async function listRuns(name: string, limit = 50) {
  const rows = await db.queryAsync<{
    id: number;
    kind: string;
    match_slug: string | null;
    map_number: number | null;
    started_at: number;
    seconds: number | null;
    ok: number;
    clips: number;
    rejected: number;
    failed: number | null;
    error: string | null;
  }>(
    `SELECT id, kind, match_slug, map_number, started_at, seconds, ok, clips, rejected, failed, error
       FROM cs2_recorder_runs WHERE recorder = ? ORDER BY id DESC LIMIT ?`,
    [name, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    matchSlug: r.match_slug,
    mapNumber: r.map_number,
    startedAt: Number(r.started_at),
    seconds: r.seconds != null ? Number(r.seconds) : null,
    ok: Number(r.ok) === 1,
    clips: Number(r.clips),
    rejected: Number(r.rejected),
    failed: Number(r.failed ?? 0),
    error: r.error,
  }));
}

export async function runLog(id: number): Promise<string> {
  const row = await db.queryOneAsync<{ log: string | null }>(
    'SELECT log FROM cs2_recorder_runs WHERE id = ?',
    [id]
  );
  if (!row) throw new RecorderError(404, 'No run with that id');
  return row.log ?? '';
}

async function existing(name: string): Promise<void> {
  const row = await db.queryOneAsync<{ name: string }>(
    'SELECT name FROM cs2_recorders WHERE name = ?',
    [name]
  );
  if (!row) throw new RecorderError(404, 'No recorder with that name');
}

export async function resumeRecorder(name: string): Promise<void> {
  await existing(name);
  await db.runAsync(
    'UPDATE cs2_recorders SET paused_until = NULL, pause_reason = NULL, rejects_in_row = 0 WHERE name = ?',
    [name]
  );
}

export async function requestBenchmark(name: string): Promise<void> {
  await existing(name);
  await db.runAsync('UPDATE cs2_recorders SET benchmark_wanted = 1 WHERE name = ?', [name]);
  wakeRecorders();
}

export async function forgetRecorder(name: string): Promise<void> {
  await existing(name);
  await db.runAsync('DELETE FROM cs2_recorder_runs WHERE recorder = ?', [name]);
  await db.runAsync('DELETE FROM cs2_recorders WHERE name = ?', [name]);
}

/** The name an admin gives a recorder on the Recorders tab (null: its own name). */
export async function setRecorderLabel(name: string, label: string | null): Promise<boolean> {
  const res = await db.runAsync('UPDATE cs2_recorders SET label = ? WHERE name = ?', [
    label ? label.slice(0, 80) : null,
    name,
  ]);
  return res.changes > 0;
}

/**
 * A job the recorder gave back because its CS2 would not start (or died and
 * would not start again): the recorder's fault, not the moments'. They go back
 * to waiting with one retry reserved for their recorder,
 * and a recorder that does this twice in a row is paused, so a broken one
 * stops taking (and failing) every job (2026-10-09: the EWC import's 78 clips
 * failed in ten minutes on one desktop).
 */
export async function recorderFault(recorder: string, ids: number[], error: string): Promise<void> {
  if (ids.length > 0) {
    await db.runAsync(
      `UPDATE cs2_highlights SET ${recordingFailureSql}
        WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'recording'`,
      [error.slice(0, 500), ...ids]
    );
  }
  // A demo that never ticks on two different recorders does not play in this CS2 build (the
  // March LAN demos, 2026-10-15: every recorder tried each map three to five times). Its map's
  // waiting moments fail for good instead of going round the recorders again.
  if (/first tick/i.test(error) && ids.length > 0) {
    const maps = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `SELECT DISTINCT match_slug, map_number FROM cs2_highlights WHERE id IN (${ids
        .map(() => '?')
        .join(', ')})`,
      ids
    );
    for (const m of maps) {
      const before = await db.queryAsync<{ recorder: string }>(
        `SELECT DISTINCT recorder FROM cs2_recorder_runs
          WHERE match_slug = ? AND map_number = ? AND error ILIKE '%first tick%'`,
        [m.match_slug, m.map_number]
      );
      const recorders = new Set([...before.map((r) => r.recorder), recorder]);
      if (recorders.size < 2) continue;
      const gone = await db.runAsync(
        `UPDATE cs2_highlights SET status = CASE WHEN clip_path IS NOT NULL THEN 'done' ELSE 'failed' END,
                error = 'This demo does not play in the current CS2 build (it never reached its first tick on two recorders)'
          WHERE match_slug = ? AND map_number = ? AND status IN ('pending', 'recording')`,
        [m.match_slug, m.map_number]
      );
      if (gone.changes > 0) {
        log.warn(
          `[RECORDERS] ${m.match_slug} map ${m.map_number + 1}: the demo does not play in this CS2 build; ${gone.changes} moment(s) failed`
        );
      }
    }
  }
  await queueMatchReelFor(ids);
  // An imported demo that never ticks is usually from an older CS2 build the
  // current game cannot play: the demo's fault, so it fails its own moments
  // but does not pause the recorder (2026-10-15: old LAN demos paused every
  // recorder while a live tournament needed them).
  if (/first tick/i.test(error) && ids.length > 0) {
    const imported = await db.queryOneAsync<{ n: number }>(
      `SELECT COUNT(*)::INTEGER AS n FROM cs2_highlights h LEFT JOIN matches m ON m.slug = h.match_slug
        WHERE h.id IN (${ids.map(() => '?').join(', ')}) AND m.tournament_id IS NULL`,
      ids
    );
    if (Number(imported?.n ?? 0) === ids.length) {
      log.warn(`[RECORDERS] ${recorder} could not play an imported demo: ${error.slice(0, 200)}`);
      return;
    }
  }
  const r = await db.queryOneAsync<{ faults_in_row: number }>(
    `UPDATE cs2_recorders SET faults_in_row = faults_in_row + 1 WHERE name = ? RETURNING faults_in_row`,
    [recorder]
  );
  log.warn(`[RECORDERS] ${recorder} gave back ${ids.length} moment(s): ${error.slice(0, 200)}`);
  if (r && Number(r.faults_in_row) >= FAULT_PAUSE_AFTER) {
    const reason = `CS2 would not start for ${r.faults_in_row} jobs in a row: ${error.slice(0, 200)}`;
    await db.runAsync(
      'UPDATE cs2_recorders SET paused_until = ?, pause_reason = ?, faults_in_row = 0 WHERE name = ?',
      [now() + PAUSE_SECONDS, reason, recorder]
    );
    log.warn(`[RECORDERS] ${recorder} paused for ${PAUSE_SECONDS / 60} minutes: ${reason}`);
  }
}
