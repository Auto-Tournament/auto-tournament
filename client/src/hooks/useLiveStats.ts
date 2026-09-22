import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { io, type Socket } from 'socket.io-client';
import type { MatchLiveStats } from '../types';

const SNAPSHOT_CACHE_MS = 5000;

interface LoadOptions {
  force?: boolean;
}

export function useLiveStats(matchSlug: string | null) {
  const [stats, setStats] = useState<MatchLiveStats | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<{ slug: string | null; timestamp: number }>({
    slug: null,
    timestamp: 0,
  });

  const loadStats = useCallback(
    async ({ force = false }: LoadOptions = {}) => {
      if (!matchSlug) {
        setStats(null);
        return;
      }

      if (
        !force &&
        cacheRef.current.slug === matchSlug &&
        Date.now() - cacheRef.current.timestamp < SNAPSHOT_CACHE_MS
      ) {
        return;
      }

      cacheRef.current = { slug: matchSlug, timestamp: Date.now() };

      try {
        setLoading(true);
        const response = await api.get<MatchLiveStats & { success: boolean }>(`/api/events/live/${matchSlug}`);
        if (response?.success) {
          setStats({
            matchSlug,
            team1Score: response.team1Score ?? 0,
            team2Score: response.team2Score ?? 0,
            team1SeriesScore: response.team1SeriesScore ?? 0,
            team2SeriesScore: response.team2SeriesScore ?? 0,
            roundNumber: response.roundNumber ?? 0,
            mapNumber: response.mapNumber ?? 0,
            status: response.status ?? 'warmup',
            lastEventAt: response.lastEventAt ?? Date.now(),
            mapName: response.mapName ?? null,
            totalMaps: response.totalMaps ?? 1,
            playerStats: response.playerStats ?? null,
          });
        }
      } catch (error) {
        console.error('Failed to load live stats snapshot', error);
      } finally {
        setLoading(false);
      }
    },
    [matchSlug]
  );

  useEffect(() => {
    loadStats({ force: true });
  }, [loadStats]);

  useEffect(() => {
    if (!matchSlug) return;
    const socket: Socket = io();

    const handleMatchUpdate = (payload: {
      slug?: string;
      matchSlug?: string;
      liveStats?: MatchLiveStats;
    }) => {
      const payloadSlug = payload.slug || payload.matchSlug;
      if (!payloadSlug || payloadSlug !== matchSlug) {
        return;
      }

      if (payload.liveStats) {
        setStats(payload.liveStats);
      } else {
        loadStats({ force: true });
      }
    };

    socket.on('match:update', handleMatchUpdate);

    return () => {
      socket.off('match:update', handleMatchUpdate);
      socket.close();
    };
  }, [matchSlug, loadStats]);

  return {
    stats,
    loading,
    refresh: () => loadStats({ force: true }),
  };
}

