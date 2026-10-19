import { test, expect } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import {
  acquireSocket,
  currentSocket,
  ownedView,
  releaseSocket,
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
