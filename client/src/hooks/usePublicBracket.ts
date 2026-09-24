import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useSocket } from './useSocket';
import { onSocketReconnect } from '../utils/socketResync';
import type { Match, RoundRobinStanding, SwissStanding, Tournament } from '../types';

interface PublicBracketResponse {
  success: boolean;
  /** Carries `winner` once completed. */
  tournament?: Tournament;
  matches: Match[];
  totalRounds: number;
  swissStandings?: SwissStanding[];
  roundRobinStandings?: RoundRobinStanding[];
}

export interface UsePublicBracketResult {
  /** The tournament as the bracket route sends it, with the champion. */
  tournament: Tournament | null;
  matches: Match[];
  totalRounds: number;
  swissStandings: SwissStanding[];
  roundRobinStandings: RoundRobinStanding[];
  loading: boolean;
  error: string;
}

/**
 * The tournament's matches for the public Bracket and Matches tabs, from
 * `GET /api/tournament/:id/bracket`: no session, and no server, match config
 * or player stats in it (the admin bracket route has those).
 *
 * Read again, debounced, when a match or the bracket moves and after a
 * socket reconnect, so a live score or a new round shows without a reload.
 */
export function usePublicBracket(
  tournamentId: number | string | undefined
): UsePublicBracketResult {
  const [data, setData] = useState<PublicBracketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const socket = useSocket();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (tournamentId === undefined) return;
    try {
      const response = await api.get<PublicBracketResponse>(
        `/api/tournament/${tournamentId}/bracket`
      );
      setData(response);
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // No bracket yet (nothing generated) is an empty state, not an error.
      if (message.includes('404') || message.toLowerCase().includes('not found')) {
        setData(null);
        setError('');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reload = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 400);
    };
    socket.on('match:update', reload);
    socket.on('bracket:update', reload);
    socket.on('tournament:update', reload);
    const offReconnect = onSocketReconnect(socket, reload);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      offReconnect();
      socket.off('match:update', reload);
      socket.off('bracket:update', reload);
      socket.off('tournament:update', reload);
    };
  }, [socket, load]);

  return {
    tournament: data?.tournament ?? null,
    matches: data?.matches ?? [],
    totalRounds: data?.totalRounds ?? 0,
    swissStandings: data?.swissStandings ?? [],
    roundRobinStandings: data?.roundRobinStandings ?? [],
    loading,
    error,
  };
}
