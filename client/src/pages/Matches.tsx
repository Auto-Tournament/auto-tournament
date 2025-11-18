import React, { useState, useEffect } from 'react';
import { Box, Typography, Grid, LinearProgress, Alert, Stack } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import AddIcon from '@mui/icons-material/Add';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { StatusLegend } from '../components/shared/StatusLegend';
import { MatchCard } from '../components/shared/MatchCard';
import { formatDate, getRoundLabel } from '../utils/matchUtils';
import { api } from '../utils/api';
import type { Match, MatchEvent, MatchesResponse } from '../types';

export default function Matches() {
  const navigate = useNavigate();
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [matchHistory, setMatchHistory] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<Map<string, MatchEvent['event']>>(new Map());
  const [connectionCounts, setConnectionCounts] = useState<Map<string, number>>(new Map());
  const [tournamentStatus, setTournamentStatus] = useState<string>('setup');

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Matches';
  }, []);

  // Download demo file
  const handleDownloadDemo = async (match: Match, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation(); // Prevent card click
    }

    if (!match.demoFilePath) return;

    try {
      // Create a temporary link to trigger download
      const link = document.createElement('a');
      link.href = `/api/demos/${match.slug}/download`;
      link.download = match.demoFilePath;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error downloading demo:', err);
    }
  };

  // Initialize Socket.io connection
  useEffect(() => {
    // Connect to same origin - works in both dev (proxied) and production (Caddy)
    const newSocket = io();

    newSocket.on('connect', () => {
      console.log('Socket.io connected');
    });

    newSocket.on(
      'match:update',
      (data: Match | { slug?: string; connectionStatus?: { totalConnected: number } }) => {
        const matchSlug = 'slug' in data ? data.slug : undefined;

        // Handle connection status updates
        if ('slug' in data && data.slug && 'connectionStatus' in data && data.connectionStatus) {
          setConnectionCounts((prev) => {
            const updated = new Map(prev);
            updated.set(matchSlug!, data.connectionStatus!.totalConnected);
            return updated;
          });
          return;
        }

        const match = data as Match;

        const matchIdOrSlugEquals = (m: Match) =>
          (match.id !== undefined && m.id === match.id) ||
          (!!match.slug && !!m.slug && m.slug === match.slug);

        const upsertMatch = (list: Match[], updatedMatch: Match) => {
          const index = list.findIndex(matchIdOrSlugEquals);
          if (index !== -1) {
            const updated = [...list];
            updated[index] = { ...updated[index], ...updatedMatch };
            return updated;
          }
          return [...list, updatedMatch];
        };

        const removeMatch = (list: Match[]) =>
          list.filter((m) => !matchIdOrSlugEquals(m));

        if (match.status === 'pending' || match.status === 'ready') {
          setUpcomingMatches((prev) => upsertMatch(prev, match));
          setLiveMatches((prev) => removeMatch(prev));
        } else if (match.status === 'live' || match.status === 'loaded') {
          setUpcomingMatches((prev) => removeMatch(prev));
          setLiveMatches((prev) => upsertMatch(prev, match));
        } else if (match.status === 'completed') {
          setUpcomingMatches((prev) => removeMatch(prev));
          setLiveMatches((prev) => removeMatch(prev));
          setMatchHistory((prev) => {
            const exists = prev.some(matchIdOrSlugEquals);
            if (exists) {
              return prev.map((m) => (matchIdOrSlugEquals(m) ? { ...m, ...match } : m));
            }
            return [match, ...prev];
          });
        }
      }
    );

    newSocket.on('match:event', (data: MatchEvent) => {
      setLiveEvents((prev) => {
        const updated = new Map(prev);
        updated.set(data.matchSlug, data.event);
        return updated;
      });
    });

    newSocket.on('bracket:update', () => {
      // Refresh matches when bracket updates
      fetchMatches();
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Fetch matches
  const fetchMatches = async () => {
    try {
      const data = await api.get<MatchesResponse & { tournamentStatus?: string }>('/api/matches');

      if (data.success) {
        const matches = data.matches || [];
        setTournamentStatus(data.tournamentStatus || 'setup');

        // Upcoming matches: pending and ready (including veto phase)
        const upcoming = matches.filter(
          (m) => (m.status === 'pending' || m.status === 'ready') && m.team1 && m.team2
        );

        // Live matches: only show matches with both teams assigned (loaded = warmup, live = in progress)
        const live = matches.filter(
          (m) => (m.status === 'live' || m.status === 'loaded') && m.team1 && m.team2
        );

        // History: show all completed matches including walkovers
        const history = matches
          .filter((m) => m.status === 'completed')
          .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        setUpcomingMatches(upcoming);
        setLiveMatches(live);
        setMatchHistory(history);
      }
    } catch (err) {
      setError('Failed to load matches');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches();
  }, []);

  // Calculate global match number based on all matches
  const getGlobalMatchNumber = (match: Match, allMatches: Match[]): number => {
    // Sort all matches by round, then by matchNumber
    const sortedMatches = [...allMatches].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.matchNumber - b.matchNumber;
    });

    return sortedMatches.findIndex((m) => m.id === match.id) + 1;
  };

  // Get all matches for numbering context
  const allMatches = [...upcomingMatches, ...liveMatches, ...matchHistory];

  if (loading) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <SportsEsportsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Matches
          </Typography>
        </Box>
        <LinearProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <SportsEsportsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Matches
          </Typography>
        </Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const hasMatches =
    upcomingMatches.length > 0 || liveMatches.length > 0 || matchHistory.length > 0;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <SportsEsportsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Matches
        </Typography>
      </Box>

      {/* Status Legend */}
      {hasMatches && (
        <Box mb={3}>
          <StatusLegend />
        </Box>
      )}

      {!hasMatches && (
        <EmptyState
          icon={SportsEsportsIcon}
          title="No matches to display"
          description="Create a tournament and generate brackets to see matches here"
          actionLabel="Create Tournament"
          actionIcon={AddIcon}
          onAction={() => navigate('/tournament')}
        />
      )}

      {hasMatches && (
        <Stack spacing={4}>
          {/* Live Matches Section */}
          {liveMatches.length > 0 && (
            <Box>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: 'error.main',
                    animation: 'pulse 2s ease-in-out infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.3 },
                    },
                  }}
                />
                <Typography variant="h6" fontWeight={600}>
                  Live Matches ({liveMatches.length})
                </Typography>
              </Box>
              <Grid container spacing={3}>
                {liveMatches.map((match) => {
                  const event = liveEvents.get(match.slug);
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={match.id}>
                      <Box>
                        <MatchCard
                          match={match}
                          matchNumber={matchNumber}
                          variant="live"
                          playerCount={connectionCounts.get(match.slug)}
                          liveScores={{
                            team1Score: event?.params?.team1_score,
                            team2Score: event?.params?.team2_score,
                          }}
                          showPlayerProgress={true}
                          onClick={() => setSelectedMatch(match)}
                        />
                        {event && event.event && (
                          <Box mt={1} p={1} bgcolor="action.hover" borderRadius={1}>
                            <Typography variant="caption" color="text.secondary">
                              Latest: {event.event.replace(/_/g, ' ')}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Upcoming Matches Section */}
          {upcomingMatches.length > 0 && (
            <Box>
              <Typography variant="h6" fontWeight={600} mb={2}>
                Upcoming Matches ({upcomingMatches.length})
              </Typography>
              <Grid container spacing={3}>
                {upcomingMatches.map((match) => {
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={match.id}>
                      <MatchCard
                        match={match}
                        matchNumber={matchNumber}
                        variant="default"
                        vetoCompleted={match.vetoCompleted}
                        tournamentStarted={tournamentStatus === 'in_progress'}
                        onClick={() => setSelectedMatch(match)}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Match History Section */}
          {matchHistory.length > 0 && (
            <Box>
              <Typography variant="h6" fontWeight={600} mb={2}>
                Match History ({matchHistory.length})
              </Typography>
              <Grid container spacing={3}>
                {matchHistory.map((match) => {
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={match.id}>
                      <Box>
                        <MatchCard
                          match={match}
                          matchNumber={matchNumber}
                          variant="completed"
                          onDownloadDemo={(e) => handleDownloadDemo(match, e)}
                          onClick={() => setSelectedMatch(match)}
                        />
                        {match.completedAt && (
                          <Box mt={1} p={1} bgcolor="action.hover" borderRadius={1}>
                            <Typography variant="caption" color="text.secondary">
                              Completed: {formatDate(match.completedAt)}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}
        </Stack>
      )}

      {/* Match Details Modal */}
      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={getGlobalMatchNumber(selectedMatch, allMatches)}
          roundLabel={getRoundLabel(selectedMatch.round)}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </Box>
  );
}
