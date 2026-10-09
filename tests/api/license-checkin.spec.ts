import http from 'http';
import type { AddressInfo } from 'net';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  CHECKIN_FIELDS,
  DEFAULT_CHECKIN_URL,
  EVENT_PROMPT_INTERVAL_MS,
  LicenseCheckin,
  NOTICE_MAX_LENGTH,
  SETTING,
  activityOutsideDates,
  buildCheckinBody,
  cleanNotice,
  keyIdOf,
  parseCheckinResponse,
  promptAllowed,
  resolveCheckinUrl,
  summarizeActivity,
  type Activity,
  type CheckinStore,
} from '../../api/src/services/license/checkin';

/**
 * The daily license check-in (api/src/services/license/checkin.ts): the pure
 * rules, then the check-in itself in process against a local fake endpoint
 * (the real autotournament.gg is never called from tests: CI sets
 * LICENSE_CHECKIN_URL=off, and NODE_ENV=test has no check-in by default).
 *
 * The contract is the website's POST /api/licenses/checkin
 * (Auto-Tournament/website src/lib/license/checkin.ts).
 *
 * @tag api
 */

/** An ATL1 token that decodes (the check-in does not check the signature; the site does). */
function token(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ v: 1, kid: 'test', ...payload }), 'utf8').toString('base64url');
  return `ATL1.${body}.${'A'.repeat(86)}`;
}

const KEY = token({ id: 'lic_checkin01', kind: 'year' });
const NO_ACTIVITY: Activity = { matchesPlayed: 0, tournamentsLive: 0, maxTournamentTeams: 0 };

function memoryStore(initial: Record<string, string> = {}): CheckinStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
}

/** Noon UTC of a day, in unix seconds: the same local day in any usual time zone. */
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

test.describe('license check-in: rules', { tag: ['@api'] }, () => {
  test('where it goes: the real endpoint, a local override, or nowhere', () => {
    expect(resolveCheckinUrl({})).toBe(DEFAULT_CHECKIN_URL);
    expect(DEFAULT_CHECKIN_URL).toBe('https://autotournament.gg/api/licenses/checkin');
    expect(resolveCheckinUrl({ NODE_ENV: 'test' })).toBeNull();
    for (const off of ['off', 'OFF', 'false', '0', 'none']) {
      expect(resolveCheckinUrl({ LICENSE_CHECKIN_URL: off })).toBeNull();
    }
    expect(resolveCheckinUrl({ LICENSE_CHECKIN_URL: 'http://127.0.0.1:9/checkin', NODE_ENV: 'test' })).toBe(
      'http://127.0.0.1:9/checkin'
    );
    expect(resolveCheckinUrl({ LICENSE_CHECKIN_URL: 'https://staging.example/api/licenses/checkin' })).toBe(
      'https://staging.example/api/licenses/checkin'
    );
    // Plain http only to this machine; anything else is no check-in rather than a guess.
    expect(resolveCheckinUrl({ LICENSE_CHECKIN_URL: 'http://example.com/checkin' })).toBeNull();
    expect(resolveCheckinUrl({ LICENSE_CHECKIN_URL: 'not a url' })).toBeNull();
  });

  test('the body is exactly the contract, in order, with counts that are never negative', () => {
    const body = buildCheckinBody({
      key: KEY,
      keyId: 'lic_checkin01',
      instanceId: '0b7f7c1e-8d5a-4a57-9a39-1f4f3c2b8d10',
      serverCount: null,
      version: '3.0.0',
      now: new Date('2026-09-29T10:00:00Z'),
      activity: { matchesPlayed: 5, tournamentsLive: -1, maxTournamentTeams: 1.5 },
      declared: 'testing',
    });
    expect(Object.keys(body)).toEqual([...CHECKIN_FIELDS]);
    expect(body).toEqual({
      token: KEY,
      key_id: 'lic_checkin01',
      instance_id: '0b7f7c1e-8d5a-4a57-9a39-1f4f3c2b8d10',
      server_count: 0,
      platform_version: '3.0.0',
      sent_at: '2026-09-29T10:00:00.000Z',
      matches_played: 5,
      tournaments_live: 0,
      max_tournament_teams: 0,
      declared: 'testing',
      product: 'platform',
      public_url: null,
    });
  });

  test('the answer can carry the newest key and where the license stands', () => {
    const r = parseCheckinResponse({ ok: true, lease: 'ATL1.a.b', license: { status: 'past_due', valid_until: '2026-11-08', stops_on: '2026-11-22' } });
    expect(r).toEqual({ usage: null, notice: null, lease: 'ATL1.a.b', license: { status: 'past_due', validUntil: '2026-11-08', stopsOn: '2026-11-22' } });
    expect(parseCheckinResponse({ ok: true, lease: 'nope', license: { status: 'weird' } })).toEqual({ usage: null, notice: null });
    expect(parseCheckinResponse({ ok: true, license: { status: 'in_use_elsewhere', stops_on: '2026-10-10' } })?.license?.status).toBe('in_use_elsewhere');
  });

  test('the key id comes from the token; anything else is no key', () => {
    expect(keyIdOf(KEY)).toBe('lic_checkin01');
    expect(keyIdOf(null)).toBeNull();
    expect(keyIdOf('hello')).toBeNull();
    expect(keyIdOf(token({ id: '' }))).toBeNull();
  });

  test('only a 200 { ok: true } answer is understood; the notice is plain, short text', () => {
    expect(parseCheckinResponse(null)).toBeNull();
    expect(parseCheckinResponse({ ok: false })).toBeNull();
    expect(parseCheckinResponse({ ok: true })).toEqual({ usage: null, notice: null });
    const full = parseCheckinResponse({
      ok: true,
      usage: { instances: 2, servers: 8, max_servers: 6, window_days: 30, overuse: true, outside_dates: false },
      notice: 'Hello\u0000 there\n',
    });
    expect(full).toEqual({
      usage: { instances: 2, servers: 8, maxServers: 6, windowDays: 30, abovePack: true, outsideDates: false },
      notice: 'Hello there',
    });
    // A usage block that is off in any field is dropped, not guessed at.
    expect(parseCheckinResponse({ ok: true, usage: { instances: -1 } })?.usage).toBeNull();
    const long = cleanNotice('x'.repeat(NOTICE_MAX_LENGTH + 50));
    expect(long?.length).toBe(NOTICE_MAX_LENGTH);
    expect(cleanNotice(42)).toBeNull();
    expect(cleanNotice('   ')).toBeNull();
  });

  test('activity counts: finished matches, tournaments with activity, the largest one', () => {
    expect(
      summarizeActivity(
        [{ tournament_id: 1 }, { tournament_id: 1 }, { tournament_id: null }],
        [2],
        [
          { id: 1, team_ids: JSON.stringify(['a', 'b', 'c', 'd']) },
          { id: 2, team_ids: JSON.stringify(['a', 'b']) },
          { id: 3, team_ids: JSON.stringify(new Array(32).fill('x')) },
        ]
      )
    ).toEqual({ matchesPlayed: 3, tournamentsLive: 2, maxTournamentTeams: 4 });
    expect(summarizeActivity([], [], [{ id: 1, team_ids: 'not json' }])).toEqual(NO_ACTIVITY);
  });

  test('outside the event dates: light testing is not asked about, real activity is', () => {
    const window = { validFrom: '2026-10-03', validTo: '2026-10-05' };
    // Two matches a day outside the dates is testing.
    expect(activityOutsideDates(window, [noon('2026-09-20'), noon('2026-09-20')], [])).toBe(false);
    // A day of grace on either side.
    const inGrace = [noon('2026-10-02'), noon('2026-10-02'), noon('2026-10-02'), noon('2026-10-06')];
    expect(activityOutsideDates(window, inGrace, [])).toBe(false);
    // Three on one day outside, or a tournament started outside, is asked about.
    expect(activityOutsideDates(window, [noon('2026-11-01'), noon('2026-11-01'), noon('2026-11-01')], [])).toBe(
      true
    );
    expect(activityOutsideDates(window, [], [noon('2026-12-01')])).toBe(true);
    // Inside the dates, anything goes.
    expect(activityOutsideDates(window, new Array(50).fill(noon('2026-10-04')), [noon('2026-10-03')])).toBe(false);
  });

  test('the question is asked at most once per 30 days, and never after "don\'t ask again"', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(promptAllowed({ askedAt: null, mutedFor: null }, 'lic_a', now)).toBe(true);
    const recent = new Date(now.getTime() - EVENT_PROMPT_INTERVAL_MS + 60_000).toISOString();
    expect(promptAllowed({ askedAt: recent, mutedFor: null }, 'lic_a', now)).toBe(false);
    const old = new Date(now.getTime() - EVENT_PROMPT_INTERVAL_MS).toISOString();
    expect(promptAllowed({ askedAt: old, mutedFor: null }, 'lic_a', now)).toBe(true);
    expect(promptAllowed({ askedAt: null, mutedFor: 'lic_a' }, 'lic_a', now)).toBe(false);
    // Muted for another license: a new key is asked about again.
    expect(promptAllowed({ askedAt: null, mutedFor: 'lic_a' }, 'lic_b', now)).toBe(true);
  });

  test('what admins read never accuses anyone', () => {
    const localesDir = path.join(__dirname, '../../client/src/locales/en/translation');
    const en = JSON.parse(readFileSync(path.join(localesDir, 'dashboardSettings.json'), 'utf8')) as {
      license: Record<string, unknown>;
    };
    const text = JSON.stringify(en.license).toLowerCase();
    for (const word of ['reuse', 'violation', 'flagged', 'cheat', 'illegal', 'abuse']) {
      expect(text, word).not.toContain(word);
    }
    // Every locale has the new strings.
    const locales = readdirSync(path.join(__dirname, '../../client/src/locales')).filter((d) => d !== 'brackets-viewer');
    for (const locale of locales) {
      const file = path.join(__dirname, '../../client/src/locales', locale, 'translation/dashboardSettings.json');
      const license = (JSON.parse(readFileSync(file, 'utf8')) as { license: Record<string, any> }).license;
      expect(Object.keys(license.eventPrompt ?? {}).sort(), locale).toEqual(Object.keys(en.license.eventPrompt as object).sort());
      expect(Object.keys(license.checkin ?? {}).sort(), locale).toEqual(Object.keys(en.license.checkin as object).sort());
    }
  });
});

test.describe('license check-in: against a local endpoint', { tag: ['@api'] }, () => {
  let server: http.Server;
  let origin = '';
  const received: Array<{ path: string; contentType: string | undefined; body: Record<string, unknown> }> = [];
  let answer: { status: number; body: string } = { status: 200, body: '{"ok":true}' };
  let hold: Promise<void> | null = null;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', async () => {
        received.push({
          path: req.url ?? '',
          contentType: req.headers['content-type'],
          body: JSON.parse(raw || '{}') as Record<string, unknown>,
        });
        if (hold) await hold;
        res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(answer.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test.beforeEach(() => {
    received.length = 0;
    answer = { status: 200, body: '{"ok":true}' };
    hold = null;
  });

  function checkin(
    options: {
      key?: string | null;
      store?: ReturnType<typeof memoryStore>;
      now?: () => Date;
      url?: string;
      activity?: Activity;
    } = {}
  ) {
    const store = options.store ?? memoryStore();
    let key = options.key === undefined ? KEY : options.key;
    const instance = new LicenseCheckin({
      store,
      getKey: async () => key,
      countServers: async () => 4,
      activity: async () => options.activity ?? { matchesPlayed: 12, tournamentsLive: 1, maxTournamentTeams: 8 },
      version: '3.0.0',
      url: options.url ?? `${origin}/api/licenses/checkin`,
      now: options.now,
      newId: () => '0b7f7c1e-8d5a-4a57-9a39-1f4f3c2b8d10',
    });
    return { instance, store, setKey: (k: string | null) => (key = k) };
  }

  test('reserve: asks /reserve with the servers now and the ones to add, and reads the answer', async () => {
    answer = { status: 200, body: JSON.stringify({ ok: true, allowed: false, max_servers: 10, servers_elsewhere: 6, reason: 'server_limit' }) };
    const { instance } = checkin();
    expect(await instance.reserve(3, 2)).toEqual({ result: 'refused', reason: 'server_limit', maxServers: 10, elsewhere: 6 });
    expect(received[0].path).toBe('/api/licenses/reserve');
    expect(received[0].body).toMatchObject({ server_count: 3, adding: 2, product: 'platform' });
    answer = { status: 200, body: JSON.stringify({ ok: true, allowed: true, max_servers: 10, servers_elsewhere: 0 }) };
    expect(await instance.reserve(3, 2)).toEqual({ result: 'allowed' });
    answer = { status: 503, body: '{}' };
    expect(await instance.reserve(3, 2)).toEqual({ result: 'unreachable' });
    expect(await checkin({ url: 'off' }).instance.reserve(3, 2)).toEqual({ result: 'skipped' });
  });

  test('checked in recently: within 3 days of the last successful check-in', async () => {
    let now = new Date('2026-10-01T10:00:00Z');
    const { instance } = checkin({ now: () => now });
    expect(await instance.checkedInRecently()).toBe(false);
    await instance.run({ force: true });
    now = new Date('2026-10-04T09:00:00Z');
    expect(await instance.checkedInRecently()).toBe(true);
    now = new Date('2026-10-04T11:00:00Z');
    expect(await instance.checkedInRecently()).toBe(false);
  });

  test('no key: no request at all', async () => {
    const { instance, store } = checkin({ key: null });
    expect(await instance.run({ force: true })).toBe('no-key');
    expect(received).toHaveLength(0);
    expect(store.data.size).toBe(0);
    expect(await instance.status(false)).toMatchObject({ lastAt: null, notice: null });
  });

  test('turned off: no request, even with a key', async () => {
    const { instance } = checkin({ url: 'off' });
    expect(await instance.run({ force: true })).toBe('disabled');
    expect(received).toHaveLength(0);
  });

  test('with a key: sends the contract as JSON and keeps the time and the notice', async () => {
    answer = {
      status: 200,
      body: JSON.stringify({
        ok: true,
        usage: { instances: 1, servers: 4, max_servers: 6, window_days: 30, overuse: false, outside_dates: false },
        notice: 'All good.',
      }),
    };
    const now = new Date('2026-09-29T10:00:00Z');
    const { instance, store } = checkin({ now: () => now });
    expect(await instance.run()).toBe('sent');
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe('/api/licenses/checkin');
    expect(received[0].contentType).toBe('application/json');
    expect(Object.keys(received[0].body)).toEqual([...CHECKIN_FIELDS]);
    expect(received[0].body).toMatchObject({
      token: KEY,
      key_id: 'lic_checkin01',
      instance_id: '0b7f7c1e-8d5a-4a57-9a39-1f4f3c2b8d10',
      server_count: 4,
      platform_version: '3.0.0',
      sent_at: now.toISOString(),
      matches_played: 12,
      tournaments_live: 1,
      max_tournament_teams: 8,
      declared: 'none',
    });
    expect(store.data.get(SETTING.instanceId)).toBe('0b7f7c1e-8d5a-4a57-9a39-1f4f3c2b8d10');
    expect(store.data.get(SETTING.countedSince)).toBe(String(now.getTime() / 1000));
    const status = await instance.status(true);
    expect(status).toMatchObject({ lastAt: now.toISOString(), notice: 'All good.', sent: [...CHECKIN_FIELDS] });
    expect(status.privacyUrl).toContain('autotournament.gg/privacy');

    // A second run straight after is skipped; a forced one (a new key) is not.
    expect(await instance.run()).toBe('recent');
    expect(received).toHaveLength(1);
    expect(await instance.run({ force: true })).toBe('sent');
    expect(received).toHaveLength(2);
  });

  test('any other answer changes nothing and never throws', async () => {
    const { instance, store } = checkin();
    for (const bad of [
      { status: 500, body: 'boom' },
      { status: 401, body: '{"error":"not a valid license key"}' },
      { status: 200, body: 'not json' },
      { status: 200, body: '{"ok":false}' },
    ]) {
      answer = bad;
      expect(await instance.run({ force: true })).toBe('failed');
    }
    expect(store.data.has(SETTING.lastAt)).toBe(false);
    // Nothing listening: failed, quietly.
    const closed = checkin({ url: 'http://127.0.0.1:9/nothing' });
    expect(await closed.instance.run({ force: true })).toBe('failed');
  });

  test('the key changing on the way: the answer is dropped, and a forced run follows', async () => {
    let release!: () => void;
    hold = new Promise<void>((resolve) => (release = resolve));
    const { instance, store, setKey } = checkin();
    const first = instance.run();
    await expect.poll(() => received.length).toBe(1);
    const newKey = token({ id: 'lic_checkin02', kind: 'year' });
    setKey(newKey);
    const second = instance.run({ force: true }); // the running one, with a forced run queued after it
    hold = null;
    release();
    expect(await first).toBe('failed');
    expect(await second).toBe('failed');
    await expect.poll(() => received.length).toBe(2);
    expect(received[1].body.key_id).toBe('lic_checkin02');
    await expect.poll(() => store.data.has(SETTING.lastAt)).toBe(true);
  });

  test('the event question: asked after real activity outside the dates, answered once, sent as declared', async () => {
    const event = { id: 'lic_event01', kind: 'event', validFrom: '2026-10-03', validTo: '2026-10-05' };
    let now = new Date('2026-11-02T12:00:00Z');
    const { instance, store } = checkin({ key: token({ id: 'lic_event01', kind: 'event' }), now: () => now });
    const busy = async () => ({
      matchFinishedAt: [noon('2026-11-01'), noon('2026-11-01'), noon('2026-11-01')],
      tournamentStartedAt: [],
    });
    const quiet = async () => ({ matchFinishedAt: [noon('2026-11-01')], tournamentStartedAt: [] });

    expect(await instance.eventPrompt(null, busy)).toBeNull();
    expect(await instance.eventPrompt({ ...event, kind: 'year' }, busy)).toBeNull();
    expect(await instance.eventPrompt(event, quiet)).toMatchObject({ shouldAsk: false, declared: 'none' });
    expect(await instance.eventPrompt(event, busy)).toMatchObject({
      shouldAsk: true,
      validFrom: '2026-10-03',
      validTo: '2026-10-05',
      declared: 'none',
      declaredAt: null,
    });

    await instance.answerEventPrompt('testing', event.id, 'steam:76561198000000001');
    const declaration = JSON.parse(store.data.get(SETTING.declaration) ?? '{}');
    expect(declaration).toMatchObject({ answer: 'testing', by: 'steam:76561198000000001', licenseId: event.id });
    expect(await instance.eventPrompt(event, busy)).toMatchObject({ shouldAsk: false, declared: 'testing' });

    expect(await instance.run({ force: true })).toBe('sent');
    expect(received.at(-1)?.body.declared).toBe('testing');

    // 30 days later it may ask again; "don't ask again" stops it for this license.
    now = new Date(now.getTime() + EVENT_PROMPT_INTERVAL_MS + 1000);
    const later = async () => ({ matchFinishedAt: [], tournamentStartedAt: [noon('2026-12-02')] });
    expect(await instance.eventPrompt(event, later)).toMatchObject({ shouldAsk: true });
    await instance.answerEventPrompt('dont_ask', event.id, 'steam:76561198000000001');
    now = new Date(now.getTime() + 2 * EVENT_PROMPT_INTERVAL_MS);
    expect(await instance.eventPrompt(event, later)).toMatchObject({ shouldAsk: false, declared: 'testing' });

    // An answer about another license is not sent with this one.
    const other = checkin({ store, key: token({ id: 'lic_event02', kind: 'event' }) });
    expect(await other.instance.run({ force: true })).toBe('sent');
    expect(received.at(-1)?.body.declared).toBe('none');
  });
});
