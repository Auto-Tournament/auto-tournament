import { io, type Socket } from 'socket.io-client';
import type { Untrusted } from './untrusted';

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

/**
 * The argument a synthetic `connect` call gets (see `ownedView`), so a handler
 * that cares (utils/socketResync) can tell it from a real (re)connect.
 */
export const SYNTHETIC_CONNECT = Symbol('synthetic connect');

/**
 * The shared socket as a component's own: `on('connect', fn)` also calls
 * `fn(SYNTHETIC_CONNECT)` on the next tick when the socket is already
 * connected, as a socket of its own would have connected after mount. Code
 * that joins its rooms on `connect` keeps working. Everything else is the
 * shared socket's.
 */
function connectNowIfUp(s: Socket, fn: (...args: Untrusted[]) => void): void {
  if (!s.connected) return;
  void Promise.resolve().then(() => {
    if (s.connected && s.listeners('connect').includes(fn)) fn(SYNTHETIC_CONNECT);
  });
}

export function ownedView(s: Socket): Socket {
  return new Proxy(s, {
    get(target, prop, receiver) {
      if (prop === 'on') {
        return (event: string, fn: (...args: Untrusted[]) => void) => {
          target.on(event, fn);
          if (event === 'connect') connectNowIfUp(target, fn);
          return receiver;
        };
      }
      const value: Untrusted = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A socket event and its handler, for `listenShared`. */
export type SocketHandler = readonly [event: string, handler: (...args: never[]) => void];

/**
 * Takes the shared socket and attaches `handlers`; the returned stop removes
 * them and gives the socket back. A `connect` handler also runs (on the next
 * tick) when the socket is already connected, as it did on a socket of one's own.
 */
export function listenShared(handlers: readonly SocketHandler[]): () => void {
  const s = acquireSocket();
  const attached = handlers.map(
    ([event, fn]) => [event, fn as (...args: Untrusted[]) => void] as const
  );
  for (const [event, fn] of attached) s.on(event, fn);
  if (s.connected) {
    void Promise.resolve().then(() => {
      for (const [event, fn] of attached) if (event === 'connect' && s.connected) fn();
    });
  }
  return () => {
    for (const [event, fn] of attached) s.off(event, fn);
    releaseSocket();
  };
}

/**
 * The server knows the player from the socket's handshake: after signing in
 * or out, open the connection again so it does (every `connect` handler then
 * joins its rooms again).
 */
export function reconnectSharedSocket(): void {
  if (!socket) return;
  socket.disconnect();
  if (users > 0) socket.connect();
}

/**
 * The shared socket for one hook or page, used like a socket of its own:
 * `on`/`off` as before, and `close()`/`disconnect()` removes only the
 * handlers it added and gives the shared socket back. For code written for
 * `io()`; new code takes `useSocket()` or `listenShared()`.
 */
export function scopedSocket(): Socket {
  const s = acquireSocket();
  const mine: Array<[string, (...args: Untrusted[]) => void]> = [];
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    for (const [event, fn] of mine) s.off(event, fn);
    mine.length = 0;
    releaseSocket();
  };
  return new Proxy(s, {
    get(target, prop, receiver) {
      if (prop === 'on') {
        return (event: string, fn: (...args: Untrusted[]) => void) => {
          if (!done) {
            mine.push([event, fn]);
            target.on(event, fn);
            if (event === 'connect') connectNowIfUp(target, fn);
          }
          return receiver;
        };
      }
      if (prop === 'off') {
        return (event: string, fn: (...args: Untrusted[]) => void) => {
          const i = mine.findIndex(([e, f]) => e === event && f === fn);
          if (i >= 0) mine.splice(i, 1);
          target.off(event, fn);
          return receiver;
        };
      }
      if (prop === 'close' || prop === 'disconnect') {
        return () => {
          stop();
          return receiver;
        };
      }
      const value: Untrusted = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
