import React, { useState, useEffect, useCallback } from 'react';
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
import { isManualMatch as isManualMatchFlag } from '../utils/matchFlags';
import { api } from '../utils/api';
import type { Match, MatchEvent, MatchesResponse } from '../types';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { useTranslation } from 'react-i18next';

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
  const { showSuccess, showError } = useSnackbar();
  const [allocationCountdown, setAllocationCountdown] = useState<{
    nextAllocationInSeconds: number | null;
    gracePeriodSeconds: number;
  }>({
    nextAllocationInSeconds: null,
    gracePeriodSeconds: 120,
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMatchSlugs, setSelectedMatchSlugs] = useState<Set<string>>(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const { t } = useTranslation();

  // Fetch matches
  const fetchMatches = useCallback(async () => {
    try {
      const data = await api.get<MatchesResponse & { tournamentStatus?: string }>('/api/matches');

      if (data.success) {
        const matches = data.matches || [];
        setTournamentStatus(data.tournamentStatus || 'setup');

        const hasTeams = (m: Match) => {
          // Manual matches (round = 0) don't have bracket-seeded teams; rely on
          // config team names, but skip pure "TBD" placeholders.
          if (m.round === 0) {
            const cfgTeam1Name = (m.config?.team1 as { name?: string } | undefined)?.name;
            const cfgTeam2Name = (m.config?.team2 as { name?: string } | undefined)?.name;
            return Boolean(
              cfgTeam1Name &&
                cfgTeam1Name !== 'TBD' &&
                cfgTeam2Name &&
                cfgTeam2Name !== 'TBD'
            );
          }

          // Bracket / tournament matches: only consider teams truly assigned in
          // the bracket (DB-backed team rows). This prevents future-round
          // matches with "TBD" placeholders in config from appearing in
          // Upcoming/Live sections.
          return Boolean(m.team1 && m.team2);
        };

        // Upcoming matches: pending and ready (including veto phase)
        const upcoming = matches.filter(
          (m) => (m.status === 'pending' || m.status === 'ready') && hasTeams(m)
        );

        // Live matches: only show matches with both teams effectively assigned
        const live = matches.filter(
          (m) => (m.status === 'live' || m.status === 'loaded') && hasTeams(m)
        );

        // History: show all completed matches including walkovers
        const history = matches
          .filter((m) => m.status === 'completed')
          .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        setUpcomingMatches(upcoming);
        setLiveMatches(live);
        setMatchHistory(history);
        // Clear any selections that no longer exist
        setSelectedMatchSlugs((prev) => {
          if (prev.size === 0) return prev;
          const existingSlugs = new Set(matches.map((m) => m.slug));
          const next = new Set<string>();
          prev.forEach((slug) => {
            if (existingSlugs.has(slug)) {
              next.add(slug);
            }
          });
          return next;
        });
      }
    } catch (err) {
      setError(t('matchesPage.errors.loadMatches'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Set dynamic page title
  useEffect(() => {
    document.title = t('layout.pageTitle.matches');
  }, [t]);

  // Initialize Socket.io connection (mount-only)
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
          const statusFromUpdate = updates.status as Match['status'] | undefined;
          const isCompletedUpdate = statusFromUpdate === 'completed';

          // Start from the existing match state
          const next: Match = { ...base };

          // When a match transitions into the completed state via websocket,
          // explicitly reset both scores back to 0-0 before applying the
          // final series result from the payload. This avoids transient
          // hybrids like "9-1" where only the winner's side was updated.
          if (isCompletedUpdate) {
            next.team1Score = 0;
            next.team2Score = 0;
          }

          Object.assign(next, updates);

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

        const hasTeams = (m: Match | typeof match) =>
          Boolean(
            // Bracket / enriched matches with DB-backed team rows
            ((m as Match).team1 || (m as Match).config?.team1) &&
              ((m as Match).team2 || (m as Match).config?.team2)
          );

        const upsertMatch = (list: Match[], updatedMatch: typeof match) => {
          const index = list.findIndex(matchIdOrSlugEquals);
          if (index !== -1) {
            const updated = [...list];
            updated[index] = applyLiveScoreOverlay(updated[index], updatedMatch);
            return updated;
          }
          // If this is a brand new match and we don't yet have both teams
          // attached, skip inserting a "ghost" placeholder. The next GET
          // /api/matches poll or a richer websocket payload will hydrate it.
          if (!hasTeams(updatedMatch)) {
            return list;
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
  }, [fetchMatches]);

  // Poll allocation status periodically so we can show a lightweight
  // "next servers in Xs" indicator on the Matches page (mount-only).
  useEffect(() => {
    const loadAllocationStatus = async () => {
      try {
        const availability = await api.get<{
          success: boolean;
          availableServerCount: number;
          gracePeriodSeconds?: number;
          nextAllocationInSeconds?: number | null;
          simulationEnabled?: boolean;
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

  const renderAllocationBanner = () => {
    if (allocationCountdown.nextAllocationInSeconds === null) {
      return null;
    }

    const nextIn = allocationCountdown.nextAllocationInSeconds;
    if (nextIn <= 0) {
      return null;
    }

    return (
      <Box mb={2}>
        <Alert severity="info">
          <Typography variant="body2">
            {t('servers.allocation.nextPass', { seconds: nextIn })}
          </Typography>
        </Alert>
      </Box>
    );
  };

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Legacy delete handler kept for reference; match deletion is currently wired
  // through the MatchDetailsModal, which calls its own delete endpoint and then
  // emits socket updates. We keep this here in case we reintroduce list-level
  // delete actions in the future.
  // const handleDeleteMatch = async (match: Match) => {
  //   try {
  //     await api.delete(`/api/matches/${match.slug}`);
  //     showSuccess(`Match deleted: ${match.slug}`);
  //     void fetchMatches();
  //   } catch (err) {
  //     const message =
  //       err instanceof Error ? err.message : 'Failed to delete match. Please try again.';
  //     showError(message);
  //     console.error('Failed to delete match', err);
  //   }
  // };

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

  const toggleMatchSelected = (match: Match) => {
    if (!isManualMatchFlag(match)) {
      // For safety, only allow bulk deletion of manual matches.
      return;
    }
    const slug = match.slug;
    if (!slug) return;
    setSelectedMatchSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleBulkDeleteMatches = async () => {
    if (selectedMatchSlugs.size === 0) return;
    try {
      const slugs = Array.from(selectedMatchSlugs);
      const count = slugs.length;
      await api.post('/api/matches/bulk-delete', { slugs });
      showSuccess(`Deleted ${count} match${count === 1 ? '' : 'es'}`);
      setSelectedMatchSlugs(() => new Set());
      setSelectionMode(false);
      await fetchMatches();
    } catch (err) {
      console.error('Failed to delete matches', err);
      showError('Failed to delete one or more matches');
    }
  };

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
          {t('matchesPage.errors.loadTitle')}
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
      {renderAllocationBanner()}
      {/* Manual match creation + allocation countdown */}
      {hasMatches && (
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={2}>
            {allocationCountdown.nextAllocationInSeconds !== null &&
              allocationCountdown.nextAllocationInSeconds > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('matchesPage.allocation.nextServers', {
                    seconds: Math.max(0, allocationCountdown.nextAllocationInSeconds),
                  })}
                </Typography>
              )}
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Button
              variant={selectionMode ? 'contained' : 'outlined'}
              color={selectionMode ? 'secondary' : 'inherit'}
              size="small"
              onClick={() => {
                setSelectionMode((prev) => !prev);
                if (selectionMode) {
                  setSelectedMatchSlugs(() => new Set());
                }
              }}
            >
              {selectionMode
                ? t('matchesPage.bulkSelect.done')
                : t('matchesPage.bulkSelect.select')}
            </Button>
            {selectionMode && (
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                disabled={
                  [...upcomingMatches, ...liveMatches, ...matchHistory].filter((m) =>
                    isManualMatchFlag(m)
                  ).length === 0
                }
                onClick={() => {
                  const manualMatches = [
                    ...upcomingMatches,
                    ...liveMatches,
                    ...matchHistory,
                  ].filter((m) => isManualMatchFlag(m) && m.slug);
                  const allVisibleSelected =
                    manualMatches.length > 0 &&
                    manualMatches.every((m) => m.slug && selectedMatchSlugs.has(m.slug));

                  setSelectedMatchSlugs((prev) => {
                    const next = new Set(prev);
                    if (allVisibleSelected) {
                      manualMatches.forEach((m) => {
                        if (m.slug) next.delete(m.slug);
                      });
                    } else {
                      manualMatches.forEach((m) => {
                        if (m.slug) next.add(m.slug);
                      });
                    }
                    return next;
                  });
                }}
              >
                {(() => {
                  const manualMatches = [
                    ...upcomingMatches,
                    ...liveMatches,
                    ...matchHistory,
                  ].filter((m) => isManualMatchFlag(m) && m.slug);
                  const allVisibleSelected =
                    manualMatches.length > 0 &&
                    manualMatches.every((m) => m.slug && selectedMatchSlugs.has(m.slug));
                  return allVisibleSelected
                    ? t('matchesPage.bulkSelect.unselectAll')
                    : t('matchesPage.bulkSelect.selectAll');
                })()}
              </Button>
            )}
            {selectionMode && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={selectedMatchSlugs.size === 0}
                onClick={() => {
                  if (selectedMatchSlugs.size === 0) return;
                  setBulkDeleteConfirmOpen(true);
                }}
              >
                {t('matchesPage.bulkSelect.deleteSelected')}
              </Button>
            )}
            {!selectionMode && (
              <Button variant="contained" size="small" onClick={() => setCreateMatchOpen(true)}>
                {t('matchesPage.header.createMatch')}
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* Status Legend */}
      {hasMatches && (
        <Box mb={3}>
          <StatusLegend />
        </Box>
      )}

      {!hasMatches && (
        <Box>
          <EmptyState
            data-testid="matches-empty-state"
            icon={SportsEsportsIcon}
            title={t('matchesPage.empty.title')}
            description={t('matchesPage.empty.description')}
            actionLabel={t('tournament.common.createTournament')}
            actionIcon={AddIcon}
            onAction={() => navigate('/tournament')}
          />
          <Box display="flex" justifyContent="center" mt={2}>
            <Button variant="outlined" onClick={() => setCreateMatchOpen(true)}>
              {t('matchesPage.empty.createManual')}
            </Button>
          </Box>
        </Box>
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
                  {t('matchesPage.sections.live', { count: liveMatches.length })}
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
                          selectable={selectionMode && isManualMatchFlag(match)}
                          selected={selectedMatchSlugs.has(match.slug)}
                          onClick={() => {
                            if (selectionMode && isManualMatchFlag(match)) {
                              toggleMatchSelected(match);
                            } else {
                              setSelectedMatch(match);
                            }
                          }}
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
                {t('matchesPage.sections.upcoming', { count: upcomingMatches.length })}
              </Typography>
              <Grid container spacing={2}>
                {upcomingMatches.map((match) => {
                  const matchNumber = getGlobalMatchNumber(match, allMatches);
                  const isManualMatch = isManualMatchFlag(match);
                  const manualRoundLabel = isManualMatch
                    ? t('matchesPage.manualMatchLabel')
                    : undefined;
                  const tournamentStartedForCard = isManualMatch
                    ? undefined
                    : tournamentStatus === 'in_progress';
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }} key={match.id}>
                      <MatchCard
                        match={match}
                        matchNumber={matchNumber}
                        roundLabel={manualRoundLabel}
                        variant="default"
                        vetoCompleted={match.vetoCompleted}
                        tournamentStarted={tournamentStartedForCard}
                        selectable={selectionMode && isManualMatchFlag(match)}
                        selected={selectedMatchSlugs.has(match.slug)}
                        onClick={() => {
                          if (selectionMode && isManualMatchFlag(match)) {
                            toggleMatchSelected(match);
                          } else {
                            setSelectedMatch(match);
                          }
                        }}
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
                {t('matchesPage.sections.history', { count: matchHistory.length })}
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
                          selectable={selectionMode && isManualMatchFlag(match)}
                          selected={selectedMatchSlugs.has(match.slug)}
                          onClick={() => {
                            if (selectionMode && isManualMatchFlag(match)) {
                              toggleMatchSelected(match);
                            } else {
                              setSelectedMatch(match);
                            }
                          }}
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
          onDeleted={(slug) => {
            setSelectedMatch(null);
            setUpcomingMatches((prev) => prev.filter((m) => m.slug !== slug));
            setLiveMatches((prev) => prev.filter((m) => m.slug !== slug));
            setMatchHistory((prev) => prev.filter((m) => m.slug !== slug));
          }}
        />
      )}

      {/* Create manual match modal */}
      <CreateManualMatchModal
        open={createMatchOpen}
        onClose={() => setCreateMatchOpen(false)}
        onCreated={async (slug) => {
          setCreateMatchOpen(false);
          showSuccess(t('matchesPage.create.success', { slug }));

          void fetchMatches();
        }}
      />

      <ConfirmDialog
        open={selectionMode && bulkDeleteConfirmOpen}
        title={t('matchesPage.bulkDelete.title')}
        message={t('matchesPage.bulkDelete.message', {
          count: selectedMatchSlugs.size,
          suffix: selectedMatchSlugs.size === 1 ? '' : 'es',
        })}
        confirmColor="error"
        onConfirm={async () => {
          await handleBulkDeleteMatches();
          setBulkDeleteConfirmOpen(false);
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </Box>
  );
}
