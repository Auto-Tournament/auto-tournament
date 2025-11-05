import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Match, Team } from '../types';

interface TournamentDetailed {
  id: number;
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'setup' | 'ready' | 'in_progress' | 'completed';
  maps: string[];
  teamIds: string[];
  settings: {
    matchFormat: string;
    thirdPlaceMatch: boolean;
    autoAdvance: boolean;
    checkInRequired: boolean;
    seedingMethod: 'seeded' | 'random';
  };
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  teams: Array<{ id: string; name: string; tag?: string }>;
}

export const useTournament = () => {
  const [tournament, setTournament] = useState<TournamentDetailed | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      // Load teams
      const teamsResponse: { teams: Team[] } = await api.get('/api/teams');
      const loadedTeams = teamsResponse.teams || [];
      setTeams(loadedTeams);

      // Try to load existing tournament
      try {
        const tournamentResponse: { success: boolean; tournament: TournamentDetailed } = await api.get('/api/tournament');
        if (tournamentResponse.success) {
          const t = tournamentResponse.tournament;
          setTournament(t);

          // Check if tournament is in broken state
          if (t.status === 'setup') {
            try {
              const bracketResponse: { success: boolean; matches: Match[] } = await api.get('/api/tournament/bracket');
              if (!bracketResponse.matches || bracketResponse.matches.length === 0) {
                setError(
                  'Warning: Tournament exists but has no bracket. This may be from a failed bracket generation. ' +
                    'Consider deleting and recreating the tournament.'
                );
              }
            } catch {
              // Bracket endpoint failed
            }
          }
        }
      } catch {
        // No tournament exists yet
        setTournament(null);
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load data');
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
    const response: { success: boolean; tournament: TournamentDetailed } = tournament
      ? await api.put('/api/tournament', payload)
      : await api.post('/api/tournament', payload);

    setTournament(response.tournament);
    return response;
  };

  const deleteTournament = async () => {
    await api.delete('/api/tournament');
    setTournament(null);
  };

  const regenerateBracket = async (force = false) => {
    const response: { success: boolean; tournament: TournamentDetailed } = await api.post('/api/tournament/bracket/regenerate', { force });
    setTournament(response.tournament);
    return response;
  };

  const resetTournament = async () => {
    const response: { success: boolean; tournament: TournamentDetailed } = await api.post('/api/tournament/reset');
    setTournament(response.tournament);
    return response;
  };

  const startTournament = async (baseUrl: string) => {
    const response: { success: boolean; tournament: TournamentDetailed } = await api.post('/api/tournament/start', { baseUrl });
    // Reload tournament data after starting
    await loadData();
    return response;
  };

  const restartTournament = async (baseUrl: string) => {
    const response: { success: boolean; message: string; restarted: number; allocated: number; failed: number; restartFailed: number } = await api.post('/api/tournament/restart', { baseUrl });
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
  };
};
