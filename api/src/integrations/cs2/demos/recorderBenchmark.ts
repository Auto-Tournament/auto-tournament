/**
 * The recorder benchmark (recorders.ts): one moment timed at each refresh rate
 * in BENCHMARK_HZ, and the fastest finished one kept for the recorder's jobs.
 */
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { BenchmarkResult } from './benchmarkResult';
export type { StoredBenchmark } from './benchmarkResult';
import { jobFor, type MomentRow } from './highlights';
import { readHighlightQuality } from './highlightQuality';
import { BENCHMARK_HZ, type RecorderRow } from './recorders';

const now = () => Math.floor(Date.now() / 1000);

/**
 * The benchmark job: one moment, the same for every recorder, at each rate in
 * BENCHMARK_HZ. A recorder that carries the shipped benchmark demo
 * (`benchDemo`) times that and needs no moment; others get the first clip ever
 * recorded here (its demo is known to play), so for them it is null until
 * something has been recorded.
 */
export async function benchmarkJob(benchDemo = false) {
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

/** Save a checked native export result or the stream recorder's fastest rate. */
export async function saveBenchmark(
  name: string,
  result: BenchmarkResult
): Promise<{ gamescopeHz: number | null; ok: boolean }> {
  const { pick, source, ok, backend } = result;
  await db.runAsync(
    `UPDATE cs2_recorders SET benchmark = ?, benchmark_at = ?, benchmark_wanted = 0, gamescope_hz = ?
      WHERE name = ?`,
    [JSON.stringify(result), now(), pick, name.slice(0, 120)]
  );
  let summary = 'no try finished';
  if (ok) summary = backend === 'native' ? 'native export completed' : `${pick} Hz`;
  log.info(`[RECORDERS] ${name} benchmarked (${source} clip): ${summary}`);
  const { adminNoticeService } = await import('../../../services/adminNoticeService');
  if (ok) await adminNoticeService.resolve(`benchmark_failed:${name}`);
  else
    await adminNoticeService.raise(
      'benchmark_failed',
      { recorder: name, error: result.error },
      `benchmark_failed:${name}`
    );
  return { gamescopeHz: pick, ok };
}
