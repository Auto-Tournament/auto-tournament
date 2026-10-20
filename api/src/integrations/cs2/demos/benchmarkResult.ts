import type { Untrusted } from '../../types';

export interface BenchmarkTry {
  gamescopeHz: number;
  seconds: number | null;
  captureFps: number | null;
  ok: boolean;
  error?: string;
}

export interface StoredBenchmark {
  tries: BenchmarkTry[];
  pick: number | null;
  source: 'bundled' | 'match';
  backend?: 'native' | 'stream';
  ok?: boolean;
  error?: string | null;
}

export interface BenchmarkResult extends StoredBenchmark {
  backend: 'native' | 'stream';
  ok: boolean;
  error: string | null;
}

function isObject(value: Untrusted): value is Record<string, Untrusted> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: Untrusted): Record<string, Untrusted> {
  return isObject(value) ? value : {};
}

function nonNegativeNumber(value: Untrusted): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

const errorSummary = (value: string) =>
  value.split('\n--- gamescope log, last lines ---')[0].slice(0, 300);

/** Check the recorder's message once; native export can finish below playback speed. */
export function benchmarkResult(input: Untrusted): BenchmarkResult {
  const body = readObject(input);
  const backend = body.backend === 'native' ? 'native' : 'stream';
  const tries: BenchmarkTry[] = [];
  for (const value of (Array.isArray(body.tries) ? body.tries : []).slice(0, 8)) {
    const attempt = readObject(value);
    const seconds = nonNegativeNumber(attempt.seconds);
    const gamescopeHz = backend === 'native' ? 0 : (nonNegativeNumber(attempt.gamescopeHz) ?? 0);
    if (backend === 'stream' && gamescopeHz <= 0) continue;
    tries.push({
      gamescopeHz,
      seconds,
      captureFps: nonNegativeNumber(attempt.captureFps),
      ok: attempt.ok === true && seconds != null,
      ...(typeof attempt.error === 'string' ? { error: errorSummary(attempt.error) } : {}),
    });
  }
  const successfulAttempts = tries.filter((attempt) => attempt.ok);
  successfulAttempts.sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
  const ok = successfulAttempts.length > 0;
  let error: string | null = null;
  if (!ok) {
    error = tries.find((attempt) => attempt.error)?.error ?? 'No benchmark attempt finished';
    if (typeof body.error === 'string' && body.error) error = errorSummary(body.error);
  }
  return {
    backend,
    tries,
    pick: backend === 'stream' ? (successfulAttempts[0]?.gamescopeHz ?? null) : null,
    source: body.source === 'bundled' ? 'bundled' : 'match',
    ok,
    error,
  };
}
