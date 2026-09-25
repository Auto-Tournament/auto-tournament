import http from 'http';
import type { AddressInfo } from 'net';
import { test, expect } from '@playwright/test';
import { compatBadge, validateCompatDocument, COMPAT_MAX_BYTES } from '../../api/src/utils/compatPayload';
import { fetchCompatFeed } from '../../api/src/services/compatFeedService';
import { isValidCompatIngestAuth } from '../../api/src/services/compatService';
import { compatDoc } from '../helpers/compat';

/**
 * Ready Up compatibility, in process: the schema-1 validator, the shields
 * badge, the ingest token check and the COMPAT_FEED_URL fetch (against a
 * local server that answers, lags, 304s, oversizes and lies).
 *
 * The endpoints themselves are tests/api/compat.spec.ts.
 *
 * @tag api
 * @tag compat
 */

test.describe('compat document validation', { tag: ['@api', '@compat'] }, () => {
  test('accepts the contract and normalises timestamps to UTC', () => {
    const doc = compatDoc({ run: { started_at: '2026-09-25T14:00:00+02:00', finished_at: null } });
    const checked = validateCompatDocument(doc);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.run.started_at).toBe('2026-09-25T12:00:00.000Z');
    expect(checked.value.run.finished_at).toBeNull();
    // Exactly the contract's keys, in its order.
    expect(Object.keys(checked.value)).toEqual([
      'schema',
      'cs2',
      'readyup',
      'run',
      'overall',
      'components',
      'checked_at',
    ]);
    expect(checked.value.components.map((c) => c.id)).toEqual(['core', 'match']);
  });

  test('refuses what the contract does not allow, naming each field', () => {
    const cases: Array<[string, (d: Record<string, any>) => void, string]> = [
      ['schema 2', (d) => (d.schema = 2), 'schema'],
      ['unknown top-level field', (d) => (d.extra = true), 'extra'],
      ['unknown nested field', (d) => (d.run.extra = 1), 'run.extra'],
      ['missing overall', (d) => delete d.overall, 'overall'],
      ['bad overall', (d) => (d.overall = 'ok'), 'overall'],
      ['bad trigger', (d) => (d.run.trigger = 'cron'), 'run.trigger'],
      ['bad stage', (d) => (d.run.stage = 'deploy'), 'run.stage'],
      ['bad state', (d) => (d.run.state = 'done'), 'run.state'],
      ['javascript url', (d) => (d.run.url = 'javascript:alert(1)'), 'run.url'],
      ['buildid not numeric', (d) => (d.cs2.buildid = '12a'), 'cs2.buildid'],
      ['buildid a number', (d) => (d.cs2.buildid = 25537370), 'cs2.buildid'],
      ['patch not dotted', (d) => (d.cs2.patch = 'latest'), 'cs2.patch'],
      ['commit not hex', (d) => (d.readyup.commit = 'main'), 'readyup.commit'],
      ['started_at not ISO', (d) => (d.run.started_at = 'yesterday'), 'run.started_at'],
      ['checked_at impossible date', (d) => (d.checked_at = '2026-02-31T25:00:00Z'), 'checked_at'],
      ['component id uppercase', (d) => (d.components[0].id = 'Core'), 'components[0].id'],
      ['duplicate component', (d) => (d.components[1].id = 'core'), 'components[1].id'],
      ['bad component status', (d) => (d.components[0].status = 'ok'), 'components[0].status'],
      ['bad check kind', (d) => (d.components[0].checks[0].kind = 'magic'), 'components[0].checks[0].kind'],
      ['passed > total', (d) => (d.components[0].checks[0].passed = 10), 'components[0].checks[0].passed'],
      ['negative total', (d) => (d.components[0].checks[0].total = -1), 'components[0].checks[0].total'],
      ['fractional passed', (d) => (d.components[0].checks[0].passed = 1.5), 'components[0].checks[0].passed'],
      ['failure not a string', (d) => (d.components[0].checks[0].failures = [1]), 'components[0].checks[0].failures[0]'],
      ['failure too long', (d) => (d.components[0].checks[0].failures = ['x'.repeat(501)]), 'components[0].checks[0].failures[0]'],
      ['control chars in name', (d) => (d.components[0].name = 'Co\nre'), 'components[0].name'],
      ['too many components', (d) => (d.components = Array.from({ length: 33 }, (_, i) => ({ ...d.components[0], id: `c${i}` }))), 'components'],
      ['components not an array', (d) => (d.components = {}), 'components'],
    ];
    for (const [name, mutate, path] of cases) {
      const doc = JSON.parse(JSON.stringify(compatDoc())) as Record<string, any>;
      mutate(doc);
      const checked = validateCompatDocument(doc);
      expect(checked.ok, name).toBe(false);
      if (checked.ok) continue;
      expect(checked.errors.some((e) => e.startsWith(`${path}:`)), `${name}: ${checked.errors.join(' | ')}`).toBe(true);
    }
    for (const notADoc of [null, [], 'compat', 42]) {
      expect(validateCompatDocument(notADoc).ok).toBe(false);
    }
  });

  test('badge follows the overall verdict, in shields endpoint format', () => {
    expect(compatBadge(null)).toEqual({
      schemaVersion: 1,
      label: 'Ready Up',
      message: 'unknown',
      color: 'lightgrey',
      cacheSeconds: 300,
    });
    const colours: Record<string, string> = {
      pass: 'brightgreen',
      warn: 'yellow',
      fail: 'red',
      checking: 'blue',
      no_verdict: 'lightgrey',
    };
    for (const [overall, color] of Object.entries(colours)) {
      const checked = validateCompatDocument(compatDoc({ overall }));
      expect(checked.ok).toBe(true);
      if (!checked.ok) continue;
      const badge = compatBadge(checked.value);
      expect(badge.color).toBe(color);
      expect(badge.message).toContain('CS2 1.41.8.5');
    }
  });
});

test.describe('compat ingest token', { tag: ['@api', '@compat'] }, () => {
  const saved = process.env.COMPAT_INGEST_TOKEN;
  test.afterEach(() => {
    if (saved === undefined) delete process.env.COMPAT_INGEST_TOKEN;
    else process.env.COMPAT_INGEST_TOKEN = saved;
  });

  test('accepts only Bearer <token>, and nothing while the token is unset or short', () => {
    process.env.COMPAT_INGEST_TOKEN = 'unit-compat-token-0123456789';
    expect(isValidCompatIngestAuth('Bearer unit-compat-token-0123456789')).toBe(true);
    expect(isValidCompatIngestAuth('bearer unit-compat-token-0123456789')).toBe(true);
    expect(isValidCompatIngestAuth('Bearer unit-compat-token-012345678')).toBe(false);
    expect(isValidCompatIngestAuth('unit-compat-token-0123456789')).toBe(false);
    expect(isValidCompatIngestAuth('Basic unit-compat-token-0123456789')).toBe(false);
    expect(isValidCompatIngestAuth('Bearer ')).toBe(false);
    expect(isValidCompatIngestAuth(undefined)).toBe(false);

    process.env.COMPAT_INGEST_TOKEN = 'short';
    expect(isValidCompatIngestAuth('Bearer short')).toBe(false);
    delete process.env.COMPAT_INGEST_TOKEN;
    expect(isValidCompatIngestAuth('Bearer ')).toBe(false);
  });
});

test.describe('COMPAT_FEED_URL fetch', { tag: ['@api', '@compat'] }, () => {
  let server: http.Server;
  let origin = '';
  const body = JSON.stringify(compatDoc());

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/ok.json':
          if (req.headers['if-none-match'] === '"v1"') {
            res.writeHead(304).end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"v1"' }).end(body);
          return;
        case '/slow.json':
          setTimeout(() => res.writeHead(200).end(body), 2_000).unref();
          return;
        case '/big.json':
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('x'.repeat(COMPAT_MAX_BYTES + 1));
          return;
        case '/html':
          res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>');
          return;
        case '/invalid.json':
          res.writeHead(200).end(JSON.stringify({ ...JSON.parse(body), overall: 'great' }));
          return;
        default:
          res.writeHead(500).end('boom');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('reads a valid document and honours its ETag', async () => {
    const first = await fetchCompatFeed(`${origin}/ok.json`);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.etag).toBe('"v1"');
    expect(first.document.overall).toBe('pass');
    const again = await fetchCompatFeed(`${origin}/ok.json`, { etag: first.etag });
    expect(again.status).toBe('not_modified');
  });

  test('fails cleanly on a timeout, an oversized, non-JSON or invalid file, or an error status', async () => {
    const slow = await fetchCompatFeed(`${origin}/slow.json`, { timeoutMs: 200 });
    expect(slow).toEqual({ status: 'error', error: 'it did not answer in time' });

    const big = await fetchCompatFeed(`${origin}/big.json`);
    expect(big.status).toBe('error');

    const html = await fetchCompatFeed(`${origin}/html`);
    expect(html).toEqual({ status: 'error', error: 'the response is not JSON' });

    const invalid = await fetchCompatFeed(`${origin}/invalid.json`);
    expect(invalid.status).toBe('error');
    if (invalid.status === 'error') expect(invalid.error).toContain('overall');

    const broken = await fetchCompatFeed(`${origin}/broken`);
    expect(broken).toEqual({ status: 'error', error: 'HTTP 500' });
  });
});
