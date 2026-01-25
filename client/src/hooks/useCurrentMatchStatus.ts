import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

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

  const fetchStatus = useCallback(async () => {
    if (!playerSteamId) {
      setStatus('none');
      setMatchSlug(null);
      setLabel(null);
      return;
    }

    setLoading(true);
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
      setLoading(false);
    }
  }, [playerSteamId]);

  useEffect(() => {
    void fetchStatus();
    if (!playerSteamId) return;
    const interval = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(interval);
  }, [playerSteamId, fetchStatus]);

  return {
    status,
    matchSlug,
    label,
    loading,
    refetch: fetchStatus,
  };
}
