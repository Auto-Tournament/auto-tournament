import { useState, useCallback, useEffect, useRef } from 'react';
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
  updating: boolean; // Silent background updates
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
  const [loading, setLoading] = useState(true); // Only for initial load
  const [updating, setUpdating] = useState(false); // For background updates
  const [error, setError] = useState('');
  const [matchHistory, setMatchHistory] = useState<TeamMatchHistory[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [standing, setStanding] = useState<TeamStanding | null>(null);
  const [tournamentStatus, setTournamentStatus] = useState<string>('setup');
  
  // Use ref to track current match slug to avoid infinite loops
  const currentMatchSlugRef = useRef<string | null>(null);

  const loadTeamMatch = useCallback(
    async (silent = false) => {
      if (!teamId) return;

      // Only show loading spinner on initial load, not on updates
      if (!silent) {
        setLoading(true);
      } else {
        setUpdating(true);
      }
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
          setUpdating(false);
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
        if (!silent) {
          setError('Failed to load match information. Please try again.');
        }
      } finally {
        setLoading(false);
        setUpdating(false);
      }
    },
    [teamId]
  );

  const loadMatchHistory = useCallback(
    async (silent = false) => {
      if (!teamId) return;

      if (!silent) setUpdating(true);

      try {
        const response = await fetch(`/api/team/${teamId}/history`);
        if (response.ok) {
          const data = await response.json();
          setMatchHistory(data.matches || []);
        }
      } catch (err) {
        console.error('Failed to load match history:', err);
      } finally {
        if (!silent) setUpdating(false);
      }
    },
    [teamId]
  );

  const loadTeamStats = useCallback(
    async (silent = false) => {
      if (!teamId) return;

      if (!silent) setUpdating(true);

      try {
        const response = await fetch(`/api/team/${teamId}/stats`);
        if (response.ok) {
          const data = await response.json();
          setStats(data.stats);
          setStanding(data.standing);
        }
      } catch (err) {
        console.error('Failed to load team stats:', err);
      } finally {
        if (!silent) setUpdating(false);
      }
    },
    [teamId]
  );

  // Update ref when match changes
  useEffect(() => {
    if (match) {
      currentMatchSlugRef.current = match.slug;
    }
  }, [match]);

  useEffect(() => {
    if (!teamId) return;

    // Initial load (with loading spinner)
    loadTeamMatch(false);
    loadMatchHistory(false);
    loadTeamStats(false);

    // Setup Socket.IO for real-time updates
    const socket = io();

    // Use silent updates for socket events to avoid loading spinner
    socket.on('match:update', (data: { slug?: string }) => {
      // Only update if it's relevant to this team's current match
      if (!data.slug || data.slug === currentMatchSlugRef.current) {
        loadTeamMatch(true); // Silent update
      }
    });

    socket.on('bracket:update', () => {
      // Refresh match data when bracket updates (silent)
      loadTeamMatch(true);
      loadMatchHistory(true);
      loadTeamStats(true);
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
        currentMatchSlugRef.current = null;
      } else {
        // Other tournament updates (silent)
        loadTeamMatch(true);
        loadMatchHistory(true);
        loadTeamStats(true);
      }
    });

    return () => {
      socket.close();
    };
    // Only re-run if teamId changes, not on every state update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  return {
    team,
    match,
    hasMatch,
    matchHistory,
    stats,
    standing,
    loading,
    updating,
    error,
    tournamentStatus,
    setTournamentStatus,
    loadTeamMatch,
    loadMatchHistory,
    loadTeamStats,
  };
}
