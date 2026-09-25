import { test, expect, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { signInViaRequest, signInAsPlayerViaRequest, DEFAULT_ADMIN_STEAM_ID } from '../helpers/auth';
import { createTestServer, deleteServer } from '../helpers/servers';
import { getSchemaSQL, parseSchemaColumns } from '../../api/src/config/database.schema';
import { readAdminCalled } from '../../api/src/integrations/cs2/events/adminCalledPayload';
import type { AdminCalledEvent } from '../../api/src/integrations/cs2/events/plugin-events.types';

/**
 * Admin calls: a player types `.admin [message]` on a CS2 server, Ready Up
 * posts `admin_called` to /api/events, and every signed-in admin sees it until
 * one of them resolves it.
 *
 * - the payload reader and the table (pure, no API);
 * - ingest stores a call once per call_id, attributed to the sending server;
 * - list, resolve (idempotent), resolve-all, 404;
 * - admin only: the REST routes and the socket room.
 *
 * @tag api
 * @tag admin-calls
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

function uniqueCallId(prefix = 'call'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function adminCalled(callId: string, overrides: Partial<AdminCalledEvent> = {}): AdminCalledEvent {
  return {
    event: 'admin_called',
    matchid: -1,
    map_number: 1,
    call_id: callId,
    player: { steamid64: '76561198000000042', name: 'Needs Help', team: 'team2', side: 't' },
    message: 'Opponent is ghosting on stream',
    called_at: '2026-09-25T12:00:00.000Z',
    ...overrides,
  };
}

async function postEvent(request: APIRequestContext, serverId: string, body: unknown) {
  return request.post(`/api/events?server_id=${encodeURIComponent(serverId)}`, {
    headers: SERVER_HEADERS,
    data: body,
  });
}

interface ListedCall {
  id: number;
  callId: string;
  serverId: string | null;
  serverName: string | null;
  mapNumber: number | null;
  player: { steamId: string | null; name: string | null; team: string | null; side: string | null };
  message: string;
  calledAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

async function listCalls(request: APIRequestContext) {
  const res = await request.get('/api/admin-calls');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { open: ListedCall[]; resolved: ListedCall[] };
}

test.describe('admin_called payload (pure)', () => {
  test('reads every field and clamps the message', { tag: ['@api', '@admin-calls'] }, () => {
    const fields = readAdminCalled(
      adminCalled('c-1', {
        message: `  ${'x'.repeat(250)}  `,
        player: { steamid64: '76561198000000042', name: ' Eve ', team: 'TEAM1', side: 'CT' },
      }),
      1_000
    );
    expect(fields).toMatchObject({
      callId: 'c-1',
      game: 'cs2',
      mapNumber: 1,
      player: { steamId: '76561198000000042', name: 'Eve', team: 'team1', side: 'ct' },
      calledAt: Date.parse('2026-09-25T12:00:00.000Z') / 1000,
    });
    expect(fields.message).toHaveLength(200);
  });

  test('tolerates missing fields, and derives a stable id without call_id', { tag: ['@api', '@admin-calls'] }, () => {
    const bare = { event: 'admin_called', matchid: 7 } as unknown as AdminCalledEvent;
    const a = readAdminCalled(bare, 1_234);
    const b = readAdminCalled(bare, 9_999);
    expect(a.callId).toMatch(/^derived:[0-9a-f]{32}$/);
    expect(b.callId).toBe(a.callId);
    expect(a).toMatchObject({
      message: '',
      mapNumber: null,
      calledAt: 1_234,
      player: { steamId: null, name: null, team: null, side: null },
    });
  });

  test("core's schema declares admin_calls with call_id unique", { tag: ['@api', '@admin-calls'] }, () => {
    const columns = parseSchemaColumns(getSchemaSQL())
      .filter((c) => c.table === 'admin_calls')
      .map((c) => c.column);
    expect(columns).toEqual(
      expect.arrayContaining([
        'call_id', 'server_id', 'match_slug', 'player_steamid', 'player_name', 'player_team',
        'player_side', 'message', 'called_at', 'received_at', 'resolved_at', 'resolved_by',
        'resolution_note',
      ])
    );
    expect(getSchemaSQL()).toMatch(/call_id TEXT NOT NULL UNIQUE/);
  });
});

test.describe.serial('Admin calls API', () => {
  let serverId: string;
  let serverName: string;

  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const server = await createTestServer(request, 'admincall');
    expect(server).toBeTruthy();
    serverId = server!.id;
    serverName = server!.name;
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/admin-calls/resolve-all', { data: {} });
    if (serverId) await deleteServer(request, serverId);
  });

  test('the routes are admin only', { tag: ['@api', '@admin-calls', '@auth'] }, async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get('/api/admin-calls')).status()).toBe(401);
    expect((await anonymous.post('/api/admin-calls/1/resolve', { data: {} })).status()).toBe(401);
    expect((await anonymous.post('/api/admin-calls/resolve-all', { data: {} })).status()).toBe(401);

    const player = await playwright.request.newContext({ baseURL });
    expect(await signInAsPlayerViaRequest(player)).toBe(true);
    expect((await player.get('/api/admin-calls')).status()).toBe(403);
    expect((await player.post('/api/admin-calls/1/resolve', { data: {} })).status()).toBe(403);
    await anonymous.dispose();
    await player.dispose();
  });

  test('ingest needs the server token', { tag: ['@api', '@admin-calls', '@auth'] }, async ({ request }) => {
    const res = await request.post(`/api/events?server_id=${serverId}`, {
      headers: { 'Content-Type': 'application/json' },
      data: adminCalled(uniqueCallId('untokened')),
    });
    expect(res.status()).toBe(401);
  });

  test('a call is stored once per call_id, attributed to its server', { tag: ['@api', '@admin-calls'] }, async ({ request }) => {
    await signInViaRequest(request);
    const callId = uniqueCallId();

    const first = await postEvent(request, serverId, adminCalled(callId));
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = (await first.json()) as { adminCallId: number; duplicate: boolean };
    expect(firstBody.duplicate).toBe(false);

    // The plugin retries until it gets a 200; a retry must not make a second call.
    const again = await postEvent(request, serverId, adminCalled(callId, { message: 'changed' }));
    expect(again.status()).toBe(200);
    const againBody = (await again.json()) as { adminCallId: number; duplicate: boolean };
    expect(againBody).toMatchObject({ duplicate: true, adminCallId: firstBody.adminCallId });

    const { open } = await listCalls(request);
    const mine = open.filter((c) => c.callId === callId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: firstBody.adminCallId,
      serverId,
      serverName,
      mapNumber: 1,
      message: 'Opponent is ghosting on stream',
      calledAt: '2026-09-25T12:00:00.000Z',
      resolvedAt: null,
      player: { steamId: '76561198000000042', name: 'Needs Help', team: 'team2', side: 't' },
    });

    const one = await request.get(`/api/admin-calls/${firstBody.adminCallId}`);
    expect(one.ok()).toBe(true);
    expect(((await one.json()) as { call: ListedCall }).call.callId).toBe(callId);
  });

  test('resolving is idempotent and keeps the first resolution', { tag: ['@api', '@admin-calls'] }, async ({ request }) => {
    await signInViaRequest(request);
    const callId = uniqueCallId('resolve');
    const posted = await postEvent(request, serverId, adminCalled(callId, { message: '' }));
    const { adminCallId } = (await posted.json()) as { adminCallId: number };

    const first = await request.post(`/api/admin-calls/${adminCallId}/resolve`, {
      data: { note: 'Checked the demo' },
    });
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = (await first.json()) as { alreadyResolved: boolean; call: ListedCall };
    expect(firstBody.alreadyResolved).toBe(false);
    expect(firstBody.call).toMatchObject({
      resolvedBy: DEFAULT_ADMIN_STEAM_ID,
      resolutionNote: 'Checked the demo',
      message: '',
    });
    expect(firstBody.call.resolvedAt).not.toBeNull();

    const second = await request.post(`/api/admin-calls/${adminCallId}/resolve`, {
      data: { note: 'something else' },
    });
    expect(second.status()).toBe(200);
    const secondBody = (await second.json()) as { alreadyResolved: boolean; call: ListedCall };
    expect(secondBody.alreadyResolved).toBe(true);
    expect(secondBody.call.resolutionNote).toBe('Checked the demo');
    expect(secondBody.call.resolvedAt).toBe(firstBody.call.resolvedAt);

    const { open, resolved } = await listCalls(request);
    expect(open.some((c) => c.id === adminCallId)).toBe(false);
    expect(resolved.some((c) => c.id === adminCallId)).toBe(true);

    // A late retry of a resolved call does not reopen it.
    const retry = await postEvent(request, serverId, adminCalled(callId));
    expect(((await retry.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect((await listCalls(request)).open.some((c) => c.id === adminCallId)).toBe(false);
  });

  test('resolve-all, 404 and bad input', { tag: ['@api', '@admin-calls'] }, async ({ request }) => {
    await signInViaRequest(request);
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await postEvent(request, serverId, adminCalled(uniqueCallId(`all${i}`)));
      ids.push(((await res.json()) as { adminCallId: number }).adminCallId);
    }
    const all = await request.post('/api/admin-calls/resolve-all', { data: {} });
    expect(all.ok()).toBe(true);
    expect(((await all.json()) as { resolved: number[] }).resolved).toEqual(expect.arrayContaining(ids));
    expect((await listCalls(request)).open).toHaveLength(0);

    expect((await request.post('/api/admin-calls/999999999/resolve', { data: {} })).status()).toBe(404);
    expect((await request.get('/api/admin-calls/not-a-number')).status()).toBe(404);
    expect((await request.get('/api/admin-calls?resolvedWithin=abc')).status()).toBe(400);
  });

  test('only admin sockets get the live events', { tag: ['@api', '@admin-calls', '@auth'] }, async ({ request, baseURL }) => {
    await signInViaRequest(request);
    const cookie = (await request.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const connect = (headers: Record<string, string>): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const socket = io(baseURL!, { transports: ['polling'], extraHeaders: headers, forceNew: true });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    const subscribe = (socket: Socket) =>
      new Promise<{ ok: boolean }>((resolve) => socket.emit('admin:subscribe', resolve));

    const admin = await connect({ cookie });
    const stranger = await connect({});
    try {
      expect(await subscribe(admin)).toMatchObject({ ok: true });
      expect(await subscribe(stranger)).toMatchObject({ ok: false });

      let strangerHeard = false;
      stranger.on('admin:call', () => (strangerHeard = true));
      const callId = uniqueCallId('socket');
      const heard = new Promise<ListedCall>((resolve) =>
        admin.on('admin:call', (call: ListedCall) => {
          if (call.callId === callId) resolve(call);
        })
      );
      const res = await postEvent(request, serverId, adminCalled(callId));
      const call = await heard;
      expect(call).toMatchObject({ callId, serverId, player: { name: 'Needs Help' } });

      const resolvedHeard = new Promise<{ ids: number[] }>((resolve) =>
        admin.on('admin:call:resolved', resolve)
      );
      const { adminCallId } = (await res.json()) as { adminCallId: number };
      await request.post(`/api/admin-calls/${adminCallId}/resolve`, { data: {} });
      expect((await resolvedHeard).ids).toEqual([adminCallId]);
      expect(strangerHeard).toBe(false);
    } finally {
      admin.close();
      stranger.close();
    }
  });
});
