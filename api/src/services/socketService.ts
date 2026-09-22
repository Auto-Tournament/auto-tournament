import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { log } from '../utils/logger';
import type {
  TournamentUpdateEvent,
  BracketUpdateEvent,
  MatchUpdateEvent,
  MatchEventData,
  ServerEvent,
  VetoUpdateEvent,
} from '../types/socket.types';

let io: SocketIOServer | null = null;

export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    log.debug(`Socket client connected: ${socket.id}`);

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
  if (io) {
    io.emit('tournament:update', tournament);
    log.debug('Emitted tournament update', { tournamentId: tournament.id });
  }
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