import { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type {
  Team,
  TeamStats,
  TeamStanding,
  TeamMatchInfo,
  TeamMatchHistory,
  MatchConnectionStatus,
  MatchLiveStats,
  MatchPlayerStatsSnapshot,
} from '../types';

type BracketSocketEvent = {
  matchSlug?: string;
  [key: string]: unknown;
};

type TournamentSocketEvent = {
  deleted?: boolean;
  action?: string;
  matchSlug?: string;
  [key: string]: unknown;
};

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
  loadTeamMatch: (silent?: boolean) => Promise<void>;
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

  const mergeConnectionStatus = useCallback((slug: string, status: MatchConnectionStatus) => {
    setMatch((prev) => {
      if (!prev || prev.slug !== slug) return prev;
      if (
        prev.connectionStatus &&
        prev.connectionStatus.totalConnected === status.totalConnected &&
        prev.connectionStatus.lastUpdated >= status.lastUpdated
      ) {
        return prev;
      }
      return {
        ...prev,
        connectionStatus: status,
      };
    });
  }, []);

  const swapPlayerStats = useCallback((stats?: MatchPlayerStatsSnapshot | null) => {
    if (!stats) return stats ?? null;
    return {
      team1: [...stats.team2],
      team2: [...stats.team1],
    };
  }, []);

  const mergeLiveStats = useCallback((slug: string, stats: MatchLiveStats) => {
    setMatch((prev) => {
      if (!prev || prev.slug !== slug) return prev;
      const normalizedStats = prev.isTeam1
        ? stats
        : {
            ...stats,
            team1Score: stats.team2Score,
            team2Score: stats.team1Score,
            team1SeriesScore: stats.team2SeriesScore,
            team2SeriesScore: stats.team1SeriesScore,
            playerStats: swapPlayerStats(stats.playerStats),
          };
      if (prev.liveStats && prev.liveStats.lastEventAt >= normalizedStats.lastEventAt) {
        return prev;
      }
      return {
        ...prev,
        liveStats: normalizedStats,
      };
    });
  }, [swapPlayerStats]);

  const fetchConnectionStatus = useCallback(
    async (slug: string) => {
      try {
        const response = await fetch(`/api/events/connections/${slug}`);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data?.success) {
          mergeConnectionStatus(slug, {
            matchSlug: slug,
            connectedPlayers: data.connectedPlayers || [],
            team1Connected: data.team1Connected || 0,
            team2Connected: data.team2Connected || 0,
            totalConnected: data.totalConnected || 0,
            lastUpdated: data.lastUpdated || Date.now(),
          });
        }
      } catch (err) {
        console.error('Failed to fetch connection status snapshot', err);
      }
    },
    [mergeConnectionStatus]
  );

  const fetchLiveStats = useCallback(
    async (slug: string) => {
      try {
        const response = await fetch(`/api/events/live/${slug}`);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data?.success) {
          mergeLiveStats(slug, {
            matchSlug: slug,
            team1Score: data.team1Score ?? 0,
            team2Score: data.team2Score ?? 0,
            team1SeriesScore: data.team1SeriesScore ?? 0,
            team2SeriesScore: data.team2SeriesScore ?? 0,
            roundNumber: data.roundNumber ?? 0,
            mapNumber: data.mapNumber ?? 0,
            status: data.status ?? 'warmup',
            lastEventAt: data.lastEventAt ?? Date.now(),
            mapName: data.mapName ?? null,
            totalMaps: data.totalMaps ?? 1,
            playerStats: data.playerStats ?? null,
          });
        }
      } catch (err) {
        console.error('Failed to fetch live stats snapshot', err);
      }
    },
    [mergeLiveStats]
  );

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

  const currentMatchSlug = match?.slug ?? null;

  useEffect(() => {
    if (!currentMatchSlug) return;
    fetchConnectionStatus(currentMatchSlug);
    fetchLiveStats(currentMatchSlug);
  }, [currentMatchSlug, fetchConnectionStatus, fetchLiveStats]);

  useEffect(() => {
    if (!teamId) return;

    // Initial load (with loading spinner)
    loadTeamMatch(false);
    loadMatchHistory(false);
    loadTeamStats(false);

    // Setup Socket.IO for real-time updates
    const socket = io();

    const handleMatchUpdate = (data: {
      slug?: string;
      matchSlug?: string;
      status?: TeamMatchInfo['status'];
      connectionStatus?: MatchConnectionStatus;
      liveStats?: MatchLiveStats;
    }) => {
      const messageSlug = data.slug || data.matchSlug;
      const trackedSlug = currentMatchSlugRef.current;

      if (!messageSlug) {
        return;
      }

      if (trackedSlug && messageSlug === trackedSlug) {
        let appliedPatch = false;

        setMatch((prev) => {
          if (!prev || prev.slug !== messageSlug) {
            return prev;
          }

          let changed = false;
          const updated: TeamMatchInfo = { ...prev };

          if (data.status && data.status !== prev.status) {
            updated.status = data.status;
            changed = true;
          }

          if (data.connectionStatus) {
            updated.connectionStatus = data.connectionStatus;
            changed = true;
          }

          if (data.liveStats) {
            updated.liveStats = prev.isTeam1
              ? data.liveStats
              : {
                  ...data.liveStats,
                  team1Score: data.liveStats.team2Score,
                  team2Score: data.liveStats.team1Score,
                  team1SeriesScore: data.liveStats.team2SeriesScore,
                  team2SeriesScore: data.liveStats.team1SeriesScore,
                  playerStats: swapPlayerStats(data.liveStats.playerStats),
                };
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(data, 'currentMap') || Object.prototype.hasOwnProperty.call(data, 'current_map')) {
            const nextMap =
              (data as Record<string, unknown>).currentMap ??
              (data as Record<string, unknown>).current_map ??
              null;
            updated.currentMap = typeof nextMap === 'string' ? nextMap : null;
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(data, 'mapNumber') || Object.prototype.hasOwnProperty.call(data, 'map_number')) {
            const nextMapNumber =
              (data as Record<string, unknown>).mapNumber ??
              (data as Record<string, unknown>).map_number ??
              null;
            updated.mapNumber =
              typeof nextMapNumber === 'number' && Number.isFinite(nextMapNumber)
                ? Number(nextMapNumber)
                : updated.mapNumber ?? null;
            changed = true;
          }

          if (Array.isArray((data as Record<string, unknown>).mapResults)) {
            updated.mapResults = (data as { mapResults: TeamMatchInfo['mapResults'] }).mapResults;
            changed = true;
          }

          if (changed) {
            appliedPatch = true;
            return updated;
          }

          return prev;
        });

        if (!appliedPatch) {
          fetchConnectionStatus(messageSlug);
          fetchLiveStats(messageSlug);
        }
        return;
      }

      // Ignore updates for other matches
    };

    const handleBracketUpdate = (event?: BracketSocketEvent) => {
      const trackedSlug = currentMatchSlugRef.current;
      if (!trackedSlug) return;
      if (event?.matchSlug && event.matchSlug !== trackedSlug) {
        return;
      }
      loadTeamMatch(true);
    };

    const handleTournamentUpdate = (
      data?: TournamentSocketEvent
    ) => {
      if (!data) return;

      if (data.deleted || data.action === 'tournament_deleted') {
        setError('Tournament has been deleted');
        setMatch(null);
        setHasMatch(false);
        setMatchHistory([]);
        setStats(null);
        setStanding(null);
        currentMatchSlugRef.current = null;
        return;
      }

      const trackedSlug = currentMatchSlugRef.current;
      if (!trackedSlug) return;
      if (data.matchSlug && data.matchSlug !== trackedSlug) {
        return;
      }

      const refreshActions = new Set([
        'tournament_reset',
        'tournament_restarted',
        'bracket_regenerated',
        'match_loaded',
        'match_restarted',
        'server_assigned',
      ]);

      if (data.action && !refreshActions.has(data.action)) {
        return;
      }

      loadTeamMatch(true);
    };

    // Use silent updates for socket events to avoid loading spinner
    socket.on('match:update', handleMatchUpdate);
    socket.on('bracket:update', handleBracketUpdate);
    socket.on('tournament:update', handleTournamentUpdate);

    return () => {
      socket.off('match:update', handleMatchUpdate);
      socket.off('bracket:update', handleBracketUpdate);
      socket.off('tournament:update', handleTournamentUpdate);
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
