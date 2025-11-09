import { useState, useCallback, useEffect } from 'react';
import { io } from 'socket.io-client';
import type { Team, TeamStats, TeamStanding, TeamMatchInfo, TeamMatchHistory } from '../types';

interface UseTeamMatchDataReturn {
  team: Team | null;
  match: TeamMatchInfo | null;
  hasMatch: boolean;
  matchHistory: TeamMatchHistory[];
  stats: TeamStats | null;
  standing: TeamStanding | null;
  loading: boolean;
  error: string;
  tournamentStatus: string;
  setTournamentStatus: (status: string) => void;
  loadTeamMatch: () => Promise<void>;
  loadMatchHistory: () => Promise<void>;
  loadTeamStats: () => Promise<void>;
}

export function useTeamMatchData(teamId: string | undefined): UseTeamMatchDataReturn {
  const [team, setTeam] = useState<Team | null>(null);
  const [match, setMatch] = useState<TeamMatchInfo | null>(null);
  const [hasMatch, setHasMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchHistory, setMatchHistory] = useState<TeamMatchHistory[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [standing, setStanding] = useState<TeamStanding | null>(null);
  const [tournamentStatus, setTournamentStatus] = useState<string>('setup');

  const loadTeamMatch = useCallback(async () => {
    if (!teamId) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/team/${teamId}/match`);

      // Handle 404 gracefully (team or no matches)
      if (response.status === 404) {
        const data = await response.json();
        // Team doesn't exist
        if (data.error === 'Team not found') {
          setError('Team not found. Please check the URL.');
        } else {
          // Team exists but no matches - this is handled by hasMatch flag
          setHasMatch(false);
          setMatch(null);
        }
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch team match');
      }

      const data = await response.json();

      if (data.success) {
        setTeam(data.team);
        setHasMatch(data.hasMatch);
        setTournamentStatus(data.tournamentStatus || 'setup');

        if (data.hasMatch && data.match) {
          setMatch(data.match);
        } else {
          setMatch(null);
        }
      }
    } catch (err) {
      console.error('Error loading team match:', err);
      setError('Failed to load match information. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const loadMatchHistory = useCallback(async () => {
    if (!teamId) return;

    try {
      const response = await fetch(`/api/teams/${teamId}/matches`);
      if (response.ok) {
        const data = await response.json();
        setMatchHistory(data.matches || []);
      }
    } catch (err) {
      console.error('Failed to load match history:', err);
    }
  }, [teamId]);

  const loadTeamStats = useCallback(async () => {
    if (!teamId) return;

    try {
      const response = await fetch(`/api/teams/${teamId}/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setStanding(data.standing);
      }
    } catch (err) {
      console.error('Failed to load team stats:', err);
    }
  }, [teamId]);

  useEffect(() => {
    loadTeamMatch();
    loadMatchHistory();
    loadTeamStats();

    // Setup Socket.IO for real-time updates
    const socket = io();

    socket.on('match:update', () => {
      loadTeamMatch();
      loadMatchHistory();
      loadTeamStats();
    });

    socket.on('bracket:update', () => {
      // Refresh match data when bracket updates (e.g., match completed, new round started)
      loadTeamMatch();
      loadMatchHistory();
      loadTeamStats();
    });

    socket.on('tournament:update', (data: { deleted?: boolean; action?: string }) => {
      // Handle tournament deletion
      if (data.deleted || data.action === 'tournament_deleted') {
        setError('Tournament has been deleted');
        setMatch(null);
        setHasMatch(false);
        setMatchHistory([]);
        setStats(null);
        setStanding(null);
      } else {
        // Other tournament updates might affect team matches
        loadTeamMatch();
        loadMatchHistory();
        loadTeamStats();
      }
    });

    return () => {
      socket.close();
    };
  }, [teamId, loadTeamMatch, loadMatchHistory, loadTeamStats]);

  return {
    team,
    match,
    hasMatch,
    matchHistory,
    stats,
    standing,
    loading,
    error,
    tournamentStatus,
    setTournamentStatus,
    loadTeamMatch,
    loadMatchHistory,
    loadTeamStats,
  };
}
