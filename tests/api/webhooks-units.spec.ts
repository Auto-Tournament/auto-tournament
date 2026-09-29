import http from 'http';
import type { AddressInfo } from 'net';
import { test, expect } from '@playwright/test';
import {
  computeSignature,
  parseSignatureHeader,
  signatureHeaderValue,
  verifySignature,
  generateWebhookSecret,
} from '../../api/src/services/webhooks/signing';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, nextRetryDelayMs, parseRetryAfter } from '../../api/src/services/webhooks/retry';
import { redactDeliveryBody, REDACTED, scrubSecrets } from '../../api/src/services/webhooks/redact';
import {
  checkWebhookUrlSyntax,
  classifyAddress,
  resolveWebhookTarget,
  WebhookTargetError,
} from '../../api/src/services/webhooks/ssrf';
import { diffMatch, type AnnouncedState, type CurrentFacts } from '../../api/src/services/webhooks/diff';
import { sampleEnvelope } from '../../api/src/services/webhooks/samples';
import { WEBHOOK_EVENT_TYPES, connectLinks } from '../../api/src/services/webhooks/events';
import { attemptDelivery } from '../../api/src/services/webhooks/deliver';
import { isValidSteam64, parseTeamInput } from '../../api/src/services/integrationTeamInput';

/**
 * Integrator webhooks, in process (no server, no database): signatures,
 * the retry schedule, redaction of connect details, the SSRF rules, which
 * events a match change means, the sample payloads, one HTTP attempt, and
 * the teams API's input rules.
 *
 * @tag api
 * @tag webhooks
 */

test.describe('webhook signatures', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'match.ready', data: { x: 'æøå' } });

  test('HMAC-SHA256 over "<t>.<body>", verified with a tolerance', () => {
    const t = 1_790_000_000;
    const header = signatureHeaderValue([secret], t, body);
    expect(header).toBe(`t=${t},v1=${computeSignature(secret, t, body)}`);
    expect(computeSignature(secret, t, body)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySignature(secret, header, body, { nowSeconds: t + 10 })).toEqual({ ok: true });
    expect(verifySignature(secret, header, body + ' ', { nowSeconds: t })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifySignature('whsec_other', header, body, { nowSeconds: t })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifySignature(secret, header, body, { nowSeconds: t + 301 })).toEqual({ ok: false, reason: 'stale' });
    expect(verifySignature(secret, 'garbage', body)).toEqual({ ok: false, reason: 'malformed' });
  });

  test('during a rotation both secrets sign, and either verifies', () => {
    const t = 1_790_000_000;
    const header = signatureHeaderValue(['whsec_new', 'whsec_old'], t, body);
    expect(parseSignatureHeader(header)?.signatures).toHaveLength(2);
    expect(verifySignature('whsec_new', header, body, { nowSeconds: t }).ok).toBe(true);
    expect(verifySignature('whsec_old', header, body, { nowSeconds: t }).ok).toBe(true);
  });

  test('secrets are whsec_ + 43 base64url characters and never repeat', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

test.describe('webhook retry schedule', () => {
  test('exponential-ish backoff, 10 attempts, then give up', () => {
    const fixed = () => 0.5; // no jitter
    expect(MAX_ATTEMPTS).toBe(10);
    const delays = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => nextRetryDelayMs(i + 1, { random: fixed }));
    expect(delays).toEqual([...RETRY_DELAYS_MS]);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    expect(nextRetryDelayMs(MAX_ATTEMPTS)).toBeNull();
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total / 3_600_000).toBeGreaterThan(15);
  });

  test('jitter stays within ±10 %, scale shrinks it, Retry-After is honoured up to a cap', () => {
    expect(nextRetryDelayMs(1, { random: () => 0 })).toBe(9_000);
    expect(nextRetryDelayMs(1, { random: () => 1 })).toBe(11_000);
    expect(nextRetryDelayMs(3, { random: () => 0.5, scale: 0.001 })).toBe(120);
    expect(nextRetryDelayMs(1, { random: () => 0.5, retryAfterSeconds: 20 })).toBe(20_000);
    // Capped at the next delay (30 s after attempt 1): a receiver cannot park us for a day.
    expect(nextRetryDelayMs(1, { random: () => 0.5, retryAfterSeconds: 86_400 })).toBe(30_000);
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(new Date(Date.now() + 60_000).toUTCString())).toBeGreaterThan(50);
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

test.describe('delivery log redaction', () => {
  test('connect details are replaced, everything else stays', () => {
    const env = sampleEnvelope('match.ready');
    const body = JSON.stringify(env);
    expect(body).toContain('k3Lp9QzT2w');
    const shown = redactDeliveryBody(body) as typeof env;
    const text = JSON.stringify(shown);
    expect(text).not.toContain('k3Lp9QzT2w');
    expect(text).not.toContain('203.0.113.10');
    expect(text).not.toContain('steam://');
    expect(shown.data.match.connect).toEqual({
      host: REDACTED,
      port: REDACTED,
      password: REDACTED,
      steam_url: REDACTED,
      console: REDACTED,
    });
    expect(shown.data.match.team1?.players).toHaveLength(5);
    expect(shown.id).toBe(env.id);
  });

  test("a receiver's echo of the body is scrubbed before it is stored", () => {
    const body = JSON.stringify(sampleEnvelope('match.ready'));
    const scrubbed = scrubSecrets(`you sent: ${body}`, body);
    expect(scrubbed).not.toContain('k3Lp9QzT2w');
    expect(scrubbed).not.toContain('203.0.113.10');
    expect(scrubbed).not.toContain('steam://connect');
    expect(scrubSecrets('plain text', 'not json')).toBe('plain text');
  });
});

test.describe('SSRF rules for webhook targets', () => {
  test('address classes', () => {
    expect(classifyAddress('8.8.8.8')).toBe('public');
    expect(classifyAddress('10.1.2.3')).toBe('private');
    expect(classifyAddress('172.20.0.1')).toBe('private');
    expect(classifyAddress('192.168.50.196')).toBe('private');
    expect(classifyAddress('100.64.1.1')).toBe('private');
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('169.254.169.254')).toBe('link_local');
    expect(classifyAddress('0.0.0.0')).toBe('reserved');
    expect(classifyAddress('224.0.0.1')).toBe('reserved');
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('::')).toBe('reserved');
    expect(classifyAddress('fe80::1')).toBe('link_local');
    expect(classifyAddress('fd00::1')).toBe('private');
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('link_local');
    expect(classifyAddress('64:ff9b::a9fe:a9fe')).toBe('link_local');
    expect(classifyAddress('2606:4700::1111')).toBe('public');
  });

  test('URL checks: scheme, credentials, literal addresses, the LAN switch', () => {
    const blocked = (url: string, allowPrivate = false) => {
      try {
        checkWebhookUrlSyntax(url, allowPrivate);
        return null;
      } catch (e) {
        return (e as WebhookTargetError).code;
      }
    };
    expect(blocked('https://example.com/hook')).toBeNull();
    expect(blocked('ftp://example.com/hook')).toBe('invalid_url');
    expect(blocked('https://user:pw@example.com/hook')).toBe('invalid_url');
    expect(blocked('not a url')).toBe('invalid_url');
    expect(blocked('http://127.0.0.1:3000/hook')).toBe('blocked_address');
    expect(blocked('http://localhost/hook')).toBe('blocked_address');
    expect(blocked('http://[::1]/hook')).toBe('blocked_address');
    expect(blocked('http://192.168.1.10/hook')).toBe('blocked_address');
    expect(blocked('http://192.168.1.10/hook', true)).toBeNull();
    expect(blocked('http://127.0.0.1/hook', true)).toBeNull();
    // Never, whatever the switch says: cloud metadata lives here.
    expect(blocked('http://169.254.169.254/latest/meta-data', true)).toBe('blocked_address');
    expect(blocked('http://[fe80::1]/hook', true)).toBe('blocked_address');
  });

  test('every resolved address is checked, and the checked one is used', async () => {
    const lookup = (addresses: string[]) => async () =>
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    const url = new URL('https://hooks.example.com/x');
    await expect(resolveWebhookTarget(url, false, lookup(['93.184.216.34']))).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
    // One bad address among good ones is enough to refuse (rebinding tricks).
    await expect(resolveWebhookTarget(url, false, lookup(['93.184.216.34', '10.0.0.5']))).rejects.toMatchObject({
      code: 'blocked_address',
    });
    await expect(resolveWebhookTarget(url, true, lookup(['169.254.169.254']))).rejects.toMatchObject({
      code: 'blocked_address',
    });
    await expect(
      resolveWebhookTarget(url, false, async () => {
        throw new Error('ENOTFOUND');
      })
    ).rejects.toMatchObject({ code: 'dns_failed' });
  });
});

test.describe('which events a match change means', () => {
  const opts = { now: 1_000_000, scoreThrottleMs: 5_000 };
  const facts = (over: Partial<CurrentFacts> = {}): CurrentFacts => ({
    status: 'pending',
    connectKey: null,
    mapNumber: 0,
    mapScore: { team1: 0, team2: 0 },
    finishedMaps: [],
    ...over,
  });
  const run = (steps: Array<{ facts: CurrentFacts; now?: number }>) => {
    let state: AnnouncedState | null = null;
    const out: string[][] = [];
    for (const step of steps) {
      const r = diffMatch(state, step.facts, { ...opts, now: step.now ?? opts.now });
      out.push(r.events.map((e) => e.type + (e.reason ? `:${e.reason}` : '') + (e.mapNumber !== undefined ? `#${e.mapNumber}` : '')));
      state = r.next;
    }
    return out;
  };

  test('a Bo3 from loaded to finished', () => {
    expect(
      run([
        { facts: facts({ status: 'ready' }) },
        { facts: facts({ status: 'loaded', connectKey: 'A' }) },
        { facts: facts({ status: 'live', connectKey: 'A' }) },
        { facts: facts({ status: 'live', connectKey: 'A', mapScore: { team1: 1, team2: 0 } }), now: 1_010_000 },
        { facts: facts({ status: 'live', connectKey: 'A', finishedMaps: [0], mapScore: { team1: 13, team2: 5 } }), now: 1_020_000 },
        { facts: facts({ status: 'live', connectKey: 'A', finishedMaps: [0], mapNumber: 1 }), now: 1_030_000 },
        { facts: facts({ status: 'completed', finishedMaps: [0, 1], mapNumber: 1 }), now: 1_040_000 },
      ])
    ).toEqual([
      [],
      ['match.ready'],
      ['match.live', 'match.map_started#0'],
      ['match.score_updated'],
      ['match.map_ended#0'],
      ['match.map_started#1'],
      ['match.map_ended#1', 'match.finished'],
    ]);
  });

  test('score updates are throttled, and the latest score is delivered later', () => {
    let state: AnnouncedState | null = null;
    const step = (f: CurrentFacts, now: number) => {
      const r = diffMatch(state, f, { now, scoreThrottleMs: 5_000 });
      state = r.next;
      return r;
    };
    step(facts({ status: 'live', connectKey: 'A' }), 0);
    expect(step(facts({ status: 'live', connectKey: 'A', mapScore: { team1: 1, team2: 0 } }), 10_000).events.map((e) => e.type)).toEqual([
      'match.score_updated',
    ]);
    const throttled = step(facts({ status: 'live', connectKey: 'A', mapScore: { team1: 2, team2: 0 } }), 11_000);
    expect(throttled.events).toEqual([]);
    expect(throttled.recheckAt).toBe(15_000);
    const later = step(facts({ status: 'live', connectKey: 'A', mapScore: { team1: 2, team2: 0 } }), 15_000);
    expect(later.events.map((e) => e.type)).toEqual(['match.score_updated']);
  });

  test('restart, reallocation, cancel and a match first seen when over', () => {
    expect(
      run([
        { facts: facts({ status: 'live', connectKey: 'A' }) },
        { facts: facts({ status: 'loaded', connectKey: 'B' }) },
        { facts: facts({ status: 'loaded', connectKey: 'C' }) },
        { facts: facts({ status: 'ready' }) },
        { facts: facts({ status: 'cancelled' }) },
      ])
    ).toEqual([
      ['match.ready', 'match.live', 'match.map_started#0'],
      ['match.reset:restarted', 'match.ready'],
      ['match.ready'],
      ['match.reset:unassigned'],
      ['match.cancelled:cancelled'],
    ]);
    expect(run([{ facts: facts({ status: 'completed', finishedMaps: [0] }) }])).toEqual([[]]);
  });
});

test.describe('sample payloads (test events and docs)', () => {
  test('every type has one, shaped like the real thing and marked test', () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      const env = sampleEnvelope(type);
      expect(env).toMatchObject({ type, api_version: '1', test: true });
      expect(env.data.match.team1?.players.every((p) => /^\d{17}$/.test(p.steam_id64))).toBe(true);
      expect(env.data.match.team1?.external_id).toBeTruthy();
      expect(typeof env.data.sequence).toBe('number');
    }
    const ready = sampleEnvelope('match.ready').data.match.connect;
    expect(ready).toEqual({
      host: '203.0.113.10',
      port: 27015,
      password: 'k3Lp9QzT2w',
      steam_url: 'steam://connect/203.0.113.10:27015/k3Lp9QzT2w',
      console: 'connect 203.0.113.10:27015; password k3Lp9QzT2w',
    });
    expect(sampleEnvelope('match.finished').data.match.connect).toBeNull();
    expect(connectLinks('10.0.0.5', 27016, null).steam_url).toBe('steam://connect/10.0.0.5:27016');
    expect(connectLinks('2001:db8::1', 27015, 'pw').steam_url).toBe('steam://connect/[2001:db8::1]:27015/pw');
  });
});

test.describe('one delivery attempt', () => {
  let server: http.Server;
  let origin: string;
  const seen: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        if (req.url === '/slow') return; // never answers
        if (req.url === '/redirect') return res.writeHead(302, { location: '/ok' }).end();
        if (req.url === '/big') return res.writeHead(200).end('x'.repeat(200_000));
        if (req.url === '/busy') return res.writeHead(503, { 'retry-after': '7' }).end('busy');
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('sends the body and headers; refuses loopback unless allowed', async () => {
    const blocked = await attemptDelivery({ url: `${origin}/ok`, body: '{}', headers: {}, allowPrivate: false });
    expect(blocked).toMatchObject({ statusCode: null, blocked: true });
    expect(seen).toHaveLength(0);

    const ok = await attemptDelivery({ url: `${origin}/ok`, body: '{"a":1}', headers: { 'X-AT-Event': 'match.ready' }, allowPrivate: true });
    expect(ok).toMatchObject({ statusCode: 204, error: null });
    expect(seen.at(-1)?.body).toBe('{"a":1}');
    expect(seen.at(-1)?.headers['x-at-event']).toBe('match.ready');
    expect(seen.at(-1)?.headers['content-type']).toBe('application/json');
  });

  test('timeouts, redirects not followed, answers cut at 64 KB, Retry-After read', async () => {
    const slow = await attemptDelivery({ url: `${origin}/slow`, body: '{}', headers: {}, allowPrivate: true, timeoutMs: 300 });
    expect(slow.statusCode).toBeNull();
    expect(slow.error).toContain('timed out');
    const redirect = await attemptDelivery({ url: `${origin}/redirect`, body: '{}', headers: {}, allowPrivate: true });
    expect(redirect.statusCode).toBe(302);
    const big = await attemptDelivery({ url: `${origin}/big`, body: '{}', headers: {}, allowPrivate: true });
    expect(big.responseText.length).toBe(64 * 1024);
    const busy = await attemptDelivery({ url: `${origin}/busy`, body: '{}', headers: {}, allowPrivate: true });
    expect(busy).toMatchObject({ statusCode: 503, retryAfter: '7' });
  });
});

test.describe('teams API input', () => {
  test('Steam64 ids', () => {
    expect(isValidSteam64('76561198000000001')).toBe(true);
    expect(isValidSteam64('76561197960265728')).toBe(false); // account id 0
    expect(isValidSteam64('7656119800000000')).toBe(false); // 16 digits
    expect(isValidSteam64('STEAM_0:1:1234')).toBe(false);
    expect(isValidSteam64(Number('76561198000000001'))).toBe(false); // a number loses precision
  });

  test('a team: externalId, name, tag, players; every problem listed', () => {
    const ok = parseTeamInput({ name: ' Ninjas ', tag: 'NIP', players: [{ steamId: '76561198000000001', name: 'a' }] }, 'ext-1');
    expect(ok).toEqual({ externalId: 'ext-1', name: 'Ninjas', tag: 'NIP', players: [{ steamId: '76561198000000001', name: 'a' }] });
    try {
      parseTeamInput({
        externalId: 'has space',
        name: '',
        players: [
          { steamId: '123', name: 'x' },
          { steamId: '76561198000000001', name: 'y' },
          { steamId: '76561198000000001', name: 'z' },
        ],
      });
      throw new Error('should have thrown');
    } catch (e) {
      const errors = (e as { details?: { errors: string[] } }).details?.errors ?? [];
      expect(errors.join('\n')).toContain('externalId');
      expect(errors.join('\n')).toContain('name is required');
      expect(errors.join('\n')).toContain('players[0].steamId');
      expect(errors.join('\n')).toContain('listed twice');
    }
  });
});
