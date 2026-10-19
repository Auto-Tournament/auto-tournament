/**
 * The recorder benchmark (recorders.ts): one moment timed at each refresh rate
 * in BENCHMARK_HZ, and the fastest finished one kept for the recorder's jobs.
 */
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
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

/** cs2_recorders.benchmark, as saveBenchmark writes it. */
export interface StoredBenchmark {
  tries: BenchmarkTry[];
  pick: number | null;
  source: 'bundled' | 'match';
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
  body: { tries?: Untrusted; source?: Untrusted }
): Promise<{ gamescopeHz: number | null }> {
  // Which clip it timed: the demo shipped with the worker ('bundled', the same
  // everywhere) or this install's first clip ('match'; older workers send none).
  const source = body.source === 'bundled' ? 'bundled' : 'match';
  const tries: BenchmarkTry[] = (Array.isArray(body.tries) ? body.tries : [])
    .slice(0, 8)
    .map((t: Record<string, Untrusted>) => {
      const num = (v: Untrusted) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
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
  const { adminNoticeService } = await import('../../../services/adminNoticeService');
  if (pick) await adminNoticeService.resolve(`benchmark_failed:${name}`);
  else
    await adminNoticeService.raise(
      'benchmark_failed',
      { recorder: name, error: tries.find((t) => t.error)?.error ?? null },
      `benchmark_failed:${name}`
    );
  return { gamescopeHz: pick };
}
