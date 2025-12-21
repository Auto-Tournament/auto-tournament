import React, { useState, useEffect } from 'react';
import { Box, Typography, Grid, LinearProgress, Snackbar, Alert, Stack, Button } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import AddIcon from '@mui/icons-material/Add';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from '../contexts/SnackbarContext';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { CreateManualMatchModal } from '../components/modals/CreateManualMatchModal';
import { EmptyState } from '../components/shared/EmptyState';
import { StatusLegend } from '../components/shared/StatusLegend';
import { MatchCard } from '../components/shared/MatchCard';
import { getRoundLabel } from '../utils/matchUtils';
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
  const [tournamentStatus, setTournamentStatus] = useState<string>('setup');
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  const { showSuccess } = useSnackbar();
  const [allocationCountdown, setAllocationCountdown] = useState<{
    nextAllocationInSeconds: number | null;
    gracePeriodSeconds: number;
  }>({
    nextAllocationInSeconds: null,
    gracePeriodSeconds: 300,
  });

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Matches';
  }, []);

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
        // Handle connection status updates
        if ('slug' in data && data.slug && 'connectionStatus' in data && data.connectionStatus) {
          // We still accept connection status payloads here for backward
          // compatibility, but the Matches list no longer uses the aggregate
          // counts directly. The detailed Team view pulls live connection
          // status from its own hook.
          return;
        }

        const match = data as Match & {
          liveStats?: { team1Score?: number; team2Score?: number; team1SeriesScore?: number; team2SeriesScore?: number };
        };

        const matchIdOrSlugEquals = (m: Match) =>
          (match.id !== undefined && m.id === match.id) ||
          (!!match.slug && !!m.slug && m.slug === match.slug);

        const applyLiveScoreOverlay = (base: Match, updates: typeof match): Match => {
          const next: Match = { ...base, ...updates };
          const liveStats = updates.liveStats;
          if (liveStats && next.status !== 'completed') {
            // For in‑progress matches, use current map rounds from liveStats so
            // match cards show 8‑5 / 13‑7 etc. instead of staying at 0‑0 until
            // the map completes. Completed matches keep their persisted series score.
            if (typeof liveStats.team1Score === 'number') {
              next.team1Score = liveStats.team1Score;
            }
            if (typeof liveStats.team2Score === 'number') {
              next.team2Score = liveStats.team2Score;
            }
          }
          return next;
        };

        const upsertMatch = (list: Match[], updatedMatch: typeof match) => {
          const index = list.findIndex(matchIdOrSlugEquals);
          if (index !== -1) {
            const updated = [...list];
            updated[index] = applyLiveScoreOverlay(updated[index], updatedMatch);
            return updated;
          }
          return [...list, applyLiveScoreOverlay(updatedMatch as Match, updatedMatch)];
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
              return prev.map((m) =>
                matchIdOrSlugEquals(m) ? applyLiveScoreOverlay(m, match) : m
              );
            }
            return [applyLiveScoreOverlay(match as Match, match), ...prev];
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

  // Poll allocation status periodically so we can show a lightweight
  // "next servers in Xs" indicator on the Matches page.
  useEffect(() => {
    const loadAllocationStatus = async () => {
      try {
        const availability = await api.get<{
          success: boolean;
          availableServerCount: number;
          gracePeriodSeconds?: number;
          nextAllocationInSeconds?: number | null;
        }>('/api/tournament/server-availability');

        if (availability.success) {
          setAllocationCountdown({
            gracePeriodSeconds: availability.gracePeriodSeconds ?? 300,
            nextAllocationInSeconds:
              typeof availability.nextAllocationInSeconds === 'number'
                ? availability.nextAllocationInSeconds
                : null,
          });
        }
      } catch (err) {
        console.error('Failed to load allocation status for Matches page:', err);
      }
    };

    void loadAllocationStatus();
    const interval = setInterval(() => {
      void loadAllocationStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Local per‑second tick for countdown on this page
  useEffect(() => {
    if (
      allocationCountdown.nextAllocationInSeconds === null ||
      allocationCountdown.nextAllocationInSeconds <= 0
    ) {
      return;
    }

    const timer = setInterval(
      () =>
        setAllocationCountdown((prev) => ({
          ...prev,
          nextAllocationInSeconds:
            prev.nextAllocationInSeconds !== null && prev.nextAllocationInSeconds > 0
              ? prev.nextAllocationInSeconds - 1
              : 0,
        })),
      1000
    );

    return () => clearInterval(timer);
  }, [allocationCountdown.nextAllocationInSeconds]);

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
        <LinearProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Typography variant="h6" color="error" gutterBottom>
          Error loading matches
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
        <Snackbar
          open={!!error}
          autoHideDuration={6000}
          onClose={() => setError(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="error" onClose={() => setError(null)} variant="filled">
            {error}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

  const hasMatches =
    upcomingMatches.length > 0 || liveMatches.length > 0 || matchHistory.length > 0;

  return (
    <Box data-testid="matches-page" sx={{ width: '100%', height: '100%' }}>

      {/* Manual match creation + allocation countdown */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        {allocationCountdown.nextAllocationInSeconds !== null &&
          allocationCountdown.nextAllocationInSeconds > 0 && (
            <Typography variant="body2" color="text.secondary">
              Next servers allocated in{' '}
              <strong>{Math.max(0, allocationCountdown.nextAllocationInSeconds)}s</strong>
            </Typography>
          )}
        <Button variant="contained" size="small" onClick={() => setCreateMatchOpen(true)}>
          Create Match
        </Button>
      </Box>

      {/* Status Legend */}
      {hasMatches && (
        <Box mb={3}>
          <StatusLegend />
        </Box>
      )}

      {!hasMatches && (
        <EmptyState
          data-testid="matches-empty-state"
          icon={SportsEsportsIcon}
          title="No matches to display"
          description="Create a tournament and generate brackets to see matches here"
          actionLabel="Create Tournament"
          actionIcon={AddIcon}
          onAction={() => navigate('/tournament')}
        />
      )}

      {hasMatches && (
        <Stack spacing={4} data-testid="matches-list">
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
              <Grid container spacing={2}>
                {liveMatches.map((match) => {
                  const event = liveEvents.get(match.slug);
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }} key={match.id}>
                      <Box>
                        <MatchCard
                          match={match}
                          matchNumber={matchNumber}
                          variant="live"
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
              <Grid container spacing={2}>
                {upcomingMatches.map((match) => {
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }} key={match.id}>
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
              <Grid container spacing={2}>
                {matchHistory.map((match) => {
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }} key={match.id}>
                      <Box>
                        <MatchCard
                          match={match}
                          matchNumber={matchNumber}
                          variant="completed"
                          onClick={() => setSelectedMatch(match)}
                        />
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

      {/* Create manual match modal */}
      <CreateManualMatchModal
        open={createMatchOpen}
        onClose={() => setCreateMatchOpen(false)}
        onCreated={(slug) => {
          setCreateMatchOpen(false);
          showSuccess(`Manual match created: ${slug}`);
          void fetchMatches();
        }}
      />
    </Box>
  );
}
