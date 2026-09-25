import { test, expect } from '@playwright/test';
import { COMPAT_TOKEN, compatDoc, pushCompat, uniqueRunId } from '../helpers/compat';

/**
 * Ready Up compatibility endpoints (api/src/routes/compat.ts): the CI's
 * token-guarded push and the public reads behind /compatibility.
 *
 * Needs COMPAT_INGEST_TOKEN on the server (CI sets it; see helpers/compat).
 * The validator's edge cases are tests/api/compat-payload.spec.ts.
 *
 * @tag api
 * @tag compat
 */

/**
 * Seconds from now, as ISO. Runs sort by `run.started_at`, so a run meant to
 * be the newest starts now (never in the future, or a retry's runs would sort
 * below the first attempt's); `checked_at` does not sort and may run ahead.
 */
function at(offsetSeconds: number): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

test.describe.serial('Ready Up compatibility API', () => {
  test('push is refused without the right token', { tag: ['@api', '@compat'] }, async ({ request }) => {
    const doc = compatDoc();

    const none = await request.post('/api/compat/events', { data: doc });
    expect(none.status()).toBe(401);

    const wrong = await request.post('/api/compat/events', {
      headers: { Authorization: `Bearer ${COMPAT_TOKEN}x` },
      data: doc,
    });
    expect(wrong.status()).toBe(401);

    const notBearer = await request.post('/api/compat/events', {
      headers: { Authorization: COMPAT_TOKEN },
      data: doc,
    });
    expect(notBearer.status()).toBe(401);

    // A service token is not the compat token.
    const serviceToken = await request.post('/api/compat/events', {
      headers: { Authorization: 'Bearer ci-admin-token-0123456789abcdef' },
      data: doc,
    });
    expect(serviceToken.status()).toBe(401);

    // Nothing refused was stored.
    const runs = await (await request.get('/api/compat/runs?limit=200')).json();
    expect(runs.runs.some((r: { run: { id: string } }) => r.run.id === doc.run.id)).toBe(false);
  });

  test('push validates the document strictly and bounds its size', { tag: ['@api', '@compat'] }, async ({ request }) => {
    const headers = { Authorization: `Bearer ${COMPAT_TOKEN}` };

    const bad = compatDoc({ overall: 'great' }) as unknown as Record<string, unknown>;
    bad.surprise = 1;
    const invalid = await request.post('/api/compat/events', { headers, data: bad });
    expect(invalid.status()).toBe(400);
    const body = await invalid.json();
    expect(body.error).toBe('invalid_document');
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/^overall:/), 'surprise: is not a known field']));

    const notJson = await request.post('/api/compat/events', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: '{"schema":1,',
    });
    expect(notJson.status()).toBe(400);

    const huge = compatDoc();
    huge.components[0].checks[0].failures = Array.from({ length: 200 }, () => 'x'.repeat(500));
    huge.components[1].checks[0].failures = Array.from({ length: 200 }, () => 'y'.repeat(500));
    huge.components.push({ ...huge.components[1], id: 'skins', name: 'Skins' });
    const tooLarge = await request.post('/api/compat/events', { headers, data: huge });
    expect(tooLarge.status()).toBe(413);
  });

  test('a run is stored, updated in place, and neither repeated nor rolled back', { tag: ['@api', '@compat'] }, async ({ request }) => {
    const runId = uniqueRunId('api');
    const checking = compatDoc({
      run: { id: runId, state: 'checking', stage: 'selftest', started_at: at(0), finished_at: null },
      overall: 'checking',
      checked_at: at(1),
    });
    checking.components[1].status = 'checking';
    checking.components[1].checks[0].status = 'pending';
    checking.components[1].checks[0].passed = 0;

    expect(await pushCompat(request, checking)).toMatchObject({ success: true, status: 'stored', created: true, runId });
    expect(await pushCompat(request, checking)).toMatchObject({ status: 'unchanged', runId });

    const done = compatDoc({
      run: { id: runId, state: 'warn', stage: 'selftest', started_at: checking.run.started_at, finished_at: at(3) },
      overall: 'warn',
      checked_at: at(3),
    });
    done.components[1].status = 'warn';
    done.components[1].checks[0] = { kind: 'selftest', status: 'warn', passed: 11, total: 12, failures: ['round_end fired twice'] };
    expect(await pushCompat(request, done)).toMatchObject({ status: 'stored', created: false, runId });

    // The earlier copy arriving late changes nothing.
    expect(await pushCompat(request, checking)).toMatchObject({ status: 'stale', runId });

    const latest = await (await request.get('/api/compat/latest')).json();
    expect(latest.success).toBe(true);
    expect(latest.latest).toMatchObject({
      schema: 1,
      cs2: { buildid: '25537370', patch: '1.41.8.5' },
      run: { id: runId, state: 'warn', stage: 'selftest', trigger: 'build_change' },
      overall: 'warn',
      source: 'push',
    });
    expect(latest.latest.components.map((c: { id: string }) => c.id)).toEqual(['core', 'match']);
    expect(latest.latest.components[1].checks[0]).toEqual({
      kind: 'selftest',
      status: 'warn',
      passed: 11,
      total: 12,
      failures: ['round_end fired twice'],
    });
    expect(typeof latest.latest.received_at).toBe('string');
  });

  test('runs lists newest first with component statuses; latest follows the newest', { tag: ['@api', '@compat'] }, async ({ request }) => {
    const older = compatDoc({ run: { started_at: at(-3600) }, checked_at: at(-3600) });
    const newer = compatDoc({
      cs2: { buildid: '25537999', patch: '1.41.9.0' },
      run: { state: 'fail' },
      overall: 'fail',
    });
    newer.components[0].status = 'fail';
    newer.components[0].checks[0] = { kind: 'signature', status: 'fail', passed: 8, total: 9, failures: ['CCSPlayerPawn::Think'] };
    await pushCompat(request, older);
    await pushCompat(request, newer);

    const two = await request.get('/api/compat/runs?limit=2');
    expect(two.status()).toBe(200);
    const firstTwo = (await two.json()).runs;
    expect(firstTwo).toHaveLength(2);
    expect(firstTwo[0].run.id).toBe(newer.run.id);
    expect(firstTwo[0].components[0].checks).toBeUndefined();

    // Other specs' runs may sit between the two; their order is what counts.
    const all = (await (await request.get('/api/compat/runs?limit=200')).json()).runs as Array<{
      run: { id: string };
      components: unknown[];
    }>;
    const runs = all.filter((r) => r.run.id === newer.run.id || r.run.id === older.run.id);
    expect(runs.map((r) => r.run.id)).toEqual([newer.run.id, older.run.id]);
    expect(runs[0].components).toEqual([
      { id: 'core', name: 'Core', status: 'fail' },
      { id: 'match', name: 'Match', status: 'pass' },
    ]);

    const latest = await (await request.get('/api/compat/latest')).json();
    expect(latest.latest.run.id).toBe(newer.run.id);
    expect(latest.latest.cs2).toEqual({ buildid: '25537999', patch: '1.41.9.0' });

    for (const limit of ['0', '201', 'abc', '-1', '1.5']) {
      const bad = await request.get(`/api/compat/runs?limit=${limit}`);
      expect(bad.status(), `limit=${limit}`).toBe(400);
    }
    const defaults = await (await request.get('/api/compat/runs')).json();
    expect(defaults.runs.length).toBeGreaterThanOrEqual(2);
    expect(defaults.runs.length).toBeLessThanOrEqual(20);
  });

  test('badge.json is a shields endpoint badge for the newest run', { tag: ['@api', '@compat'] }, async ({ request }) => {
    const doc = compatDoc({ overall: 'pass' });
    await pushCompat(request, doc);

    const res = await request.get('/api/compat/badge.json');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      label: 'Ready Up',
      message: 'compatible · CS2 1.41.8.5',
      color: 'brightgreen',
      cacheSeconds: 300,
    });
  });

  test('reads are public', { tag: ['@api', '@compat'] }, async ({ playwright, baseURL }) => {
    // A fresh context: no cookies, no token.
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      for (const path of ['/api/compat/latest', '/api/compat/runs', '/api/compat/badge.json']) {
        const res = await anonymous.get(path);
        expect(res.status(), path).toBe(200);
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
