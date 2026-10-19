import { test, expect } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import {
  acquireSocket,
  currentSocket,
  releaseSocket,
  socketFactory,
} from '../../client/src/utils/sharedSocket';

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
