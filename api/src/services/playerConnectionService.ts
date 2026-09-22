/**
 * Player Connection Service
 * Tracks which players are connected to each match in real-time
 */

import { emitMatchUpdate } from './socketService';
import { log } from '../utils/logger';

export interface ConnectedPlayer {
  steamId: string;
  name: string;
  team: 'team1' | 'team2';
  connectedAt: number;
  isReady: boolean; // Set to true when match goes live
}

export interface MatchConnectionStatus {
  matchSlug: string;
  connectedPlayers: ConnectedPlayer[];
  team1Connected: number;
  team2Connected: number;
  totalConnected: number;
  lastUpdated: number;
}

class PlayerConnectionService {
  // Map of match slug -> connected players
  private connections: Map<string, ConnectedPlayer[]> = new Map();

  /**
   * Track player connection
   */
  playerConnected(matchSlug: string, steamId: string, name: string, team: 'team1' | 'team2'): void {
    if (!this.connections.has(matchSlug)) {
      this.connections.set(matchSlug, []);
    }

    const players = this.connections.get(matchSlug)!;
    
    // Check if already connected
    const existing = players.find((p) => p.steamId === steamId);
    if (existing) {
      // Update name in case it changed
      existing.name = name;
      existing.connectedAt = Date.now();
      log.debug(`Player reconnected: ${name} (${steamId})`, { matchSlug, team });
    } else {
      // New connection
      players.push({
        steamId,
        name,
        team,
        connectedAt: Date.now(),
        isReady: false,
      });
      log.debug(`Player connected: ${name} (${steamId})`, { matchSlug, team });
    }

    this.emitUpdate(matchSlug);
  }

  /**
   * Track player disconnection
   */
  playerDisconnected(matchSlug: string, steamId: string): void {
    const players = this.connections.get(matchSlug);
    if (!players) return;

    const index = players.findIndex((p) => p.steamId === steamId);
    if (index !== -1) {
      const player = players[index];
      log.debug(`Player disconnected: ${player.name} (${steamId})`, { matchSlug });
      players.splice(index, 1);
      this.emitUpdate(matchSlug);
    }
  }

  /**
   * Track player ready status
   */
  playerReady(matchSlug: string, steamId: string, isReady: boolean): void {
    const players = this.connections.get(matchSlug);
    if (!players) return;

    const player = players.find((p) => p.steamId === steamId);
    if (player) {
      player.isReady = isReady;
      log.debug(`Player ${isReady ? 'ready' : 'unready'}: ${player.name}`, { matchSlug });
      this.emitUpdate(matchSlug);
    }
  }

  /**
   * Mark all connected players as ready (when match goes live)
   */
  markAllReady(matchSlug: string): void {
    const players = this.connections.get(matchSlug);
    if (!players) return;

    players.forEach((p) => {
      p.isReady = true;
    });

    log.debug(`All ${players.length} players marked as ready`, { matchSlug });
    this.emitUpdate(matchSlug);
  }

  /**
   * Get connection status for a match
   */
  getStatus(matchSlug: string): MatchConnectionStatus | null {
    const players = this.connections.get(matchSlug);
    if (!players) return null;

    const team1Connected = players.filter((p) => p.team === 'team1').length;
    const team2Connected = players.filter((p) => p.team === 'team2').length;

    return {
      matchSlug,
      connectedPlayers: players,
      team1Connected,
      team2Connected,
      totalConnected: players.length,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Clear connection data for a match (when match completes)
   */
  clearMatch(matchSlug: string): void {
    this.connections.delete(matchSlug);
    log.debug(`Cleared connection tracking for match`, { matchSlug });
  }

  /**
   * Clear all connections
   */
  clearAll(): void {
    this.connections.clear();
  }

  /**
   * Replace connection list for a match (e.g., after querying server directly)
   */
  setConnections(matchSlug: string, players: ConnectedPlayer[]): void {
    this.connections.set(matchSlug, players);
    this.emitUpdate(matchSlug);
  }

  /**
   * Get all matches with connections
   */
  getAllStatuses(): MatchConnectionStatus[] {
    const statuses: MatchConnectionStatus[] = [];
    
    this.connections.forEach((_players, matchSlug) => {
      const status = this.getStatus(matchSlug);
      if (status) {
        statuses.push(status);
      }
    });

    return statuses;
  }

  /**
   * Emit WebSocket update for match
   */
  private emitUpdate(matchSlug: string): void {
    const status = this.getStatus(matchSlug);
    if (status) {
      emitMatchUpdate({
        slug: matchSlug,
        connectionStatus: status,
      });
    }
  }
}

export const playerConnectionService = new PlayerConnectionService();