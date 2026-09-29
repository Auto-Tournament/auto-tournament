import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  createEndpoint,
  deleteAllEndpoints,
  expectSigned,
  newBin,
  received,
  reconcile,
  setAllowPrivate,
  setTiming,
  sinkBehaviour,
  sinkUrl,
  waitForTypes,
} from '../helpers/webhooks';
import { parseSignatureHeader, verifySignature } from '../../api/src/services/webhooks/signing';

/**
 * Integrator webhooks, end to end against the API's own test sink:
 *
 * - endpoints: SSRF rules on the URL, the secret shown once, event types;
 * - a test event per type: signed, `test: true`, shaped like the real one
 *   (connect details and steam:// link included);
 * - retries with backoff until a 2xx, the attempt log, resend (same event
 *   id, new delivery id), secret rotation (both secrets sign for the grace);
 * - the delivery log never shows connect details, not even in a receiver's
 *   echo of the body;
 * - an endpoint that keeps failing is switched off, with a notice.
 *
 * @tag api
 * @tag webhooks
 */

const PASSWORD = 'k3Lp9QzT2w'; // the sample connect password

async function delivery(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/webhooks/deliveries/${id}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).delivery as {
    id: string;
    eventId: string;
    status: string;
    attempts: number;
    lastResponse: string | null;
    payload: unknown;
    attemptLog: Array<{ attempt: number; statusCode: number | null }>;
  };
}

async function sendTest(request: APIRequestContext, endpointId: string, type: string): Promise<string> {
  const res = await request.post(`/api/webhooks/${endpointId}/test`, { data: { type } });
  expect(res.status(), await res.text()).toBe(202);
  return (await res.json()).delivery.id as string;
}

test.describe.serial('Integrator webhooks', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await setTiming(request, { reset: true, retryScale: 0.0005, scoreThrottleMs: 0 });
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await deleteAllEndpoints(request);
    await setTiming(request, { reset: true });
    await setAllowPrivate(request, false);
  });

  test('target URLs: private and local need the LAN switch, link-local never', async ({ request }) => {
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, false);
    const url = await sinkUrl(request, newBin());
    const refused = await request.post('/api/webhooks', { data: { url } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain('private and local');

    for (const bad of ['http://192.168.1.20/hook', 'http://localhost/hook', 'ftp://example.com', 'https://u:p@example.com']) {
      expect((await request.post('/api/webhooks', { data: { url: bad } })).status(), bad).toBe(400);
    }

    await setAllowPrivate(request, true);
    const metadata = await request.post('/api/webhooks', { data: { url: 'http://169.254.169.254/latest/meta-data' } });
    expect(metadata.status()).toBe(400);
    const unknownType = await request.post('/api/webhooks', { data: { url, eventTypes: ['match.exploded'] } });
    expect(unknownType.status()).toBe(400);

    const created = await createEndpoint(request, { url, eventTypes: ['match.ready', 'match.finished'], description: 'CI' });
    const list = await (await request.get('/api/webhooks')).json();
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect(list.endpoints.find((e: { id: string }) => e.id === created.id)).toMatchObject({
      url,
      active: true,
      eventTypes: ['match.ready', 'match.finished'],
    });
    expect(list.eventTypes.map((e: { type: string }) => e.type)).toContain('match.ready');
  });

  test('a test event per type: signed, test: true, shaped like the real one', async ({ request }) => {
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, true);
    const bin = newBin('test');
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), source: 'ci-ntlan' });

    await sendTest(request, endpoint.id, 'match.ready');
    await sendTest(request, endpoint.id, 'match.finished');
    // Only the test events: a match another spec left in play may send real ones here too.
    const got = (await waitForTypes(request, bin, ['match.ready', 'match.finished'])).filter((r) => r.envelope.test);
    for (const r of got) expectSigned(r, endpoint.secret);

    const ready = got.find((r) => r.envelope.type === 'match.ready')!.envelope;
    expect(ready).toMatchObject({ test: true, api_version: '1' });
    expect(ready.id).toMatch(/^evt_/);
    expect(ready.data.match.connect).toMatchObject({
      password: PASSWORD,
      steam_url: expect.stringMatching(/^steam:\/\/connect\/[^/]+:\d+\/k3Lp9QzT2w$/),
    });
    expect(ready.data.match.team1?.external_id).toBeTruthy();
    expect(ready.data.match.team1?.players.every((p) => /^\d{17}$/.test(p.steam_id64))).toBe(true);
    const finished = got.find((r) => r.envelope.type === 'match.finished')!.envelope;
    expect(finished.data.match.connect).toBeNull();
    expect(finished.data.match.winner).toMatchObject({ side: 'team1' });

    // A switched-off endpoint gets no test events.
    await request.patch(`/api/webhooks/${endpoint.id}`, { data: { active: false } });
    expect((await request.post(`/api/webhooks/${endpoint.id}/test`, { data: { type: 'match.live' } })).status()).toBe(409);
  });

  test('retries until a 2xx, resend keeps the event id, the log hides connect details', async ({ request }) => {
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, true);
    const bin = newBin('retry');
    // Subscribed to a type nothing else here sends: test events go out whatever the subscription.
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), eventTypes: ['match.reset'] });

    // Two failures (echoing the body back), then success.
    await sinkBehaviour(request, bin, { status: 500, times: 2, echo: true });
    const id = await sendTest(request, endpoint.id, 'match.ready');
    await expect.poll(async () => (await delivery(request, id)).status, { timeout: 30_000 }).toBe('succeeded');
    const d = await delivery(request, id);
    expect(d.attempts).toBe(3);
    expect(d.attemptLog.map((a) => a.statusCode)).toEqual([500, 500, 200]);

    const mine = async () => (await received(request, bin)).filter((r) => r.envelope.test);
    const got = (await mine()).filter((r) => r.headers['x-at-delivery'] === id);
    expect(got).toHaveLength(3);
    // Same body every attempt; a fresh signature (timestamp) each time.
    expect(new Set(got.map((r) => r.body)).size).toBe(1);
    expect(new Set(got.map((r) => r.headers['x-at-delivery']))).toEqual(new Set([id]));
    for (const r of got) expectSigned(r, endpoint.secret);

    // The log: redacted payload, scrubbed echo.
    const logText = JSON.stringify(d);
    expect(logText).not.toContain(PASSWORD);
    expect(logText).not.toContain('steam://connect');
    expect(logText).toContain('[redacted]');
    const listText = await (await request.get(`/api/webhooks/${endpoint.id}/deliveries`)).text();
    expect(listText).not.toContain(PASSWORD);

    // Resend: a new delivery of the same event.
    const resend = await request.post(`/api/webhooks/deliveries/${id}/resend`);
    expect(resend.status(), await resend.text()).toBe(202);
    const copy = (await resend.json()).delivery as { id: string; eventId: string };
    expect(copy.id).not.toBe(id);
    expect(copy.eventId).toBe(d.eventId);
    await expect.poll(async () => (await mine()).length, { timeout: 20_000 }).toBe(4);
    const last = (await mine())[3];
    expect(last.headers['x-at-delivery']).toBe(copy.id);
    expect(last.envelope.id).toBe(got[0].envelope.id);
  });

  test('rotating the secret: both sign during the grace, only the new one after', async ({ request }) => {
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, true);
    const bin = newBin('rotate');
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), eventTypes: ['match.reset'] });

    const rotated = await request.post(`/api/webhooks/${endpoint.id}/rotate-secret`, { data: { graceHours: 1 } });
    expect(rotated.ok(), await rotated.text()).toBe(true);
    const newSecret = (await rotated.json()).secret as string;
    expect(newSecret).not.toBe(endpoint.secret);
    const mine = async () => (await received(request, bin)).filter((r) => r.envelope.test);
    await sendTest(request, endpoint.id, 'match.live');
    await expect.poll(async () => (await mine()).length, { timeout: 20_000 }).toBe(1);
    const [first] = await mine();
    expect(parseSignatureHeader(first.headers['x-at-signature'])?.signatures).toHaveLength(2);
    expect(verifySignature(newSecret, first.headers['x-at-signature'], first.body).ok).toBe(true);
    expect(verifySignature(endpoint.secret, first.headers['x-at-signature'], first.body).ok).toBe(true);

    const again = await request.post(`/api/webhooks/${endpoint.id}/rotate-secret`, { data: { graceHours: 0 } });
    const newest = (await again.json()).secret as string;
    await sendTest(request, endpoint.id, 'match.live');
    await expect.poll(async () => (await mine()).length, { timeout: 20_000 }).toBe(2);
    const second = (await mine())[1];
    expect(parseSignatureHeader(second.headers['x-at-signature'])?.signatures).toHaveLength(1);
    expect(verifySignature(newest, second.headers['x-at-signature'], second.body).ok).toBe(true);
    expect(verifySignature(newSecret, second.headers['x-at-signature'], second.body).ok).toBe(false);
  });

  test('an endpoint that keeps failing is switched off, with a notice', async ({ request }) => {
    test.setTimeout(120_000);
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, true);
    await setTiming(request, { retryScale: 0.0001 });
    const bin = newBin('dead');
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), eventTypes: ['match.live'] });
    await sinkBehaviour(request, bin, { status: 503, times: 1000 });

    // A real event: a standalone match (no server) goes live.
    const slug = `wh-dead-${Date.now()}`;
    const created = await request.post('/api/matches', {
      data: {
        slug,
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          team1: { name: 'Dead A', players: [{ steamid: '76561198000009001', name: 'a' }] },
          team2: { name: 'Dead B', players: [{ steamid: '76561198000009002', name: 'b' }] },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await reconcile(request, slug);
    const live = await request.post('/api/test/match-state', { data: { slug, status: 'live' } });
    expect(live.ok()).toBe(true);
    await reconcile(request, slug);

    await expect
      .poll(
        async () => {
          const body = await (await request.get(`/api/webhooks/${endpoint.id}`)).json();
          return body.endpoint.active;
        },
        { timeout: 90_000 }
      )
      .toBe(false);
    const body = await (await request.get(`/api/webhooks/${endpoint.id}`)).json();
    expect(body.endpoint.disabledReason).toContain('persistent failures');
    expect(body.endpoint.deliveries.failed).toBeGreaterThanOrEqual(1);
    const ours = (await received(request, bin)).filter((r) => r.envelope.data.match.slug === slug);
    expect(ours.length).toBeGreaterThanOrEqual(10);
    const [failed] = (await (await request.get(`/api/webhooks/${endpoint.id}/deliveries?status=failed`)).json()).deliveries;
    expect(failed).toMatchObject({ eventType: 'match.live', attempts: 10, lastStatusCode: 503 });

    // Switching it on again clears the notice.
    const on = await request.patch(`/api/webhooks/${endpoint.id}`, { data: { active: true } });
    expect((await on.json()).endpoint).toMatchObject({ active: true, disabledReason: null });
    await request.delete(`/api/matches/${slug}`);
  });
});
