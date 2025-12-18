import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import type {
  Match,
  Team,
  Tournament,
  TeamsResponse,
  TournamentResponse,
  TournamentBracketResponse,
} from '../types';

// Extended Tournament with teams array
interface TournamentDetailed extends Tournament {
  teams: Array<{ id: string; name: string; tag?: string }>;
}

export const useTournament = () => {
  const [tournament, setTournament] = useState<TournamentDetailed | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasBracket, setHasBracket] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      // Load teams
      const teamsResponse = await api.get<TeamsResponse>('/api/teams');
      const loadedTeams = teamsResponse.teams || [];
      setTeams(loadedTeams);

      // Try to load existing tournament
      try {
        const tournamentResponse = await api.get<
          TournamentResponse & { tournament: TournamentDetailed }
        >('/api/tournament');
        if (tournamentResponse.success) {
          const t = tournamentResponse.tournament;
          setTournament(t);

          // Check if tournament is in broken state
          if (t.status === 'setup') {
            try {
              const bracketResponse = await api.get<
                TournamentBracketResponse & { matches: Match[] }
              >('/api/tournament/bracket');

              if (bracketResponse.matches && bracketResponse.matches.length > 0) {
                setHasBracket(true);
              } else {
                setHasBracket(false);
                setError(
                  'Warning: Tournament exists but has no bracket. This may be from a failed bracket generation. ' +
                    'Use "Save & Generate Brackets" on the setup form before trying to regenerate.'
                );
              }
            } catch {
              // Bracket endpoint failed – treat as no bracket yet
              setHasBracket(false);
            }
          } else {
            // Non-setup tournaments have already generated matches/bracket
            setHasBracket(true);
          }
        }
      } catch {
        // No tournament exists yet
        setTournament(null);
        setHasBracket(false);
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load data');
      setHasBracket(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveTournament = async (payload: {
    name: string;
    type: string;
    format: string;
    maps: string[];
    teamIds: string[];
    settings: { seedingMethod: string };
  }) => {
    const response = await api[tournament ? 'put' : 'post']<
      TournamentResponse & { tournament: TournamentDetailed }
    >('/api/tournament', payload);

    setTournament(response.tournament);
    return response;
  };

  const deleteTournament = async () => {
    await api.delete('/api/tournament');
    setTournament(null);
  };

  const regenerateBracket = async (force = false) => {
    const response = await api.post<TournamentResponse & { tournament: TournamentDetailed }>(
      '/api/tournament/bracket/regenerate',
      { force }
    );
    setTournament(response.tournament);
    return response;
  };

  const resetTournament = async () => {
    const response = await api.post<TournamentResponse & { tournament: TournamentDetailed }>(
      '/api/tournament/reset'
    );
    setTournament(response.tournament);
    return response;
  };

  const startTournament = async (baseUrl: string, options?: { enableSimulation?: boolean }) => {
    const payload: Record<string, unknown> = { baseUrl };
    if (options && typeof options.enableSimulation === 'boolean') {
      payload.enableSimulation = options.enableSimulation;
    }
    const response = await api.post<TournamentResponse & { tournament: TournamentDetailed }>(
      '/api/tournament/start',
      payload
    );
    // Reload tournament data after starting
    await loadData();
    return response;
  };

  const restartTournament = async (baseUrl: string) => {
    const response = await api.post<{
      success: boolean;
      message: string;
      restarted: number;
      allocated: number;
      failed: number;
      restartFailed: number;
    }>('/api/tournament/restart', { baseUrl });
    // Reload tournament data after restarting
    await loadData();
    return response;
  };

  return {
    tournament,
    teams,
    loading,
    error,
    setError,
    saveTournament,
    deleteTournament,
    regenerateBracket,
    resetTournament,
    startTournament,
    restartTournament,
    refreshData: loadData,
    hasBracket,
  };
};
