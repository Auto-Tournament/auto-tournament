import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { io, Socket } from 'socket.io-client';

export type MatchStatusValue =
  | 'none'
  | 'your_turn_veto'
  | 'waiting_veto'
  | 'waiting_server'
  | 'match_ready';

interface MatchStatusResult {
  status: MatchStatusValue;
  matchSlug: string | null;
  label: string | null;
  loading: boolean;
  refetch: () => void;
}

const POLL_MS = 20_000;

export function useCurrentMatchStatus(
  playerSteamId: string | null
): MatchStatusResult {
  const [status, setStatus] = useState<MatchStatusValue>('none');
  const [matchSlug, setMatchSlug] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!playerSteamId) {
      setStatus('none');
      setMatchSlug(null);
      setLabel(null);
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const res = await api.get<{
        success: boolean;
        status?: MatchStatusValue;
        matchSlug?: string | null;
        label?: string | null;
      }>('/api/players/me/match-status');

      if (res?.success) {
        setStatus((res.status as MatchStatusValue) ?? 'none');
        setMatchSlug(res.matchSlug ?? null);
        setLabel(res.label ?? null);
      }
    } catch {
      setStatus('none');
      setMatchSlug(null);
      setLabel(null);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [playerSteamId]);

  useEffect(() => {
    void fetchStatus();
    if (!playerSteamId) return;
    const interval = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(interval);
  }, [playerSteamId, fetchStatus]);

  // Near real-time updates: veto actions emit `veto:update` via Socket.IO.
  // When that happens, refetch match-status immediately so the navbar snackbar
  // doesn't wait for the next poll tick.
  useEffect(() => {
    if (!playerSteamId) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    if (!socketRef.current) {
      socketRef.current = io();
    }
    const socket = socketRef.current;

    const scheduleSilentRefetch = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void fetchStatus({ silent: true });
      }, 50);
    };

    // Any veto update can affect whose turn it is (and thus match-status labels).
    socket.on('veto:update', scheduleSilentRefetch);

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socket.off('veto:update', scheduleSilentRefetch);
      // Keep socket open for reuse; it will be closed when playerSteamId becomes null.
    };
  }, [playerSteamId, fetchStatus]);

  return {
    status,
    matchSlug,
    label,
    loading,
    refetch: () => fetchStatus(),
  };
}
