import { io, type Socket } from 'socket.io-client';

/**
 * The page's one Socket.IO connection, shared by everything that listens.
 *
 * A second `io()` on the same namespace opens a whole new connection (the
 * client only reuses a manager for another namespace), so every hook that
 * called `io()` itself added one: a dozen per page, each polling, and their
 * leftovers answering "Session ID unknown". Take the socket with
 * `acquireSocket()`, give it back with `releaseSocket()`; `on`/`off` your own
 * handlers and never `close()` it. Rooms (`admin:subscribe`,
 * `player:subscribe`…) are only ever joined, so sharing them is safe.
 *
 * The last release disconnects it a moment later, so moving between pages
 * (one unmounts, the next mounts) keeps the connection. It is one object for
 * the page's life: the next acquire reconnects it, handlers and all.
 */

const CLOSE_AFTER_MS = 2000;

let socket: Socket | null = null;
let users = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const onCreate = new Set<(s: Socket) => void>();
/** How the socket is made; tests swap in a fake. */
export const socketFactory = { make: (): Socket => io({ autoConnect: false }) };

/** The shared socket, made (unconnected) the first time. */
export function currentSocket(): Socket {
  if (!socket) {
    socket = socketFactory.make();
    for (const fn of onCreate) fn(socket);
  }
  return socket;
}

/** Runs `fn` on the shared socket once it exists (wires its handlers). */
export function onSharedSocket(fn: (s: Socket) => void): void {
  onCreate.add(fn);
  if (socket) fn(socket);
}

export function acquireSocket(): Socket {
  users += 1;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  const s = currentSocket();
  if (!s.connected && !s.active) s.connect();
  return s;
}

export function releaseSocket(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (users === 0) socket?.disconnect();
  }, CLOSE_AFTER_MS);
}
