import { test, expect } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import {
  acquireSocket,
  currentSocket,
  listenShared,
  ownedView,
  releaseSocket,
  scopedSocket,
  socketFactory,
} from '../../client/src/utils/sharedSocket';
import { onSocketReconnect } from '../../client/src/utils/socketResync';

/**
 * client/src/utils/sharedSocket: every listener shares one socket, connected
 * by the first acquire and disconnected a moment after the last release.
 *
 * @tag api
 */

test(
  'one socket for all users, kept across a quick release and acquire',
  { tag: ['@api'] },
  async () => {
    let made = 0;
    const calls: string[] = [];
    const fake = {
      connected: false,
      active: false,
      connect() {
        calls.push('connect');
        this.connected = true;
        this.active = true;
      },
      disconnect() {
        calls.push('disconnect');
        this.connected = false;
        this.active = false;
      },
    };
    socketFactory.make = () => {
      made += 1;
      return fake as unknown as Socket;
    };

    const a = acquireSocket();
    const b = acquireSocket();
    expect(a).toBe(b);
    expect(currentSocket()).toBe(a);
    expect(made).toBe(1);
    expect(calls).toEqual(['connect']);

    // One leaves: still connected. The other leaves and a new page takes it at once.
    releaseSocket();
    releaseSocket();
    acquireSocket();
    await new Promise((r) => setTimeout(r, 2200));
    expect(calls).toEqual(['connect']);

    // The last one leaves: disconnected after the wait, and the next acquire reconnects the same socket.
    releaseSocket();
    await new Promise((r) => setTimeout(r, 2200));
    expect(calls).toEqual(['connect', 'disconnect']);
    expect(acquireSocket()).toBe(a);
    expect(calls).toEqual(['connect', 'disconnect', 'connect']);
    expect(made).toBe(1);
    releaseSocket();
  }
);

test(
  'ownedView: connect runs for a late listener; a resync waits for a real reconnect',
  { tag: ['@api'] },
  async () => {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const raw = {
      connected: true,
      on(event: string, fn: (...a: unknown[]) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      },
      off(event: string, fn: (...a: unknown[]) => void) {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((f) => f !== fn)
        );
      },
      listeners(event: string) {
        return handlers.get(event) ?? [];
      },
    };
    const socket = ownedView(raw as unknown as Socket);

    let joined = 0;
    socket.on('connect', () => (joined += 1));
    let resyncs = 0;
    onSocketReconnect(socket, () => (resyncs += 1));
    await Promise.resolve();
    await Promise.resolve();
    // Already connected: the room join ran; the resync did not.
    expect(joined).toBe(1);
    expect(resyncs).toBe(0);

    // A real reconnect: both run.
    for (const fn of handlers.get('connect') ?? []) fn();
    expect(joined).toBe(2);
    expect(resyncs).toBe(1);
  }
);

test(
  'listenShared attaches, runs connect when already connected, and removes on stop',
  { tag: ['@api'] },
  async () => {
    const handlers = new Map<string, Set<() => void>>();
    const fake = {
      connected: true,
      active: true,
      connect() {},
      disconnect() {},
      on(event: string, fn: () => void) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(fn);
      },
      off(event: string, fn: () => void) {
        handlers.get(event)?.delete(fn);
      },
    };
    socketFactory.make = () => fake as unknown as Socket;
    const s = currentSocket() as unknown as typeof fake;
    // The first test may have left its own fake as the socket: use whatever is current.
    if (s !== fake) Object.assign(s, { connected: true, on: fake.on, off: fake.off });

    let connects = 0;
    let updates = 0;
    const stop = listenShared([
      ['connect', () => (connects += 1)],
      ['presence:update', () => (updates += 1)],
    ]);
    await Promise.resolve();
    expect(connects).toBe(1);
    for (const fn of handlers.get('presence:update') ?? []) fn();
    expect(updates).toBe(1);

    stop();
    expect(handlers.get('connect')?.size ?? 0).toBe(0);
    expect(handlers.get('presence:update')?.size ?? 0).toBe(0);
  }
);

test('scopedSocket: close removes only its own handlers', { tag: ['@api'] }, () => {
  const handlers = new Map<string, Set<() => void>>();
  const s = currentSocket() as unknown as Record<string, unknown>;
  Object.assign(s, {
    connected: true,
    active: true,
    on(event: string, fn: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(fn);
    },
    off(event: string, fn: () => void) {
      handlers.get(event)?.delete(fn);
    },
  });
  const other = () => undefined;
  const page = scopedSocket();
  page.on('match:update', () => undefined);
  page.on('bracket:update', () => undefined);
  (s.on as (e: string, f: () => void) => void)('match:update', other);
  expect(handlers.get('match:update')?.size).toBe(2);

  page.close();
  expect(handlers.get('match:update')?.size).toBe(1);
  expect(handlers.get('match:update')?.has(other)).toBe(true);
  expect(handlers.get('bracket:update')?.size).toBe(0);
  // Closing twice gives the socket back once.
  page.close();
});
