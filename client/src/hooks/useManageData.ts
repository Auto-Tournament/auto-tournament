import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../utils/api';
import type { Match } from '../types/match.types';
import type { Tournament } from '../types/tournament.types';
import type { MatchesResponse, ServerAvailabilityResponse, TournamentResponse } from '../types/api.types';

export interface ManageData {
  loading: boolean;
  error: string | null;
  tournament: Tournament | null;
  matches: Match[];
  serverAvailability: ServerAvailabilityResponse | null;
  refresh: () => void;
}

/**
 * Data for the Manage console. Reuses the exact endpoints and refresh
 * cadence the Matches and Dashboard pages already poll/subscribe to:
 * GET /api/matches (+ the same `match:update` / `bracket:update` sockets),
 * GET /api/tournament/server-availability (5s poll, same as Matches.tsx),
 * and GET /api/tournament once.
 */
export function useManageData(): ManageData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [serverAvailability, setServerAvailability] = useState<ServerAvailabilityResponse | null>(
    null
  );

  const fetchMatches = useCallback(async () => {
    try {
      const data = await api.get<MatchesResponse>('/api/matches');
      if (data.success) {
        setMatches(data.matches || []);
      }
    } catch (err) {
      console.error('Failed to load matches for Manage:', err);
      setError((prev) => prev ?? 'Failed to load matches');
    }
  }, []);

  const fetchServerAvailability = useCallback(async () => {
    try {
      const data = await api.get<ServerAvailabilityResponse>('/api/tournament/server-availability');
      if (data.success) {
        setServerAvailability(data);
      }
    } catch (err) {
      console.error('Failed to load server availability for Manage:', err);
    }
  }, []);

  const fetchTournament = useCallback(async () => {
    try {
      const data = await api.get<TournamentResponse>('/api/tournament');
      if (data.success && data.tournament) {
        setTournament(data.tournament);
      }
    } catch {
      // No tournament configured yet - not an error state for this page.
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchMatches();
    void fetchServerAvailability();
    void fetchTournament();
  }, [fetchMatches, fetchServerAvailability, fetchTournament]);

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchMatches(), fetchServerAvailability(), fetchTournament()]);
      if (!cancelled) setLoading(false);
    };
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [fetchMatches, fetchServerAvailability, fetchTournament]);

  // Same sockets Matches.tsx listens to, so the status strip and queue update
  // live without a second, independent realtime channel.
  useEffect(() => {
    const socket = io();
    socket.on('match:update', () => void fetchMatches());
    socket.on('bracket:update', () => void fetchMatches());
    return () => {
      socket.disconnect();
    };
  }, [fetchMatches]);

  // Same 5s cadence Matches.tsx uses for server-availability polling.
  useEffect(() => {
    const interval = setInterval(() => void fetchServerAvailability(), 5000);
    return () => clearInterval(interval);
  }, [fetchServerAvailability]);

  return { loading, error, tournament, matches, serverAvailability, refresh };
}
