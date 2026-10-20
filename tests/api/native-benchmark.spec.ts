import { test, expect } from '@playwright/test';
import { benchmarkResult } from '../../api/src/integrations/cs2/demos/benchmarkResult';

const TAGS = { tag: ['@api', '@recorders'] };

test('native benchmark accepts slow complete export without a refresh rate', TAGS, () => {
  expect(
    benchmarkResult({ backend: 'native', tries: [{ seconds: 240, captureFps: 8.4, ok: true }] })
  ).toMatchObject({
    backend: 'native',
    ok: true,
    pick: null,
    error: null,
    tries: [{ gamescopeHz: 0, captureFps: 8.4, ok: true }],
  });
});

test('failed native benchmark keeps its actionable error, including before capture', TAGS, () => {
  expect(
    benchmarkResult({ backend: 'native', error: 'Plugin disconnected', tries: [] })
  ).toMatchObject({ ok: false, pick: null, error: 'Plugin disconnected' });
  expect(
    benchmarkResult({ backend: 'native', tries: [{ ok: false, error: 'Display too small' }] })
  ).toMatchObject({ ok: false, error: 'Display too small' });
});

test('benchmark summaries keep diagnostics in the run log', TAGS, () => {
  expect(
    benchmarkResult({
      backend: 'native',
      error: 'Out of memory\n--- gamescope log, last lines ---\nfont details',
    }).error
  ).toBe('Out of memory');
});

test('legacy stream benchmarks still select the fastest successful refresh rate', TAGS, () => {
  expect(
    benchmarkResult({
      tries: [
        { gamescopeHz: 240, seconds: 83, ok: true },
        { gamescopeHz: 120, seconds: 96, ok: true },
        { gamescopeHz: 360, ok: false },
      ],
    })
  ).toMatchObject({ backend: 'stream', ok: true, pick: 240 });
});

test('malformed attempts cannot mark a benchmark successful', TAGS, () => {
  expect(
    benchmarkResult({ backend: 'native', tries: [null, 'bad', { ok: true, seconds: -1 }] }).ok
  ).toBe(false);
});
