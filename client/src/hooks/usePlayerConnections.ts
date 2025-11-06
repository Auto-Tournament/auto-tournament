import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { io, Socket } from 'socket.io-client';
import type { ApiResponse } from '../types';

export interface ConnectedPlayer {
  steamId: string;
  name: string;
  team: 'team1' | 'team2';
  connectedAt: number;
  isReady: boolean;
}

export interface ConnectionStatus {
  matchSlug: string;
  connectedPlayers: ConnectedPlayer[];
  team1Connected: number;
  team2Connected: number;
  totalConnected: number;
  lastUpdated: number;
}

interface ConnectionStatusResponse extends ApiResponse {
  matchSlug?: string;
  connectedPlayers?: ConnectedPlayer[];
  team1Connected?: number;
  team2Connected?: number;
  totalConnected?: number;
  lastUpdated?: number;
}

export const usePlayerConnections = (matchSlug: string | null) => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!matchSlug) {
      setStatus(null);
      return;
    }

    setLoading(true);
    try {
      console.log(`[usePlayerConnections] Loading status for match: ${matchSlug}`);
      const response = await api.get<ConnectionStatusResponse>(
        `/api/events/connections/${matchSlug}`
      );
      console.log(`[usePlayerConnections] Response:`, response);

      if (response.success) {
        const newStatus: ConnectionStatus = {
          matchSlug: response.matchSlug || matchSlug,
          connectedPlayers: response.connectedPlayers || [],
          team1Connected: response.team1Connected || 0,
          team2Connected: response.team2Connected || 0,
          totalConnected: response.totalConnected || 0,
          lastUpdated: response.lastUpdated || Date.now(),
        };
        console.log(`[usePlayerConnections] Setting status:`, newStatus);
        setStatus(newStatus);
      }
    } catch (error) {
      console.error('Failed to load connection status:', error);
      // Still set an empty status to show 0/10
      setStatus({
        matchSlug,
        connectedPlayers: [],
        team1Connected: 0,
        team2Connected: 0,
        totalConnected: 0,
        lastUpdated: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, [matchSlug]);

  useEffect(() => {
    loadStatus();

    if (!matchSlug) return;

    // Setup WebSocket to listen for connection updates
    const socket: Socket = io();

    socket.on('match:update', (data: { slug?: string; connectionStatus?: ConnectionStatus }) => {
      console.log('[usePlayerConnections] WebSocket match:update:', data);
      if (data.slug === matchSlug && data.connectionStatus) {
        console.log('[usePlayerConnections] Updating connection status from WebSocket');
        setStatus(data.connectionStatus);
      }
    });

    return () => {
      socket.close();
    };
  }, [matchSlug, loadStatus]);

  return { status, loading, refresh: loadStatus };
};
