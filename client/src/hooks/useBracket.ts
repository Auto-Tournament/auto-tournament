import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { io } from 'socket.io-client';
import type { Match, Tournament } from '../types';
import { useSnackbar } from '../contexts/SnackbarContext';

export const useBracket = () => {
  const { showSuccess, showError } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [starting, setStarting] = useState(false);

  const loadBracket = async () => {
    setLoading(true);
    setError('');

    try {
      const response: {
        success: boolean;
        tournament?: Tournament;
        matches?: Match[];
        totalRounds?: number;
      } = await api.get('/api/tournament/bracket');

      if (response.success && response.tournament) {
        setTournament(response.tournament);
        setMatches(response.matches || []);
        setTotalRounds(response.totalRounds || 0);
      } else {
        // No tournament yet - not an error, just empty state
        setTournament(null);
        setMatches([]);
        setTotalRounds(0);
      }
    } catch (err) {
      const error = err as Error;
      // Handle 404 gracefully - tournament doesn't exist yet (empty state)
      if (error.message.includes('404') || error.message.includes('No tournament')) {
        setTournament(null);
        setMatches([]);
        setTotalRounds(0);
      } else {
        // Real error - network issue, server error, etc.
        setError(error.message || 'Failed to load bracket');
      }
    } finally {
      setLoading(false);
    }
  };

  const startTournament = async () => {
    setStarting(true);

    try {
      const baseUrl = window.location.origin;
      const response: {
        success: boolean;
        message?: string;
        allocated?: number;
      } = await api.post('/api/tournament/start', { baseUrl });

      if (response.success) {
        showSuccess(
          `Tournament started! ${response.allocated || 0} matches allocated to servers.`
        );
        await loadBracket();
      } else {
        showError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    loadBracket();

    const newSocket = io();

    const applyMatchPatch = (payload: Record<string, unknown>) => {
      if (!payload) return;
      const slug =
        (payload.slug as string | undefined) ||
        (payload.matchSlug as string | undefined) ||
        (payload.match && typeof payload.match === 'object'
          ? ((payload.match as { slug?: string }).slug ?? undefined)
          : undefined);

      if (!slug) {
        return;
      }

      setMatches((prev) => {
        if (!prev.length) return prev;
        const index = prev.findIndex((match) => match.slug === slug);
        if (index === -1) return prev;

        const current = prev[index];
        const next: Match = { ...current };
        let changed = false;

        const status = (payload.status as Match['status'] | undefined) ??
          ((payload as { match_status?: string }).match_status as Match['status'] | undefined);
        if (status && status !== current.status) {
          next.status = status;
          changed = true;
        }

        const serverId =
          (payload.serverId as string | undefined) ||
          ((payload as { server_id?: string }).server_id ?? undefined);
        if (serverId !== undefined && serverId !== current.serverId) {
          next.serverId = serverId || undefined;
          changed = true;
        }

        const team1Score =
          (payload.team1Score as number | undefined) ||
          ((payload as { team1_score?: number }).team1_score ?? undefined);
        if (typeof team1Score === 'number' && team1Score !== current.team1Score) {
          next.team1Score = team1Score;
          changed = true;
        }

        const team2Score =
          (payload.team2Score as number | undefined) ||
          ((payload as { team2_score?: number }).team2_score ?? undefined);
        if (typeof team2Score === 'number' && team2Score !== current.team2Score) {
          next.team2Score = team2Score;
          changed = true;
        }

        if (!changed) {
          return prev;
        }

        const clone = [...prev];
        clone[index] = next;
        return clone;
      });
    };

    const handleBracketUpdate = (event: Record<string, unknown>) => {
      if (!event) return;

      const action = event.action as string | undefined;
      const slug = event.matchSlug as string | undefined;
      const status = event.status as Tournament['status'] | undefined;

      if (status) {
        setTournament((prev) => (prev ? { ...prev, status } : prev));
      }

      const requiresFullReload = !action
        ? true
        : [
            'bracket_regenerated',
            'tournament_reset',
            'tournament_restarted',
            'tournament_updated',
            'tournament_completed',
            'tournament_started',
          ].includes(action);

      if (requiresFullReload) {
        loadBracket();
        return;
      }

      if (!slug) {
        return;
      }

      setMatches((prev) => {
        if (!prev.length) return prev;
        const index = prev.findIndex((match) => match.slug === slug);
        if (index === -1) return prev;

        const current = prev[index];
        const next: Match = { ...current };
        let changed = false;

        if (action === 'match_status') {
          const newStatus =
            (event.status as Match['status'] | undefined) ??
            (event.matchStatus as Match['status'] | undefined);
          if (newStatus && newStatus !== current.status) {
            next.status = newStatus;
            changed = true;
          }
        } else if (action === 'match_ready') {
          if (current.status !== 'ready') {
            next.status = 'ready';
            changed = true;
          }
        } else if (action === 'match_loaded') {
          if (current.status !== 'loaded') {
            next.status = 'loaded';
            changed = true;
          }
        } else if (action === 'match_restarted') {
          if (current.status !== 'loaded') {
            next.status = 'loaded';
            changed = true;
          }
        } else if (action === 'server_assigned' || action === 'match_allocated') {
          const serverId =
            (event.serverId as string | undefined) ??
            ((event as { server_id?: string }).server_id ?? undefined);
          if (serverId !== undefined && serverId !== current.serverId) {
            next.serverId = serverId || undefined;
            changed = true;
          }
        }

        if (!changed) return prev;
        const clone = [...prev];
        clone[index] = next;
        return clone;
      });
    };

    newSocket.on('match:update', applyMatchPatch);
    newSocket.on('bracket:update', handleBracketUpdate);

    return () => {
      newSocket.off('match:update', applyMatchPatch);
      newSocket.off('bracket:update', handleBracketUpdate);
      newSocket.close();
    };
  }, []);

  return {
    loading,
    error,
    tournament,
    matches,
    totalRounds,
    starting,
    loadBracket,
    startTournament,
  };
};
