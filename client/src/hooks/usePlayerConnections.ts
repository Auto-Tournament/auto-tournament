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
  const lastFetchRef = useState(() => ({
    slug: null as string | null,
    timestamp: 0,
  }))[0];

  const shouldSkipFetch = useCallback(
    (slug: string, force: boolean) => {
      if (force) return false;
      return (
        lastFetchRef.slug === slug && Date.now() - lastFetchRef.timestamp < 5000 // 5s cache window
      );
    },
    // lastFetchRef is stable (created with useState initializer), so it doesn't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const recordFetch = useCallback(
    (slug: string) => {
      lastFetchRef.slug = slug;
      lastFetchRef.timestamp = Date.now();
    },
    // lastFetchRef is stable (created with useState initializer), so it doesn't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const loadStatus = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!matchSlug) {
        setStatus(null);
        return;
      }

      if (shouldSkipFetch(matchSlug, force)) {
        return;
      }

      recordFetch(matchSlug);
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
    },
    [matchSlug, recordFetch, shouldSkipFetch]
  );

  useEffect(() => {
    loadStatus({ force: true });

    if (!matchSlug) return;

    // Setup WebSocket to listen for connection updates
    const socket: Socket = io();

    const handleUpdate = (data: { slug?: string; connectionStatus?: ConnectionStatus }) => {
      console.log('[usePlayerConnections] WebSocket match:update:', data);
      if (data.slug === matchSlug && data.connectionStatus) {
        console.log('[usePlayerConnections] Updating connection status from WebSocket');
        setStatus(data.connectionStatus);
      }
    };

    socket.on('match:update', handleUpdate);

    if (matchSlug) {
      socket.on(`match:update:${matchSlug}`, handleUpdate);
    }

    return () => {
      socket.off('match:update', handleUpdate);
      if (matchSlug) {
        socket.off(`match:update:${matchSlug}`, handleUpdate);
      }
      socket.close();
    };
  }, [matchSlug, loadStatus]);

  return { status, loading, refresh: () => loadStatus({ force: true }) };
};
