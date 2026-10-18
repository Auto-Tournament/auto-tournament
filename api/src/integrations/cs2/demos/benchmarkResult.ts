/** Native export is timed once; stream capture chooses a compositor rate. */
export function benchmarkResult(body: {
  tries?: unknown;
  source?: unknown;
  backend?: unknown;
  error?: unknown;
}) {
  const backend = body.backend === 'native' ? 'native' : 'stream';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const errorText = (v: string) => v.split('\n--- gamescope log, last lines ---')[0].slice(0, 300);
  const tries = (Array.isArray(body.tries) ? body.tries : [])
    .slice(0, 8)
    .filter((t): t is Record<string, unknown> => t != null && typeof t === 'object')
    .map((t) => ({
      gamescopeHz: backend === 'native' ? 0 : (num(t.gamescopeHz) ?? 0),
      seconds: num(t.seconds),
      captureFps: num(t.captureFps),
      ok: t.ok === true && num(t.seconds) != null,
      ...(typeof t.error === 'string' ? { error: errorText(t.error) } : {}),
    }))
    .filter((t) => backend === 'native' || t.gamescopeHz > 0);
  const finished = tries.filter((t) => t.ok).sort((a, b) => a.seconds! - b.seconds!);
  const ok = finished.length > 0;
  return {
    backend,
    tries,
    pick: backend === 'stream' ? (finished[0]?.gamescopeHz ?? null) : null,
    source: body.source === 'bundled' ? 'bundled' : 'match',
    ok,
    error: ok
      ? null
      : typeof body.error === 'string' && body.error
        ? errorText(body.error)
        : (tries.find((t) => t.error)?.error ?? 'No benchmark attempt finished'),
  };
}
