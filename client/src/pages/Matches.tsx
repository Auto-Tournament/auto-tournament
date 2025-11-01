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
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { io, Socket } from 'socket.io-client';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { formatDate, getStatusColor, getRoundLabel } from '../utils/matchUtils';

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
  status: 'pending' | 'ready' | 'live' | 'completed';
  createdAt: number;
  loadedAt?: number;
  completedAt?: number;
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
    params?: any;
  };
}

export default function Matches() {
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [matchHistory, setMatchHistory] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [liveEvents, setLiveEvents] = useState<Map<string, any>>(new Map());

  // Initialize Socket.io connection
  useEffect(() => {
    const apiUrl =
      (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL || '';
    const socketUrl = apiUrl.replace('/api', '') || window.location.origin;
    const newSocket = io(socketUrl);

    newSocket.on('connect', () => {
      console.log('Socket.io connected');
    });

    newSocket.on('match:update', (match: Match) => {
      // Update match in live or history
      if (match.status === 'live' || match.status === 'ready') {
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
    });

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

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Fetch matches
  const fetchMatches = async () => {
    try {
      const token = globalThis.localStorage.getItem('api_token');
      if (!token) {
        setError('Authentication required - please log in again');
        setLoading(false);
        return;
      }

      const response = await globalThis.fetch('/api/matches', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch matches');

      const data = await response.json();
      if (data.success) {
        const matches = data.matches || [];

        // Live matches: only show matches with both teams assigned
        const live = matches.filter(
          (m: Match) => (m.status === 'live' || m.status === 'ready') && m.team1 && m.team2
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
        <Card sx={{ textAlign: 'center', py: 8 }}>
          <SportsEsportsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No matches to display
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create a tournament and generate brackets to see matches here
          </Typography>
        </Card>
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
                            <Chip
                              label={match.status.toUpperCase()}
                              size="small"
                              color={getStatusColor(match.status)}
                              sx={{ fontWeight: 600 }}
                            />
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
    </Box>
  );
}
