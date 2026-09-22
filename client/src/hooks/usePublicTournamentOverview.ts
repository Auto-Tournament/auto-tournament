import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import type { Tournament } from '../types';

export interface OverviewTeamStanding {
  teamId: string;
  name: string;
  tag?: string | null;
}

interface TournamentOverviewResponse {
  success: boolean;
  tournament: Tournament;
  currentRound: number;
  totalRounds: number;
  teams?: OverviewTeamStanding[];
  liveMatchCount: number;
}

interface ViewerTeam {
  id: string;
  name: string;
  tag?: string;
}

export interface UsePublicTournamentOverviewResult {
  tournament: Tournament | null;
  totalRounds: number;
  liveMatchCount: number;
  /** The signed-in player's team, when they're on the roster of a team in this tournament. */
  viewerTeam: ViewerTeam | null;
  /** Whether the viewer is signed in with a Steam identity at all (linked or not). */
  viewerHasSteamIdentity: boolean;
  loading: boolean;
  error: string;
}

/**
 * Data for the public tournament "Overview" page: the tournament (with its
 * organizer-written event page settings), plus the viewer's own team when
 * they're playing in it.
 *
 * Both requests are public – no admin session required – so this works for
 * anonymous visitors as well as signed-in players.
 */
export function usePublicTournamentOverview(
  tournamentId: string | undefined
): UsePublicTournamentOverviewResult {
  const { playerSteamId } = useAuth();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [liveMatchCount, setLiveMatchCount] = useState(0);
  const [viewerTeam, setViewerTeam] = useState<ViewerTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    setError('');

    try {
      const response = await api.get<TournamentOverviewResponse>(
        `/api/tournament/${tournamentId}/leaderboard`
      );
      setTournament(response.tournament ?? null);
      setTotalRounds(response.totalRounds ?? 0);
      setLiveMatchCount(response.liveMatchCount ?? 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isNotFound = message.includes('404') || message.toLowerCase().includes('not found');
      if (!isNotFound) {
        setError(message);
      }
      setTournament(null);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve the viewer's own team, only when signed in with a Steam identity.
  useEffect(() => {
    if (!playerSteamId) {
      setViewerTeam(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await api.get<{ success: boolean; team: ViewerTeam | null }>(
          `/api/players/${playerSteamId}/team`
        );
        if (!cancelled) {
          setViewerTeam(response.team ?? null);
        }
      } catch {
        if (!cancelled) {
          setViewerTeam(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerSteamId]);

  // Only surface the viewer's team when it is actually part of this tournament.
  const teamIds = tournament?.teamIds ?? [];
  const viewerTeamInTournament =
    viewerTeam && teamIds.includes(viewerTeam.id) ? viewerTeam : null;

  return {
    tournament,
    totalRounds,
    liveMatchCount,
    viewerTeam: viewerTeamInTournament,
    viewerHasSteamIdentity: !!playerSteamId,
    loading,
    error,
  };
}
