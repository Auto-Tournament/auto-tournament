/**
 * Event Buffer Service
 * Stores the last 50 events per server in memory for real-time monitoring
 */

import type { MatchZyEvent } from '../types/matchzy-events.types';
import { log } from '../utils/logger';
import { emitServerEvent } from './socketService';

interface ServerEventWithId {
  timestamp: number;
  serverId: string;
  matchSlug: string;
  event: MatchZyEvent;
}

class EventBufferService {
  private buffers: Map<string, ServerEventWithId[]> = new Map();
  private readonly MAX_EVENTS_PER_SERVER = 100;

  /**
   * Add an event to a server's buffer
   */
  addEvent(serverId: string, matchSlug: string, event: MatchZyEvent): void {
    if (!this.buffers.has(serverId)) {
      this.buffers.set(serverId, []);
    }

    const buffer = this.buffers.get(serverId)!;
    const serverEvent: ServerEventWithId = {
      timestamp: Date.now(),
      serverId,
      matchSlug,
      event,
    };

    // Add to beginning of array
    buffer.unshift(serverEvent);

    // Keep only last 100 events
    if (buffer.length > this.MAX_EVENTS_PER_SERVER) {
      buffer.pop();
    }

    // Emit event via WebSocket for real-time monitoring
    // Emit both to server-specific channel AND global channel
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { serverId: _serverId, ...eventWithoutServerId } = serverEvent;
    emitServerEvent(serverId, eventWithoutServerId);

    log.debug(`Event buffered for server ${serverId}`, {
      eventType: event.event,
      bufferSize: buffer.length,
    });
  }

  /**
   * Get all events for a specific server
   */
  getEvents(serverId: string): ServerEventWithId[] {
    return this.buffers.get(serverId) || [];
  }

  /**
   * Get all server IDs that have events
   */
  getServerIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Clear events for a specific server
   */
  clearServer(serverId: string): void {
    this.buffers.delete(serverId);
    log.debug(`Cleared event buffer for server ${serverId}`);
  }

  /**
   * Clear all events
   */
  clearAll(): void {
    this.buffers.clear();
    log.debug('Cleared all event buffers');
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    serverCount: number;
    totalEvents: number;
    servers: Array<{ id: string; events: number }>;
  } {
    const servers = Array.from(this.buffers.entries()).map(([id, events]) => ({
      id,
      events: events.length,
    }));

    return {
      serverCount: this.buffers.size,
      totalEvents: servers.reduce((sum, s) => sum + s.events, 0),
      servers,
    };
  }
}

export const eventBufferService = new EventBufferService();
