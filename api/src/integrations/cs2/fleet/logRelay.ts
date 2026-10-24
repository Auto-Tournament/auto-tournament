/**
 * Live console of a Ready Up server for admins: the first admin panel that
 * opens a server starts its `logs.start` stream, the last one closing stops it.
 * The server's `logs.lines` batches are kept (last 200) and relayed to the
 * room `fleet-logs:<fleetServerId>`.
 */

import { log } from '../../../utils/logger';
import { db } from '../../../config/database';
import type { Untrusted } from '../../../utils/untrusted';
import { getIO, onSocketConnection, socketHasAdminAccess } from '../../../services/socketService';
import { registerInboundHandler } from './inbound';
import { fleetBus, onFleetServerClosed, onFleetServerReady } from './service';
import type { Socket } from 'socket.io';
import type { LogsLinesPayload } from './protocol/v1';

export const LOGS_CAPABILITY = 'logs.v1';
export const LOG_BUFFER_LINES = 200;
export const LOG_RENEW_MS = 30_000;

export type SubscribeAck =
  | { ok: true; live: boolean; lines: string[] }
  | { ok: false; error: 'forbidden' | 'unknown' | 'offline' | 'unsupported' };

interface Watched {
  sockets: Set<string>;
  buffer: string[];
}

const watched = new Map<string, Watched>();
const socketServers = new Map<string, Set<string>>();
let stopFns: Array<() => void> = [];
let timer: NodeJS.Timeout | null = null;
let hooked = false;

export const logRoom = (fleetServerId: string): string => `fleet-logs:${fleetServerId}`;

function warnFailed(fleetServerId: string, type: string, error: Error): void {
  log.warn(`[FLEET] ${fleetServerId}: ${type} failed: ${error.message}`);
}

function requestStream(fleetServerId: string, backlog: boolean): void {
  void fleetBus()
    .send(fleetServerId, { type: 'logs.start', payload: { backlog }, reliable: false })
    .catch((error: Error) => warnFailed(fleetServerId, 'logs.start', error));
}

function stopStream(fleetServerId: string): void {
  void fleetBus()
    .send(fleetServerId, { type: 'logs.stop', payload: {}, reliable: false })
    .catch((error: Error) => warnFailed(fleetServerId, 'logs.stop', error));
}

/** The capabilities the server said in its last hello; null for a server we do not know. */
async function capabilitiesOf(fleetServerId: string): Promise<string[] | null> {
  const row = await db.queryOneAsync<{ capabilities: string | null }>(
    'SELECT capabilities FROM cs2_fleet_servers WHERE id = ?',
    [fleetServerId]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.capabilities ?? '[]') as string[];
  } catch {
    return [];
  }
}

export async function subscribeLogs(
  socketId: string,
  fleetServerId: string
): Promise<SubscribeAck> {
  const caps = await capabilitiesOf(fleetServerId);
  if (!caps) return { ok: false, error: 'unknown' };
  if (!fleetBus().isConnected(fleetServerId)) return { ok: false, error: 'offline' };
  if (!caps.includes(LOGS_CAPABILITY)) return { ok: false, error: 'unsupported' };

  const socket = getIO().sockets.sockets.get(socketId);
  if (!socket) return { ok: false, error: 'offline' };

  let entry = watched.get(fleetServerId);
  const first = !entry;
  if (!entry) {
    entry = { sockets: new Set(), buffer: [] };
    watched.set(fleetServerId, entry);
  }
  entry.sockets.add(socketId);
  const mine = socketServers.get(socketId) ?? new Set<string>();
  mine.add(fleetServerId);
  socketServers.set(socketId, mine);
  void socket.join(logRoom(fleetServerId));

  if (first) requestStream(fleetServerId, true);
  return { ok: true, live: true, lines: [...entry.buffer] };
}

function release(socketId: string, fleetServerId: string): void {
  const entry = watched.get(fleetServerId);
  if (!entry?.sockets.delete(socketId)) return;
  if (entry.sockets.size > 0) return;
  watched.delete(fleetServerId);
  if (fleetBus().isConnected(fleetServerId)) stopStream(fleetServerId);
}

export function unsubscribeLogs(socketId: string, fleetServerId: string): void {
  void getIO().sockets.sockets.get(socketId)?.leave(logRoom(fleetServerId));
  const mine = socketServers.get(socketId);
  mine?.delete(fleetServerId);
  if (mine?.size === 0) socketServers.delete(socketId);
  release(socketId, fleetServerId);
}

export function dropSocket(socketId: string): void {
  const mine = socketServers.get(socketId);
  if (!mine) return;
  socketServers.delete(socketId);
  for (const fleetServerId of mine) release(socketId, fleetServerId);
}

function attachSocket(socket: Socket): void {
  socket.on('fleet:logs:subscribe', (body?: Untrusted, ack?: Untrusted) => {
    const reply =
      typeof ack === 'function' ? (ack as (ack: SubscribeAck) => void) : () => undefined;
    const fleetServerId = (body as { fleetServerId?: Untrusted } | undefined)?.fleetServerId;
    void (async () => {
      try {
        if (!(await socketHasAdminAccess(socket))) return reply({ ok: false, error: 'forbidden' });
        if (typeof fleetServerId !== 'string') return reply({ ok: false, error: 'unknown' });
        reply(await subscribeLogs(socket.id, fleetServerId));
      } catch (error) {
        log.error('Socket fleet logs subscribe failed', error as Error);
        reply({ ok: false, error: 'forbidden' });
      }
    })();
  });
  socket.on('fleet:logs:unsubscribe', (body?: Untrusted) => {
    const fleetServerId = (body as { fleetServerId?: Untrusted } | undefined)?.fleetServerId;
    if (typeof fleetServerId === 'string') unsubscribeLogs(socket.id, fleetServerId);
  });
  socket.on('disconnect', () => dropSocket(socket.id));
}

function applyLines(fleetServerId: string, payload: LogsLinesPayload): void {
  const entry = watched.get(fleetServerId);
  if (!entry) return;
  entry.buffer = payload.backlog
    ? payload.lines.slice(-LOG_BUFFER_LINES)
    : [...entry.buffer, ...payload.lines].slice(-LOG_BUFFER_LINES);
  getIO().to(logRoom(fleetServerId)).emit('fleet:logs', {
    fleetServerId,
    lines: payload.lines,
    backlog: payload.backlog,
    dropped: payload.dropped,
  });
}

export function startLogRelay(): void {
  if (stopFns.length) return;
  stopFns.push(
    registerInboundHandler('logs.lines', {
      priority: 'low',
      handle: async (ctx, env) => applyLines(ctx.serverId, env.payload),
    })
  );
  stopFns.push(onSocketConnection(attachSocket));
  if (!hooked) {
    hooked = true;
    onFleetServerReady((fleetServerId, hello) => {
      const entry = watched.get(fleetServerId);
      if (!entry || !hello.capabilities.includes(LOGS_CAPABILITY)) return;
      entry.buffer = [];
      requestStream(fleetServerId, true);
      getIO().to(logRoom(fleetServerId)).emit('fleet:logs:state', { fleetServerId, live: true });
    });
    onFleetServerClosed((fleetServerId) => {
      // A reconnect may already have a new session: its ready said live: true.
      if (!watched.has(fleetServerId) || fleetBus().isConnected(fleetServerId)) return;
      getIO().to(logRoom(fleetServerId)).emit('fleet:logs:state', { fleetServerId, live: false });
    });
  }
  timer = setInterval(() => {
    for (const fleetServerId of watched.keys()) {
      if (fleetBus().isConnected(fleetServerId)) requestStream(fleetServerId, false);
    }
  }, LOG_RENEW_MS);
  timer.unref();
  stopFns.push(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

export function stopLogRelay(): void {
  for (const off of stopFns) off();
  stopFns = [];
  watched.clear();
  socketServers.clear();
}
