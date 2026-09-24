import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../utils/api';
import { useIntegrationFor } from '../integrations/registry';
import { useResourceAvailability, type ResourceAvailabilityAnswer } from './useResourceAvailability';
import type { Match } from '../types/match.types';
import type { Tournament } from '../types/tournament.types';
import type { MatchesResponse, TournamentResponse } from '../types/api.types';

export interface ManageData {
  loading: boolean;
  error: string | null;
  tournament: Tournament | null;
  matches: Match[];
  serverAvailability: ResourceAvailabilityAnswer | null;
  refresh: () => void;
}

/**
 * Data for the Manage console. Reuses the exact endpoints and refresh
 * cadence the Matches and Dashboard pages already poll/subscribe to:
 * GET /api/matches (+ the same `match:update` / `bracket:update` sockets),
 * GET /api/tournament once, and — through the tournament's own game module,
 * on the same 5s cadence Matches.tsx uses — whatever that module's matches
 * wait for (3.0 phase E). The console used to name CS2's server-availability
 * route itself; a module with no resources is now simply never asked, and the
 * console's server counts and grid stay empty rather than reading zero.
 */
export function useManageData(): ManageData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const tournamentIntegration = useIntegrationFor(tournament);
  const [matches, setMatches] = useState<Match[]>([]);

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

  // Only the tournament's own module knows whether its matches wait for
  // anything, and where to ask. Null until the tournament is known, so a
  // manually reported one never asks at all.
  const { availability: serverAvailability, refresh: refreshAvailability } =
    useResourceAvailability(tournament ? tournamentIntegration : null, 5000);

  const refresh = useCallback(() => {
    void fetchMatches();
    void refreshAvailability();
    void fetchTournament();
  }, [fetchMatches, refreshAvailability, fetchTournament]);

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchMatches(), fetchTournament()]);
      if (!cancelled) setLoading(false);
    };
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [fetchMatches, fetchTournament]);

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

  return { loading, error, tournament, matches, serverAvailability, refresh };
}
