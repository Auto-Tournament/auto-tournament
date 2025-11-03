import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { log } from '../utils/logger';

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
export function emitTournamentUpdate(tournament: Record<string, unknown>): void {
  if (io) {
    io.emit('tournament:update', tournament);
    log.debug('Emitted tournament update', { tournamentId: tournament.id });
  }
}

/**
 * Emit bracket update
 */
export function emitBracketUpdate(bracket: Record<string, unknown>): void {
  if (io) {
    io.emit('bracket:update', bracket);
    log.debug('Emitted bracket update');
  }
}

/**
 * Emit match update
 */
export function emitMatchUpdate(match: Record<string, unknown>): void {
  if (io) {
    io.emit('match:update', match);
    log.debug('Emitted match update', { matchId: match.id });
  }
}

/**
 * Emit match event (live stats)
 */
export function emitMatchEvent(matchSlug: string, event: Record<string, unknown>): void {
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
export function emitServerEvent(serverId: string, event: Record<string, unknown>): void {
  if (io) {
    io.emit('server:event', { serverId, ...event });
    io.emit(`server:event:${serverId}`, event);
    log.debug('Emitted server event for monitoring', { serverId });
  }
}