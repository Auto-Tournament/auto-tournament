import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HTTPServer, IncomingMessage, ServerResponse } from 'http';
import type { Request } from 'express';
import { log } from '../utils/logger';
import { getRealViewerSteamId } from '../utils/viewerIdentity';
import { checkAdminAccess } from '../middleware/auth';
import { matchChanged } from '../core/matchChangeBus';
import type { AdminCall, AdminCallResolvedEvent } from '../types/adminCall.types';
import type {
  TournamentUpdateEvent,
  BracketUpdateEvent,
  MatchUpdateEvent,
  MatchEventData,
  ServerEvent,
  VetoUpdateEvent,
  CompatUpdateEvent,
} from '../types/socket.types';

let io: SocketIOServer | null = null;

/** Room of the sockets on the public compatibility page (`compat:subscribe`). */
export const COMPAT_ROOM = 'compat';

/**
 * Room of the sockets whose handshake proved admin rights (`admin:subscribe`).
 * Admin-only events (`admin:call`, `admin:call:resolved`) go only here: a
 * player's message to the admins is not for every viewer of the bracket.
 */
export const ADMIN_ROOM = 'admins';

/** Express-style middleware (session, Passport) run on the Socket.IO handshake. */
export type HandshakeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void;

export interface SocketOptions {
  /**
   * Run on each handshake request, in order, so `socket.request` carries the
   * session and Passport user that `admin:subscribe` checks (index.ts passes
   * the app's own session and Passport middleware).
   */
  handshakeMiddleware?: HandshakeMiddleware[];
}

/**
 * The handshake request, shaped enough like an Express request for
 * `checkAdminAccess`: it reads headers through `req.get`.
 */
function handshakeAsRequest(socket: Socket): Request {
  const req = socket.request as IncomingMessage & Partial<Request>;
  if (typeof req.get !== 'function') {
    const get = (name: string): string | undefined => {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };
    Object.defineProperty(req, 'get', { value: get, configurable: true });
  }
  return req as Request;
}

async function joinAdminRoom(socket: Socket, ack?: unknown): Promise<void> {
  const reply = typeof ack === 'function' ? (ack as (body: unknown) => void) : () => undefined;
  try {
    const access = await checkAdminAccess(handshakeAsRequest(socket));
    if (!access.ok) {
      log.debug('Socket refused the admin room', { socketId: socket.id, reason: access.logReason });
      reply({ ok: false, error: access.error });
      return;
    }
    await socket.join(ADMIN_ROOM);
    reply({ ok: true });
  } catch (error) {
    log.error('Socket admin check failed', error as Error);
    reply({ ok: false, error: 'Failed to verify admin permissions' });
  }
}

export function initializeSocket(httpServer: HTTPServer, options: SocketOptions = {}): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  // Session and Passport on the handshake only (not on every polling
  // request of the same connection), as Socket.IO's docs recommend.
  for (const middleware of options.handshakeMiddleware ?? []) {
    io.engine.use((req: IncomingMessage & { _query?: { sid?: string } }, res: ServerResponse, next: (err?: unknown) => void) => {
      const isHandshake = req._query?.sid === undefined;
      if (isHandshake) middleware(req, res, next);
      else next();
    });
  }

  io.on('connection', (socket) => {
    log.debug(`Socket client connected: ${socket.id}`);

    // The public Ready Up compatibility page. Anyone may listen (the data is
    // public), but only sockets that ask get `compat:update`, so every other
    // page's connection is not sent it. Rooms do not survive a reconnect: the
    // client asks again on every `connect`.
    socket.on('compat:subscribe', () => {
      void socket.join(COMPAT_ROOM);
    });
    socket.on('compat:unsubscribe', () => {
      void socket.leave(COMPAT_ROOM);
    });

    // Admin-only events (admin calls). The socket joins only if the
    // handshake's session, signed cookie or API token is an admin's — the
    // same check as `requireAuth`. The optional ack says whether it did.
    // Rooms do not survive a reconnect: the client asks again on `connect`.
    socket.on('admin:subscribe', (ack?: unknown) => {
      void joinAdminRoom(socket, ack);
    });
    socket.on('admin:unsubscribe', () => {
      void socket.leave(ADMIN_ROOM);
    });

    // A signed-in player's own events (matchmaking): room `player:<id>`, for
    // the account the handshake's session or signed cookie names. Nothing for
    // an anonymous socket. The client asks again on every `connect`.
    socket.on('player:subscribe', (ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (body: unknown) => void) : () => undefined;
      const playerId = getRealViewerSteamId(handshakeAsRequest(socket));
      if (!playerId) return reply({ ok: false });
      const wasOnline = isPlayerOnline(playerId);
      void Promise.resolve(socket.join(playerRoom(playerId))).then(() => {
        reply({ ok: true });
        if (!wasOnline) presenceListener?.(playerId, true);
      });
    });

    // The last tab of a player closing: they went offline.
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (!room.startsWith('player:')) continue;
        if ((io?.sockets.adapter.rooms.get(room)?.size ?? 0) <= 1) presenceListener?.(room.slice('player:'.length), false);
      }
    });

    socket.on('disconnect', () => {
      log.debug(`Socket client disconnected: ${socket.id}`);
    });
  });

  log.success('Socket.io initialized');
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initializeSocket first.');
  }
  return io;
}

/**
 * Emit tournament update
 */
export function emitTournamentUpdate(tournament: TournamentUpdateEvent): void {
  // A tournament changed status (created, started, finished, ...): which one
  // is featured may have changed with it.
  void import('./currentTournament').then((m) => m.refreshCurrentTournamentId()).catch(() => undefined);
  if (io) {
    io.emit('tournament:update', tournament);
    log.debug('Emitted tournament update', { tournamentId: tournament.id });
  }
}

/**
 * Emit an event scoped to one tournament (3.0 phase D).
 *
 * Everything else here broadcasts, because 3.0 hosts a single tournament row.
 * A tournament-scoped emit is the shape 3.1 needs — several tournaments on one
 * instance, each with its own listeners — so anything written from phase D
 * onwards goes through this rather than adding another global `io.emit`.
 *
 * It sends the event twice: once globally, so today's clients (which join no
 * room and filter nothing) keep working, and once on a per-tournament channel
 * a 3.1 client subscribes to. `tournamentId` rides along in the payload so a
 * listener on the global channel can tell them apart.
 */
export function emitTournament(
  tournamentId: number,
  event: string,
  payload: Record<string, unknown> = {}
): void {
  if (!io) return;
  const body = { ...payload, tournamentId };
  io.emit(event, body);
  io.emit(`${event}:t${tournamentId}`, body);
  log.debug('Emitted tournament-scoped event', { tournamentId, event });
}

/**
 * Emit bracket update
 */
export function emitBracketUpdate(bracket: BracketUpdateEvent): void {
  if (io) {
    io.emit('bracket:update', bracket);
    log.debug('Emitted bracket update');
  }
}

/**
 * Emit match update
 */
export function emitMatchUpdate(match: MatchUpdateEvent): void {
  // Integrator webhooks re-read the match (core/matchChangeBus), socket or not.
  const ref = match as { slug?: string; id?: number; deleted?: boolean };
  matchChanged({ slug: ref.slug ?? null, id: ref.id ?? null, deleted: ref.deleted === true });
  if (io) {
    io.emit('match:update', match);

    const slug = (match as { slug?: string }).slug;
    if (slug) {
      io.emit(`match:update:${slug}`, match);
    }

    log.debug('Emitted match update', { matchId: match.id, slug });
  }
}

/**
 * Emit match event (live stats)
 */
export function emitMatchEvent(matchSlug: string, event: MatchEventData['event']): void {
  if (io) {
    io.emit('match:event', { matchSlug, event });
    io.emit(`match:event:${matchSlug}`, event);
    log.debug('Emitted match event', { matchSlug, eventType: event.event });
  }
}

/**
 * Emit server status update
 */
export function emitServerStatus(serverId: string, status: 'online' | 'offline'): void {
  if (io) {
    io.emit('server:status', { serverId, status });
    log.debug('Emitted server status', { serverId, status });
  }
}

/**
 * Emit server event for debugging/monitoring
 */
export function emitServerEvent(serverId: string, event: Omit<ServerEvent, 'serverId'>): void {
  if (io) {
    io.emit('server:event', { serverId, ...event });
    io.emit(`server:event:${serverId}`, event);
    log.debug('Emitted server event for monitoring', { serverId });
  }
}

/**
 * Emit veto update
 */
export function emitVetoUpdate(matchSlug: string, vetoState: VetoUpdateEvent['veto']): void {
  if (io) {
    io.emit('veto:update', { matchSlug, veto: vetoState });
    io.emit(`veto:update:${matchSlug}`, vetoState);
    log.debug('Emitted veto update', { matchSlug });
  }
}

/**
 * Emit a Ready Up compatibility change to the sockets on the public
 * compatibility page (room `compat`, joined with `compat:subscribe`).
 */
export function emitCompatUpdate(payload: CompatUpdateEvent): void {
  if (io) {
    io.to(COMPAT_ROOM).emit('compat:update', payload);
    log.debug('Emitted compat update', { runId: payload.run.run.id });
  }
}

const playerRoom = (playerId: string) => `player:${playerId}`;

/**
 * Signed-in players with the site open right now: the `player:<id>` rooms
 * that have a socket in them (each tab asks for its room on connect).
 */
export function onlinePlayerCount(): number {
  if (!io) return 0;
  let n = 0;
  for (const [room, sockets] of io.sockets.adapter.rooms) {
    if (room.startsWith('player:') && sockets.size > 0) n += 1;
  }
  return n;
}

/** Whether the player has the site open in at least one tab. */
export function isPlayerOnline(playerId: string): boolean {
  return (io?.sockets.adapter.rooms.get(playerRoom(playerId))?.size ?? 0) > 0;
}

type PresenceListener = (playerId: string, online: boolean) => void;
let presenceListener: PresenceListener | null = null;

/** Hear players come online (first tab) and go offline (last tab closed). One listener (services/socialService). */
export function onPresence(listener: PresenceListener): void {
  presenceListener = listener;
}

/** A new notice for the bell (`notify:new`, the notice as payload). Room `player:<id>`. */
export function emitNotification(playerId: string, notice: unknown): void {
  if (io) io.to(playerRoom(playerId)).emit('notify:new', notice);
}

/**
 * Tell players their friends, requests or invites changed (`social:changed`,
 * no payload: the client reads GET /api/social/friends again). Rooms `player:<id>`.
 */
export function emitSocialChanged(playerIds: Iterable<string>): void {
  if (!io) return;
  const rooms = [...new Set(playerIds)].map(playerRoom);
  if (rooms.length > 0) io.to(rooms).emit('social:changed');
}

/**
 * Tell players their matchmaking state changed (`mm:changed`, no payload: the
 * client reads GET /api/matchmaking/me again). Rooms `player:<id>`.
 */
export function emitMatchmakingChanged(playerIds: Iterable<string>): void {
  if (!io) return;
  const rooms = [...new Set(playerIds)].map(playerRoom);
  if (rooms.length > 0) io.to(rooms).emit('mm:changed');
}

/**
 * Tell a player their skins changed (`skins:changed`, no payload: the client
 * reads GET /api/skins/me again and shows the new-skin reveal). Room `player:<id>`.
 */
export function emitSkinsChanged(playerId: string): void {
  if (io) io.to(playerRoom(playerId)).emit('skins:changed');
}

/** A new admin call, to the signed-in admins (room `admins`). */
export function emitAdminCall(call: AdminCall): void {
  if (io) {
    io.to(ADMIN_ROOM).emit('admin:call', call);
    log.debug('Emitted admin call', { id: call.id });
  }
}

/**
 * A csm machine changed (inventory, health, a command's progress or result,
 * online or offline), to the signed-in admins: the Servers page reloads that
 * machine instead of waiting for its next poll.
 */
export function emitFleetHostChanged(hostId: string): void {
  if (io) io.to(ADMIN_ROOM).emit('fleet:host', { hostId });
}

/** Admin calls resolved, to the signed-in admins (room `admins`). */
export function emitAdminCallResolved(payload: AdminCallResolvedEvent): void {
  if (io) {
    io.to(ADMIN_ROOM).emit('admin:call:resolved', payload);
    log.debug('Emitted admin call resolved', { ids: payload.ids });
  }
}

/** A chat message, to the players in its channel (rooms `player:<id>`) and, for a match, the admins. */
export function emitChatMessage(playerIds: Iterable<string>, toAdmins: boolean, message: unknown): void {
  if (!io) return;
  const rooms = [...new Set(playerIds)].map(playerRoom);
  if (toAdmins) rooms.push(ADMIN_ROOM);
  if (rooms.length > 0) io.to(rooms).emit('chat:message', message);
}

/**
 * A platform line in a match's chat (veto steps, the server being ready),
 * for a game module: it reaches core through this bridged module.
 * See ./matchChatLines.ts.
 */
export async function postMatchChatLine(
  slug: string,
  key: import('./matchChatLines').MatchChatKey,
  params: Record<string, string | number | boolean | string[]> = {}
): Promise<void> {
  const lines = await import('./matchChatLines');
  await lines.postMatchChatLine(slug, key, params);
}
