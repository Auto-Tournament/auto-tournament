import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { io } from 'socket.io-client';
import type { Match, Tournament } from '../types';
import { useSnackbar } from '../contexts/SnackbarContext';

export const useBracket = () => {
  const { showSuccess, showError, showWarning, showSnackbar } = useSnackbar();
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
        showSuccess(`Tournament started! ${response.allocated || 0} matches allocated to servers.`);
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
          ? (payload.match as { slug?: string }).slug ?? undefined
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

        let newStatus: Match['status'] | undefined;

        const status =
          (payload.status as Match['status'] | undefined) ??
          ((payload as { match_status?: string }).match_status as Match['status'] | undefined);
        if (status && status !== current.status) {
          next.status = status;
          newStatus = status;
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

        const winnerId =
          (payload.winnerId as string | undefined) ||
          ((payload as { winner_id?: string }).winner_id ?? undefined);
        if (winnerId && (!current.winner || current.winner.id !== winnerId)) {
          const winnerTeam =
            current.team1?.id === winnerId
              ? current.team1
              : current.team2?.id === winnerId
              ? current.team2
              : undefined;
          if (winnerTeam) {
            next.winner = winnerTeam;
            changed = true;
          }
        }

        if (!changed) {
          return prev;
        }

        // Emit snackbars for key match lifecycle transitions
        if (newStatus === 'completed') {
          const winnerName = next.winner?.name;
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          showSuccess(
            winnerName
              ? `Match completed: ${label} – ${winnerName} won`
              : `Match completed: ${label}`
          );
        } else if (newStatus === 'live') {
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          showSnackbar(`Match is now live: ${label}`, 'info');
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

        if (status === 'completed') {
          showSuccess('Tournament completed! All matches are finished.');
        } else if (status === 'in_progress' && action === 'tournament_started') {
          showSuccess('Tournament started – Round 1 is now live.');
        }
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
            // Structural changes that add/remove matches (e.g., next round generated)
            'round_advanced',
          ].includes(action);

      if (requiresFullReload) {
        if (
          action === 'round_advanced' &&
          typeof (event as { roundNumber?: number }).roundNumber === 'number'
        ) {
          const roundNumber = (event as { roundNumber: number }).roundNumber;
          showSnackbar(`Round ${roundNumber} generated – matches are ready to allocate.`, 'info');
        }

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
            (event as { server_id?: string }).server_id ??
            undefined;
          if (serverId !== undefined && serverId !== current.serverId) {
            next.serverId = serverId || undefined;
            changed = true;
          }
        }

        if (!changed) return prev;

        if (action === 'server_assigned' || action === 'match_allocated') {
          const label =
            next.team1 && next.team2 ? `${next.team1.name} vs ${next.team2.name}` : next.slug;
          const id =
            (event.serverId as string | undefined) ??
            (event as { server_id?: string }).server_id ??
            undefined;
          showSnackbar(
            id ? `Allocated server ${id} to match ${label}` : `Allocated server to match ${label}`,
            'info'
          );
        }
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
