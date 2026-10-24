import { test, expect, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { signInViaRequest } from '../helpers/auth';
import { createFleetKey, envelope, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp } from '../helpers/fleetFake';

/**
 * Live console relay: an admin socket subscribes to a fleet server's console,
 * the platform asks the server for it (`logs.start` / `logs.stop`) and relays
 * its `logs.lines` to the subscribers.
 *
 * @tag api
 * @tag fleet
 */

const CAPS = ['match.v1', 'stats.v1', 'logs.v1'];
let key: { id: string; value: string };

type Ack = { ok: boolean; live?: boolean; lines?: string[]; error?: string };

function connect(baseURL: string, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseURL, {
      transports: ['polling'],
      extraHeaders: cookie ? { cookie } : {},
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const subscribe = (socket: Socket, fleetServerId: string) =>
  new Promise<Ack>((resolve) => socket.emit('fleet:logs:subscribe', { fleetServerId }, resolve));

const heard = <T>(socket: Socket, event: string) =>
  new Promise<T>((resolve) => socket.once(event, resolve));

const sendLines = (fake: FakeReadyUp, lines: string[], backlog = false) =>
  fake.client.send(envelope('logs.lines', { lines, backlog, dropped: 0 }));

async function cookieOf(request: APIRequestContext): Promise<string> {
  return (await request.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

test.describe.serial('Fleet live logs', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-live-logs-tests' });
  });

  test.afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  async function online(request: APIRequestContext, capabilities = CAPS): Promise<FakeReadyUp> {
    const fake = await FakeReadyUp.enroll(request, key.value);
    cleanup.push(() => fake.close());
    await fake.hello({ capabilities });
    return fake;
  }

  async function adminSocket(request: APIRequestContext, baseURL: string): Promise<Socket> {
    const socket = await connect(baseURL, await cookieOf(request));
    cleanup.push(() => void socket.close());
    return socket;
  }

  test('subscribe sends logs.start with backlog', async ({ request, baseURL }) => {
    const fake = await online(request);
    const admin = await adminSocket(request, baseURL!);
    expect(await subscribe(admin, fake.serverId)).toEqual({ ok: true, live: true, lines: [] });
    expect((await fake.next('logs.start')).payload).toEqual({ backlog: true });
  });

  test('lines reach the subscriber', async ({ request, baseURL }) => {
    const fake = await online(request);
    const admin = await adminSocket(request, baseURL!);
    await subscribe(admin, fake.serverId);
    await fake.next('logs.start');
    const got = heard<{
      fleetServerId: string;
      lines: string[];
      backlog: boolean;
      dropped: number;
    }>(admin, 'fleet:logs');
    sendLines(fake, ['a', 'b'], true);
    expect(await got).toEqual({
      fleetServerId: fake.serverId,
      lines: ['a', 'b'],
      backlog: true,
      dropped: 0,
    });
  });

  test('second subscriber gets the buffer in its ack', async ({ request, baseURL }) => {
    const fake = await online(request);
    const first = await adminSocket(request, baseURL!);
    const second = await adminSocket(request, baseURL!);
    await subscribe(first, fake.serverId);
    await fake.next('logs.start');
    const seen = heard(first, 'fleet:logs');
    sendLines(fake, ['one', 'two'], true);
    await seen;
    const again = heard(first, 'fleet:logs');
    sendLines(fake, ['three']);
    await again;
    expect(await subscribe(second, fake.serverId)).toEqual({
      ok: true,
      live: true,
      lines: ['one', 'two', 'three'],
    });
  });

  test('the last unsubscribe stops the stream', async ({ request, baseURL }) => {
    const fake = await online(request);
    const a = await adminSocket(request, baseURL!);
    const b = await adminSocket(request, baseURL!);
    await subscribe(a, fake.serverId);
    await subscribe(b, fake.serverId);
    await fake.next('logs.start');
    a.emit('fleet:logs:unsubscribe', { fleetServerId: fake.serverId });
    b.emit('fleet:logs:unsubscribe', { fleetServerId: fake.serverId });
    expect((await fake.next('logs.stop')).payload).toEqual({});
  });

  test('disconnect stops the stream', async ({ request, baseURL }) => {
    const fake = await online(request);
    const admin = await adminSocket(request, baseURL!);
    await subscribe(admin, fake.serverId);
    await fake.next('logs.start');
    admin.close();
    expect((await fake.next('logs.stop')).payload).toEqual({});
  });

  test('reconnect restarts with backlog', async ({ request, baseURL }) => {
    const fake = await online(request);
    const admin = await adminSocket(request, baseURL!);
    await subscribe(admin, fake.serverId);
    await fake.next('logs.start');
    const down = heard<{ fleetServerId: string; live: boolean }>(admin, 'fleet:logs:state');
    const up = new Promise<{ live: boolean }>((resolve) =>
      admin.on('fleet:logs:state', (s: { live: boolean }) => s.live && resolve(s))
    );
    await fake.reconnect({ capabilities: CAPS });
    expect(await down).toEqual({ fleetServerId: fake.serverId, live: false });
    expect(await up).toEqual({ fleetServerId: fake.serverId, live: true });
    expect((await fake.next('logs.start')).payload).toEqual({ backlog: true });
  });

  test('non-admin socket is refused', async ({ request, baseURL }) => {
    const fake = await online(request);
    const stranger = await connect(baseURL!, '');
    cleanup.push(() => void stranger.close());
    expect(await subscribe(stranger, fake.serverId)).toEqual({ ok: false, error: 'forbidden' });
  });

  test('server without logs.v1 is unsupported, unknown and offline are told apart', async ({
    request,
    baseURL,
  }) => {
    const plain = await online(request, ['match.v1']);
    const admin = await adminSocket(request, baseURL!);
    expect(await subscribe(admin, plain.serverId)).toEqual({ ok: false, error: 'unsupported' });
    expect(await subscribe(admin, 'no-such-server')).toEqual({ ok: false, error: 'unknown' });
    const gone = await online(request);
    gone.close();
    await new Promise((r) => setTimeout(r, 500));
    expect(await subscribe(admin, gone.serverId)).toEqual({ ok: false, error: 'offline' });
  });
});
