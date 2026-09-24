import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  helloPayload,
  newInstallId,
  resetEnrollRateLimit,
  type Enrolled,
} from '../helpers/fleet';
import { validateMessage, type Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The fleet WebSocket gateway, `/api/fleet/ws` (FLEET.md §5, §6), driven by a
 * test client the way Ready Up's fleet.so will drive it:
 *
 * - auth on upgrade: no / bad token → 4401, revoked → 4403;
 * - hello → welcome (schema-valid, `ref` = hello id), the server shows online
 *   with its versions, and offline after the socket closes;
 * - identity and protocol checks: wrong server_id → 4403, no common protocol
 *   → 4426, anything before hello → 4400, invalid envelope → 4400;
 * - ping → pong, and the platform's own ping;
 * - reliable messages: unknown type → error + ack, duplicates re-acked, a
 *   gap → 4400, resume carries the platform's last seq;
 * - a second session replaces the first (4409), revoke closes with 4403;
 * - token rotation: a token older than 90 days gets auth.rotate right after
 *   welcome, the new token works, and auth.rotated is acked.
 *
 * @tag api
 */

let key: { id: string; value: string };

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

async function fleetServer(request: APIRequestContext, id: string) {
  const list = await (await request.get('/api/fleet/servers')).json();
  return list.servers.find((s: { id: string }) => s.id === id);
}

function expectValid(msg: Envelope): void {
  expect(validateMessage(msg), JSON.stringify(msg)).toEqual({ ok: true, errors: [] });
}

test.describe.serial('Fleet gateway', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'gateway-tests' });
  });

  test('no token or a bad token closes with 4401', async () => {
    const none = await FleetTestClient.connect(null);
    expect((await none.waitClosed()).code).toBe(4401);
    const bad = await FleetTestClient.connect('rus_000000000000_' + 'A'.repeat(43));
    expect((await bad.waitClosed()).code).toBe(4401);
    const junk = await FleetTestClient.connect('not-a-token');
    expect((await junk.waitClosed()).code).toBe(4401);
  });

  test('hello → welcome; online with versions; offline after close', async ({ request }) => {
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    const welcome = await client.handshake(server.server_id, server.installId);
    expectValid(welcome);
    expect(welcome.payload).toMatchObject({
      protocol: 1,
      heartbeat: { interval_ms: 10000, timeout_ms: 30000 },
      resume: { result: 'reset', platform_last_rx_seq: 0 },
      server_config_rev: 0,
      admins_rev: 0,
      assignment: null,
    });

    await expect
      .poll(async () => (await fleetServer(request, server.server_id))?.online)
      .toBe(true);
    const row = await fleetServer(request, server.server_id);
    expect(row.versions).toMatchObject({ core: '0.4.0', plugins: { match: '0.4.0' }, cs2_patch: '1.40.3.2' });
    expect(row.capabilities).toEqual(['match.v1', 'stats.v1']);
    expect(row.availability).toBe('available');
    expect(row.host).toMatchObject({ hostname: 'test-host', game_port: 27015 });
    expect(row.protocol).toBe(1);

    client.close();
    await client.waitClosed();
    await expect
      .poll(async () => (await fleetServer(request, server.server_id))?.online)
      .toBe(false);
    expect((await fleetServer(request, server.server_id)).lastSeen).toBeGreaterThan(0);
  });

  test('ping → pong; health is stored', async ({ request }) => {
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId);
    const ping = envelope('ping', { t: 12345, health: { players: 7, tick_ms_p99: 2.5, spool_msgs: 0, uptime_s: 99 } });
    client.send(ping);
    const pong = await client.nextOfType('pong');
    expectValid(pong);
    expect(pong.ref).toBe(ping.id);
    expect(pong.payload).toEqual({ t: 12345 });
    await expect.poll(async () => (await fleetServer(request, server.server_id))?.health?.players).toBe(7);
    client.close();
  });

  test('the platform pings every heartbeat interval', async ({ request }) => {
    test.setTimeout(30_000);
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId);
    const ping = await client.nextOfType('ping', 12_000);
    expectValid(ping);
    expect(typeof ping.payload.t).toBe('number');
    client.close();
  });

  test('identity and protocol checks', async ({ request }) => {
    const server = await enrollNew(request);

    const wrongId = await FleetTestClient.connect(server.token);
    wrongId.send(envelope('hello', helloPayload('fs_someone_else', server.installId)));
    expect((await wrongId.waitClosed()).code).toBe(4403);

    const wrongInstall = await FleetTestClient.connect(server.token);
    wrongInstall.send(envelope('hello', helloPayload(server.server_id, newInstallId())));
    expect((await wrongInstall.waitClosed()).code).toBe(4403);

    const future = await FleetTestClient.connect(server.token);
    future.send(
      envelope('hello', helloPayload(server.server_id, server.installId, { protocol: { min: 2, max: 3 } }))
    );
    expect((await future.waitClosed()).code).toBe(4426);

    const early = await FleetTestClient.connect(server.token);
    early.send(envelope('ping', { t: 1 }));
    expect((await early.waitClosed()).code).toBe(4400);

    const garbage = await FleetTestClient.connect(server.token);
    garbage.sendRaw('{"v":1,"type":"hello"}');
    const closed = await garbage.waitClosed();
    expect(closed.code).toBe(4400);
    expect(closed.reason).toContain('invalid envelope');

    const badHello = await FleetTestClient.connect(server.token);
    badHello.send(envelope('hello', { server_id: server.server_id }));
    expect((await badHello.waitClosed()).code).toBe(4400);
  });

  test('reliable messages: unknown type, duplicates, acks, gaps', async ({ request }) => {
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'stream-rel', last_tx_seq: 0, last_rx_seq: 0 },
    });

    // An unknown reliable type: error unknown_type, and it is still acked.
    const unknown = envelope('event.not_in_step_one', { match_id: 'x' }, { seq: 1 });
    client.send(unknown);
    const error = await client.nextOfType('error');
    expectValid(error);
    expect(error.ref).toBe(unknown.id);
    expect(error.payload).toMatchObject({ code: 'unknown_type', type: 'event.not_in_step_one' });
    const ack = await client.next((m) => m.type === 'ack' && m.ack === 1, 3000);
    expectValid(ack);

    // A known reliable type is processed and acked.
    client.send(envelope('auth.rotated', {}, { seq: 2 }));
    await client.next((m) => m.type === 'ack' && m.ack === 2, 3000);

    // A replayed seq is acked again, not processed twice.
    client.send(envelope('event.not_in_step_one', {}, { seq: 2 }));
    await client.next((m) => m.type === 'ack' && m.ack === 2, 3000);
    expect(client.received.some((m) => m.type === 'error')).toBe(false);

    // A gap closes the session; the server reconnects and replays.
    client.send(envelope('event.not_in_step_one', {}, { seq: 5 }));
    const closed = await client.waitClosed();
    expect(closed.code).toBe(4400);
    expect(closed.reason).toContain('seq gap');

    // Same stream on reconnect: resumed, and the platform says it has up to 2.
    const again = await FleetTestClient.connect(server.token);
    const welcome = await again.handshake(server.server_id, server.installId, {
      stream: { id: 'stream-rel', last_tx_seq: 3, last_rx_seq: 0 },
    });
    expect(welcome.payload.resume).toEqual({ result: 'resumed', platform_last_rx_seq: 2 });
    again.send(envelope('auth.rotated', {}, { seq: 3 }));
    await again.next((m) => m.type === 'ack' && m.ack === 3, 3000);
    again.close();

    // A different stream id: reset, and the next seq it sends is the new base.
    const reset = await FleetTestClient.connect(server.token);
    const w2 = await reset.handshake(server.server_id, server.installId, {
      stream: { id: 'stream-new', last_tx_seq: 40, last_rx_seq: 0 },
    });
    expect(w2.payload.resume).toEqual({ result: 'reset', platform_last_rx_seq: 0 });
    reset.send(envelope('auth.rotated', {}, { seq: 38 }));
    await reset.next((m) => m.type === 'ack' && m.ack === 38, 3000);
    reset.close();
  });

  test('a second session replaces the first with 4409', async ({ request }) => {
    const server = await enrollNew(request);
    const first = await FleetTestClient.connect(server.token);
    await first.handshake(server.server_id, server.installId);
    const second = await FleetTestClient.connect(server.token);
    await second.handshake(server.server_id, server.installId);
    const closed = await first.waitClosed();
    expect(closed.code).toBe(4409);
    // The replacement stays online.
    await expect.poll(async () => (await fleetServer(request, server.server_id))?.online).toBe(true);
    second.close();
  });

  test('revoking a connected server closes it with 4403', async ({ request }) => {
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId);
    expect((await request.post(`/api/fleet/servers/${server.server_id}/revoke`)).ok()).toBe(true);
    expect((await client.waitClosed()).code).toBe(4403);
    const retry = await FleetTestClient.connect(server.token);
    expect((await retry.waitClosed()).code).toBe(4403);
  });

  test('token rotation: auth.rotate after welcome; both tokens work until the new one is confirmed', async ({ request }) => {
    const server = await enrollNew(request);
    // A token older than 90 days is due.
    const aged = await request.post('/api/test/fleet/age-token', { data: { serverId: server.server_id, days: 91 } });
    expect(aged.ok(), await aged.text()).toBe(true);

    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'rot-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });
    const rotate = await client.nextOfType('auth.rotate');
    expectValid(rotate);
    expect(rotate.seq).toBeGreaterThanOrEqual(1);
    const newToken = rotate.payload.token as string;
    expect(newToken).not.toBe(server.token);
    const oldValidUntil = rotate.payload.old_valid_until as number;
    expect(oldValidUntil).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(oldValidUntil).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 5000);

    // The server writes it and says so (reliable, acking the platform's seq).
    client.send(envelope('auth.rotated', {}, { seq: 1, ack: rotate.seq, ref: rotate.id }));
    await client.next((m) => m.type === 'ack' && m.ack === 1, 3000);
    client.close();
    await client.waitClosed();

    const row = await fleetServer(request, server.server_id);
    expect(row.token.id).toBe(newToken.split('_')[1]);
    expect(row.token.rotationPending).toBe(false);

    // The new token connects; the old one keeps working through the grace window.
    const withNew = await FleetTestClient.connect(newToken);
    await withNew.handshake(server.server_id, server.installId, {
      stream: { id: 'rot-stream', last_tx_seq: 1, last_rx_seq: rotate.seq as number },
    });
    // Not rotated again: the new token is fresh.
    await new Promise((r) => setTimeout(r, 500));
    expect(withNew.received.some((m) => m.type === 'auth.rotate')).toBe(false);
    withNew.close();
    const withOld = await FleetTestClient.connect(server.token);
    await withOld.handshake(server.server_id, server.installId, {
      stream: { id: 'rot-stream', last_tx_seq: 1, last_rx_seq: rotate.seq as number },
    });
    withOld.close();
  });

  test('an unacked auth.rotate is replayed after a reconnect, with a fresh secret', async ({ request }) => {
    const server = await enrollNew(request);
    await request.post('/api/test/fleet/age-token', { data: { serverId: server.server_id, days: 91 } });

    const first = await FleetTestClient.connect(server.token);
    await first.handshake(server.server_id, server.installId, { stream: { id: 's', last_tx_seq: 0, last_rx_seq: 0 } });
    const rotate1 = await first.nextOfType('auth.rotate');
    // Drop the connection without processing it.
    first.ws.terminate();

    const second = await FleetTestClient.connect(server.token);
    await second.handshake(server.server_id, server.installId, { stream: { id: 's', last_tx_seq: 0, last_rx_seq: 0 } });
    const rotate2 = await second.nextOfType('auth.rotate');
    expect(rotate2.seq).toBe(rotate1.seq);
    expect(rotate2.payload.token).not.toBe(rotate1.payload.token);
    second.close();

    // Only the latest secret is valid.
    const stale = await FleetTestClient.connect(rotate1.payload.token as string);
    expect((await stale.waitClosed()).code).toBe(4401);
    const fresh = await FleetTestClient.connect(rotate2.payload.token as string);
    await fresh.handshake(server.server_id, server.installId, {
      stream: { id: 's', last_tx_seq: 0, last_rx_seq: rotate2.seq as number },
    });
    fresh.close();
  });

  test('admin rotate of an offline server happens on its next connect', async ({ request }) => {
    const server = await enrollNew(request);
    const res = await request.post(`/api/fleet/servers/${server.server_id}/rotate`);
    expect(res.status()).toBe(202);
    expect((await res.json()).rotation).toBe('on_next_connect');
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId);
    expectValid(await client.nextOfType('auth.rotate'));
    client.close();
  });
});
