import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { signInAsPlayerViaRequest } from '../helpers/auth';
import { PresenceTracker } from '../../api/src/services/presenceTracker';

/**
 * Presence (api/src/services/presenceTracker.ts): a player is online with
 * at least one signed-in socket, away when every tab that reports it has gone
 * idle, offline with none. Counted per socket, so several tabs work. Live
 * changes reach `presence:subscribe` sockets as `presence:update`, anonymous
 * viewers included.
 *
 * @tag api
 * @tag social
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api'] };

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

test.describe('Presence tracker', TAGS, () => {
  test('counts sockets per player: offline only when the last one closes', () => {
    const t = new PresenceTracker();
    expect(t.status('p1')).toBe('offline');
    expect(t.connect('p1', 's1')).toEqual({
      playerId: 'p1',
      status: 'online',
      previous: 'offline',
    });
    expect(t.connect('p1', 's2')).toBeNull();
    expect(t.connect('p1', 's2')).toBeNull();
    expect(t.onlineIds()).toEqual(['p1']);
    expect(t.disconnect('s1')).toBeNull();
    expect(t.status('p1')).toBe('online');
    expect(t.disconnect('s2')).toEqual({ playerId: 'p1', status: 'offline', previous: 'online' });
    expect(t.onlineIds()).toEqual([]);
    expect(t.disconnect('s2')).toBeNull();
  });

  test('away only when every reporting tab is idle', () => {
    const t = new PresenceTracker();
    t.connect('p1', 'chat'); // a socket that never reports
    t.connect('p1', 'tabA');
    expect(t.report('p1', 'tabA', true)).toEqual({
      playerId: 'p1',
      status: 'away',
      previous: 'online',
    });
    // A second tab, in use: online again.
    expect(t.report('p1', 'tabB', false)).toEqual({
      playerId: 'p1',
      status: 'online',
      previous: 'away',
    });
    expect(t.report('p1', 'tabB', true)?.status).toBe('away');
    // The idle tab closing leaves the other idle one: still away.
    expect(t.disconnect('tabA')).toBeNull();
    expect(t.report('p1', 'tabB', false)?.status).toBe('online');
    // The reporting tab closing: the silent socket keeps them online.
    expect(t.disconnect('tabB')).toBeNull();
    expect(t.status('p1')).toBe('online');
    expect(t.disconnect('chat')?.status).toBe('offline');
  });

  test('players are counted apart', () => {
    const t = new PresenceTracker();
    t.connect('p1', 's1');
    t.connect('p2', 's2');
    t.report('p2', 's2', true);
    expect(t.status('p1')).toBe('online');
    expect(t.status('p2')).toBe('away');
    expect(t.onlineIds().sort()).toEqual(['p1', 'p2']);
  });
});

async function connect(cookie?: string): Promise<Socket> {
  const socket = io(BASE_URL, {
    transports: ['polling'],
    forceNew: true,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

async function presenceOf(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/players/presence?ids=${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { presence: Record<string, { online: boolean; status: string }> })
    .presence[id];
}

test.describe('Presence over the socket', TAGS, () => {
  test('online, away and offline reach an anonymous watcher and the API', async ({ request }) => {
    const id = `7656119${digits(10)}`;
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const sockets: Socket[] = [];
    try {
      expect(await signInAsPlayerViaRequest(ctx, id, 'Presence Socket')).toBe(true);
      const cookie = (await ctx.storageState()).cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

      const watcher = await connect();
      sockets.push(watcher);
      watcher.emit('presence:subscribe');
      const updates: Array<{ playerId: string; status: string }> = [];
      watcher.on('presence:update', (u: { playerId: string; status: string }) => {
        if (u.playerId === id) updates.push(u);
      });
      const next = async (status: string) =>
        expect.poll(() => updates.map((u) => u.status).includes(status)).toBe(true);
      // The room join is not acknowledged: give it a moment.
      await new Promise((r) => setTimeout(r, 200));

      expect(await presenceOf(request, id)).toMatchObject({ online: false, status: 'offline' });

      // Two tabs of the same player.
      const tabA = await connect(cookie);
      const tabB = await connect(cookie);
      sockets.push(tabA, tabB);
      for (const s of [tabA, tabB]) {
        const joined = await new Promise<{ ok: boolean }>((resolve) =>
          s.emit('player:subscribe', resolve)
        );
        expect(joined.ok).toBe(true);
      }
      await next('online');
      expect(await presenceOf(request, id)).toMatchObject({ online: true, status: 'online' });

      tabA.emit('presence:idle', true);
      tabB.emit('presence:idle', true);
      await next('away');
      expect(await presenceOf(request, id)).toMatchObject({ online: true, status: 'away' });

      tabA.close();
      await expect.poll(async () => (await presenceOf(request, id)).status).toBe('away');
      tabB.close();
      await next('offline');
      expect(await presenceOf(request, id)).toMatchObject({ online: false, status: 'offline' });

      // An anonymous socket says nothing about anyone.
      const anon = await connect();
      sockets.push(anon);
      const refused = await new Promise<{ ok: boolean }>((resolve) =>
        anon.emit('player:subscribe', resolve)
      );
      expect(refused.ok).toBe(false);
      anon.emit('presence:idle', true);
    } finally {
      for (const s of sockets) s.close();
      await ctx.dispose();
    }
  });
});
