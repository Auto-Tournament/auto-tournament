import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
  Grid,
  LinearProgress,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import DownloadIcon from '@mui/icons-material/Download';
import LinkIcon from '@mui/icons-material/Link';
import PersonIcon from '@mui/icons-material/Person';
import AddIcon from '@mui/icons-material/Add';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { formatDate, getStatusColor, getStatusLabel, getRoundLabel } from '../utils/matchUtils';
import { useTeamLinkCopy } from '../hooks/useTeamLinkCopy';

interface Team {
  id: string;
  name: string;
  tag?: string;
}

interface PlayerStats {
  name: string;
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  team1?: Team;
  team2?: Team;
  winner?: Team;
  status: 'pending' | 'loaded' | 'live' | 'completed';
  createdAt: number;
  loadedAt?: number;
  completedAt?: number;
  demoFilePath?: string;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  config?: {
    maplist?: string[];
    num_maps?: number;
    team1?: { name: string };
    team2?: { name: string };
  };
}

interface MatchEvent {
  matchSlug: string;
  event: {
    event: string;
    matchid: string;
    params?: {
      team1_score?: number;
      team2_score?: number;
      [key: string]: unknown;
    };
  };
}

export default function Matches() {
  const navigate = useNavigate();
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [matchHistory, setMatchHistory] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<Map<string, MatchEvent['event']>>(new Map());
  const [connectionCounts, setConnectionCounts] = useState<Map<string, number>>(new Map());

  // Team link copy with toast
  const { copyLink, ToastNotification } = useTeamLinkCopy();

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
        // Handle connection status updates
        if ('slug' in data && data.slug && 'connectionStatus' in data && data.connectionStatus) {
          setConnectionCounts((prev) => {
            const updated = new Map(prev);
            updated.set(data.slug!, data.connectionStatus!.totalConnected);
            return updated;
          });
          return;
        }

        // Handle regular match updates
        const match = data as Match;
        if (match.status === 'live' || match.status === 'loaded') {
          setLiveMatches((prev) => {
            const index = prev.findIndex((m) => m.id === match.id);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = match;
              return updated;
            }
            return [...prev, match];
          });
        } else if (match.status === 'completed') {
          setLiveMatches((prev) => prev.filter((m) => m.id !== match.id));
          setMatchHistory((prev) => {
            const exists = prev.find((m) => m.id === match.id);
            if (exists) return prev;
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
      const token = localStorage.getItem('api_token');
      if (!token) {
        setError('Authentication required - please log in again');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/matches', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch matches');

      const data = await response.json();
      if (data.success) {
        const matches = data.matches || [];

        // Live matches: only show matches with both teams assigned (loaded = warmup, live = in progress)
        const live = matches.filter(
          (m: Match) => (m.status === 'live' || m.status === 'loaded') && m.team1 && m.team2
        );

        // History: show all completed matches including walkovers
        const history = matches
          .filter((m: Match) => m.status === 'completed')
          .sort((a: Match, b: Match) => (b.completedAt || 0) - (a.completedAt || 0));

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
  const allMatches = [...liveMatches, ...matchHistory];

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

  const hasMatches = liveMatches.length > 0 || matchHistory.length > 0;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <SportsEsportsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Matches
        </Typography>
      </Box>

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
                      <Card
                        sx={{
                          cursor: 'pointer',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                          borderLeft: 4,
                          borderColor: match.status === 'live' ? 'error.main' : 'info.main',
                          '&:hover': {
                            transform: 'translateY(-4px)',
                            boxShadow: 6,
                          },
                        }}
                        onClick={() => setSelectedMatch(match)}
                      >
                        <CardContent>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            mb={2}
                          >
                            <Box>
                              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                                Match #{matchNumber}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {getRoundLabel(match.round)}
                              </Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Tooltip title="Copy team match link">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyLink(match.team1?.id);
                                    }}
                                    disabled={!match.team1?.id}
                                  >
                                    <LinkIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip
                                title={match.demoFilePath ? 'Download Demo' : 'No demo available'}
                              >
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => handleDownloadDemo(match, e)}
                                    disabled={!match.demoFilePath}
                                    color="primary"
                                  >
                                    <DownloadIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Chip
                                label={getStatusLabel(match.status)}
                                size="small"
                                color={getStatusColor(match.status)}
                                sx={{ fontWeight: 600 }}
                              />
                            </Box>
                          </Box>

                          <Stack spacing={1.5}>
                            <Box
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                              sx={{
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor: 'background.paper',
                                border: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <Typography variant="body1" fontWeight={500}>
                                {match.team1 ? match.team1.name : 'TBD'}
                              </Typography>
                              {event?.params?.team1_score !== undefined && (
                                <Chip
                                  label={event.params.team1_score}
                                  size="small"
                                  sx={{ fontWeight: 600, minWidth: 40 }}
                                />
                              )}
                            </Box>

                            <Box display="flex" justifyContent="center">
                              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                                VS
                              </Typography>
                            </Box>

                            <Box
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                              sx={{
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor: 'background.paper',
                                border: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <Typography variant="body1" fontWeight={500}>
                                {match.team2 ? match.team2.name : 'TBD'}
                              </Typography>
                              {event?.params?.team2_score !== undefined && (
                                <Chip
                                  label={event.params.team2_score}
                                  size="small"
                                  sx={{ fontWeight: 600, minWidth: 40 }}
                                />
                              )}
                            </Box>
                          </Stack>

                          {/* Connection Status */}
                          {connectionCounts.has(match.slug) && (
                            <Box
                              mt={2}
                              p={1}
                              bgcolor={
                                connectionCounts.get(match.slug)! >= 10
                                  ? 'success.light'
                                  : 'warning.light'
                              }
                              borderRadius={1}
                              display="flex"
                              alignItems="center"
                              justifyContent="center"
                              gap={0.5}
                            >
                              <PersonIcon sx={{ fontSize: 16 }} />
                              <Typography variant="caption" fontWeight={600}>
                                {connectionCounts.get(match.slug)}/10 Players
                              </Typography>
                            </Box>
                          )}

                          {event && event.event && (
                            <Box mt={2} p={1} bgcolor="action.hover" borderRadius={1}>
                              <Typography variant="caption" color="text.secondary">
                                Latest: {event.event.replace(/_/g, ' ')}
                              </Typography>
                            </Box>
                          )}
                        </CardContent>
                      </Card>
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
                      <Card
                        sx={{
                          cursor: 'pointer',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                          borderLeft: 4,
                          borderColor: 'success.main',
                          '&:hover': {
                            transform: 'translateY(-4px)',
                            boxShadow: 6,
                          },
                        }}
                        onClick={() => setSelectedMatch(match)}
                      >
                        <CardContent>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            mb={2}
                          >
                            <Box>
                              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                                Match #{matchNumber}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {getRoundLabel(match.round)}
                              </Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Tooltip title="Copy team match link">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyLink(match.team1?.id);
                                    }}
                                    disabled={!match.team1?.id}
                                  >
                                    <LinkIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip
                                title={match.demoFilePath ? 'Download Demo' : 'No demo available'}
                              >
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => handleDownloadDemo(match, e)}
                                    disabled={!match.demoFilePath}
                                    color="primary"
                                  >
                                    <DownloadIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Chip
                                label={
                                  (match.team1 && !match.team2) || (!match.team1 && match.team2)
                                    ? 'WALKOVER'
                                    : 'COMPLETED'
                                }
                                size="small"
                                color={
                                  (match.team1 && !match.team2) || (!match.team1 && match.team2)
                                    ? 'warning'
                                    : 'success'
                                }
                                sx={{ fontWeight: 600 }}
                              />
                            </Box>
                          </Box>

                          <Stack spacing={1}>
                            <Box
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                              sx={{
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor:
                                  match.winner?.id === match.team1?.id
                                    ? 'success.light'
                                    : 'background.paper',
                                border: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <Typography
                                variant="body1"
                                fontWeight={match.winner?.id === match.team1?.id ? 600 : 400}
                                sx={{
                                  fontStyle: !match.team1 ? 'italic' : 'normal',
                                  color:
                                    match.winner?.id === match.team1?.id
                                      ? 'success.contrastText'
                                      : !match.team1
                                      ? 'text.disabled'
                                      : 'text.primary',
                                }}
                              >
                                {match.team1 ? match.team1.name : '—'}
                              </Typography>
                              {match.winner?.id === match.team1?.id && (
                                <EmojiEventsIcon sx={{ color: 'success.contrastText' }} />
                              )}
                            </Box>

                            <Box
                              display="flex"
                              justifyContent="space-between"
                              alignItems="center"
                              sx={{
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor:
                                  match.winner?.id === match.team2?.id
                                    ? 'success.light'
                                    : 'background.paper',
                                border: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <Typography
                                variant="body1"
                                fontWeight={match.winner?.id === match.team2?.id ? 600 : 400}
                                sx={{
                                  fontStyle: !match.team2 ? 'italic' : 'normal',
                                  color:
                                    match.winner?.id === match.team2?.id
                                      ? 'success.contrastText'
                                      : !match.team2
                                      ? 'text.disabled'
                                      : 'text.primary',
                                }}
                              >
                                {match.team2 ? match.team2.name : '—'}
                              </Typography>
                              {match.winner?.id === match.team2?.id && (
                                <EmojiEventsIcon sx={{ color: 'success.contrastText' }} />
                              )}
                            </Box>
                          </Stack>

                          {match.completedAt && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              mt={2}
                              display="block"
                            >
                              Completed: {formatDate(match.completedAt)}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
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

      <ToastNotification />
    </Box>
  );
}
