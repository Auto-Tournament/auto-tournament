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
import { log } from '../../../utils/logger';
import { jobFor, type MomentRow } from './highlights';
import { readHighlightQuality } from './highlightQuality';

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
}

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** A claim: note the recorder and what it runs on. */
export async function seenRecorder(
  name: string,
  info: { version?: unknown; gpu?: unknown; platform?: unknown }
): Promise<RecorderRow> {
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

/**
 * The benchmark job: one moment, the same for every recorder, at each rate in
 * BENCHMARK_HZ. A recorder that carries the shipped benchmark demo
 * (`benchDemo`) times that and needs no moment; others get the first clip ever
 * recorded here (its demo is known to play), so for them it is null until
 * something has been recorded.
 */
export async function benchmarkJob(benchDemo = false): Promise<Record<string, unknown> | null> {
  const tries = BENCHMARK_HZ.map((gamescopeHz) => ({ gamescopeHz }));
  const row = await db.queryOneAsync<MomentRow>(
    `SELECT h.id, h.match_slug, h.map_number, h.player_id, h.kind, h.title, h.round, h.score,
            h.start_tick, h.end_tick, h.slowmo_tick, h.kill_ticks
       FROM cs2_highlights h
       JOIN match_map_results r ON r.match_slug = h.match_slug AND r.map_number = h.map_number
      WHERE h.status = 'done' AND r.demo_file_path IS NOT NULL
      ORDER BY h.id LIMIT 1`,
    []
  );
  if (!row) {
    return benchDemo
      ? {
          kind: 'benchmark',
          matchSlug: '',
          mapNumber: 0,
          quality: await readHighlightQuality(),
          keepClean: false,
          players: [],
          tries,
        }
      : null;
  }
  const player = await jobFor(row.match_slug, Number(row.map_number), row.player_id, [row]);
  return {
    kind: 'benchmark',
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    quality: await readHighlightQuality(),
    keepClean: false,
    players: [player],
    tries,
  };
}

/**
 * Whether the recorder should benchmark now: an admin asked (or it is new), or
 * it carries the shipped demo but was last timed on this install's clip, so
 * its time does not compare with recorders timed on the demo.
 */
export function wantsBenchmark(me: RecorderRow, benchDemo: boolean): boolean {
  if (Number(me.benchmark_wanted) === 1) return true;
  if (!benchDemo || !me.benchmark) return false;
  try {
    return (JSON.parse(me.benchmark) as { source?: string }).source !== 'bundled';
  } catch {
    return true;
  }
}

interface BenchmarkTry {
  gamescopeHz: number;
  seconds: number | null;
  captureFps: number | null;
  ok: boolean;
  error?: string;
}

/** A benchmark's results: keep the fastest finished try's refresh rate. */
export async function saveBenchmark(
  name: string,
  body: { tries?: unknown; source?: unknown }
): Promise<{ gamescopeHz: number | null }> {
  // Which clip it timed: the demo shipped with the worker ('bundled', the same
  // everywhere) or this install's first clip ('match'; older workers send none).
  const source = body.source === 'bundled' ? 'bundled' : 'match';
  const tries: BenchmarkTry[] = (Array.isArray(body.tries) ? body.tries : [])
    .slice(0, 8)
    .map((t: Record<string, unknown>) => {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return {
        gamescopeHz: Number(t.gamescopeHz) || 0,
        seconds: num(t.seconds),
        captureFps: num(t.captureFps),
        ok: t.ok === true,
        ...(typeof t.error === 'string' ? { error: t.error.slice(0, 300) } : {}),
      };
    })
    .filter((t) => t.gamescopeHz > 0);
  const fastest = tries
    .filter((t) => t.ok && t.seconds != null)
    .sort((a, b) => a.seconds! - b.seconds!);
  const pick = fastest[0]?.gamescopeHz ?? null;
  await db.runAsync(
    `UPDATE cs2_recorders SET benchmark = ?, benchmark_at = ?, benchmark_wanted = 0, gamescope_hz = ?
      WHERE name = ?`,
    [JSON.stringify({ tries, pick, source }), now(), pick, name.slice(0, 120)]
  );
  log.info(
    `[RECORDERS] ${name} benchmarked (${source} clip): ${pick ? `${pick} Hz` : 'no try finished'}`
  );
  return { gamescopeHz: pick };
}

/** A finished job's log and timings. */
export async function saveRun(name: string, body: Record<string, unknown>): Promise<void> {
  const kind = text(body.kind, 40) ?? 'unknown';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const logText = typeof body.log === 'string' ? body.log.slice(-LOG_MAX) : null;
  await db.runAsync(
    `INSERT INTO cs2_recorder_runs (recorder, kind, match_slug, map_number, started_at, seconds, ok, clips, rejected, error, log)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      text(body.error, 1000),
      logText,
    ]
  );
  // Keep the newest runs per recorder.
  await db.runAsync(
    `DELETE FROM cs2_recorder_runs WHERE recorder = ? AND id NOT IN (
       SELECT id FROM cs2_recorder_runs WHERE recorder = ? ORDER BY id DESC LIMIT ?)`,
    [name.slice(0, 120), name.slice(0, 120), RUNS_KEPT]
  );
}

/** The Recorders page: every recorder with its numbers. */
export async function listRecorders() {
  const rows = await db.queryAsync<
    RecorderRow & {
      runs: number;
      avg_clip_seconds: number | null;
      last_error: string | null;
      working_clips: number | null;
      working_match: string | null;
      working_map: number | null;
      working_since: number | null;
    }
  >(
    `SELECT r.*,
            (SELECT COUNT(*)::int FROM cs2_recorder_runs x WHERE x.recorder = r.name) AS runs,
            (SELECT SUM(x.seconds) / NULLIF(SUM(x.clips), 0) FROM cs2_recorder_runs x
              WHERE x.recorder = r.name AND x.kind = 'map' AND x.ok = 1 AND x.clips > 0) AS avg_clip_seconds,
            -- Only while its latest run is the one that failed: a later good run clears it.
            (SELECT x.error FROM cs2_recorder_runs x WHERE x.recorder = r.name
              ORDER BY x.id DESC LIMIT 1) AS last_error,
            -- What it is recording right now (a map job can take hours, with no
            -- word from it until it is done).
            w.clips AS working_clips, w.match_slug AS working_match, w.map_number AS working_map, w.since AS working_since
       FROM cs2_recorders r
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS clips, MIN(h.match_slug) AS match_slug, MIN(h.map_number) AS map_number,
                                 MIN(h.claimed_at) AS since
                            FROM cs2_highlights h
                           WHERE h.recorder = r.name AND h.status = 'recording'
                           HAVING COUNT(*) > 0) w ON TRUE
      ORDER BY r.last_seen DESC NULLS LAST`,
    []
  );
  const t = now();
  return rows.map((r) => {
    let benchmark: unknown = null;
    try {
      benchmark = r.benchmark ? JSON.parse(r.benchmark) : null;
    } catch {
      benchmark = null;
    }
    const paused = isPaused(r);
    return {
      name: r.name,
      label: (r as RecorderRow & { label?: string | null }).label ?? null,
      version: r.version,
      gpu: r.gpu,
      platform: r.platform,
      firstSeen: Number(r.first_seen),
      lastSeen: r.last_seen ? Number(r.last_seen) : null,
      // Busy with a job counts as online, however long since it last asked.
      online:
        (!!r.last_seen && t - Number(r.last_seen) < 15 * 60) || Number(r.working_clips ?? 0) > 0,
      working:
        Number(r.working_clips ?? 0) > 0
          ? {
              clips: Number(r.working_clips),
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
      lastError: r.last_error,
    };
  });
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
    error: string | null;
  }>(
    `SELECT id, kind, match_slug, map_number, started_at, seconds, ok, clips, rejected, error
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
 * to waiting without using up an attempt, preferably for another recorder,
 * and a recorder that does this twice in a row is paused, so a broken one
 * stops taking (and failing) every job (2026-10-09: the EWC import's 78 clips
 * failed in ten minutes on one desktop).
 */
export async function recorderFault(recorder: string, ids: number[], error: string): Promise<void> {
  if (ids.length > 0) {
    await db.runAsync(
      `UPDATE cs2_highlights SET status = 'pending', attempts = GREATEST(attempts - 1, 0), error = ?,
              claimed_at = NULL, recorder = NULL, avoid_recorder = ?
        WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'recording'`,
      [error.slice(0, 500), recorder, ...ids]
    );
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
