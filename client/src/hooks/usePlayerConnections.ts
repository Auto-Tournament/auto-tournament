import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { io, Socket } from 'socket.io-client';

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

export const usePlayerConnections = (matchSlug: string | null) => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    if (!matchSlug) {
      setStatus(null);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get(`/api/events/connections/${matchSlug}`);
      if (response.success) {
        setStatus({
          matchSlug: response.matchSlug,
          connectedPlayers: response.connectedPlayers || [],
          team1Connected: response.team1Connected || 0,
          team2Connected: response.team2Connected || 0,
          totalConnected: response.totalConnected || 0,
          lastUpdated: response.lastUpdated || Date.now(),
        });
      }
    } catch (error) {
      console.error('Failed to load connection status:', error);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();

    if (!matchSlug) return;

    // Setup WebSocket to listen for connection updates
    const socket: Socket = io();

    socket.on('match:update', (data: { slug?: string; connectionStatus?: ConnectionStatus }) => {
      if (data.slug === matchSlug && data.connectionStatus) {
        setStatus(data.connectionStatus);
      }
    });

    return () => {
      socket.close();
    };
  }, [matchSlug]);

  return { status, loading, refresh: loadStatus };
};

