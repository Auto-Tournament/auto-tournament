import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  Button,
  Divider,
  Grid,
  LinearProgress,
  IconButton,
  Alert,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GroupsIcon from '@mui/icons-material/Groups';
import MapIcon from '@mui/icons-material/Map';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { io, Socket } from 'socket.io-client';

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
  const [matchTimer, setMatchTimer] = useState<number>(0);

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

        // Filter out pending matches (TBD - no teams assigned)
        const validMatches = matches.filter((m: Match) => m.team1 && m.team2);

        const live = validMatches.filter((m: Match) => m.status === 'live' || m.status === 'ready');
        const history = validMatches
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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Timer effect for live matches
  useEffect(() => {
    if (!selectedMatch || selectedMatch.status !== 'live' || !selectedMatch.loadedAt) {
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor(Date.now() / 1000) - selectedMatch.loadedAt!;
      setMatchTimer(elapsed);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [selectedMatch]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'error';
      case 'ready':
        return 'info';
      case 'completed':
        return 'success';
      default:
        return 'default';
    }
  };

  const getRoundLabel = (round: number): string => {
    if (round === 1) return 'Round 1';
    return `Round ${round}`;
  };

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
                              label="COMPLETED"
                              size="small"
                              color="success"
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
                              >
                                {match.team1 ? match.team1.name : 'TBD'}
                              </Typography>
                              {match.winner?.id === match.team1?.id && (
                                <EmojiEventsIcon sx={{ color: 'success.main' }} />
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
                              >
                                {match.team2 ? match.team2.name : 'TBD'}
                              </Typography>
                              {match.winner?.id === match.team2?.id && (
                                <EmojiEventsIcon sx={{ color: 'success.main' }} />
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
      <Dialog
        open={selectedMatch !== null}
        onClose={() => setSelectedMatch(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedMatch && (
          <>
            <DialogTitle>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    Match #{getGlobalMatchNumber(selectedMatch, allMatches)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {getRoundLabel(selectedMatch.round)} • {selectedMatch.slug}
                  </Typography>
                </Box>
                <IconButton onClick={() => setSelectedMatch(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={3} mt={1}>
                {/* Status and Timer */}
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Chip
                    label={selectedMatch.status.toUpperCase()}
                    color={getStatusColor(selectedMatch.status)}
                    sx={{ fontWeight: 600 }}
                  />
                  {selectedMatch.status === 'live' && selectedMatch.loadedAt && (
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" color="text.secondary">
                        Match Time:
                      </Typography>
                      <Typography variant="h6" fontWeight={600} color="error.main">
                        {formatDuration(matchTimer)}
                      </Typography>
                    </Box>
                  )}
                </Box>

                <Divider />

                {/* Score Display */}
                <Box
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 2,
                    p: 3,
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                    {/* Team 1 */}
                    <Box flex={1} textAlign="left">
                      <Typography variant="h5" fontWeight={700}>
                        {selectedMatch.team1?.name || 'TBD'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {selectedMatch.team1?.tag}
                      </Typography>
                      {selectedMatch.winner?.id === selectedMatch.team1?.id && (
                        <Box mt={1}>
                          <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                        </Box>
                      )}
                    </Box>

                    {/* Scores */}
                    <Box textAlign="center" minWidth={120}>
                      <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          sx={{
                            color:
                              selectedMatch.winner?.id === selectedMatch.team1?.id
                                ? 'success.main'
                                : 'text.primary',
                          }}
                        >
                          {selectedMatch.team1Score || 0}
                        </Typography>
                        <Typography variant="h3" color="text.disabled">
                          -
                        </Typography>
                        <Typography
                          variant="h2"
                          fontWeight={700}
                          sx={{
                            color:
                              selectedMatch.winner?.id === selectedMatch.team2?.id
                                ? 'success.main'
                                : 'text.primary',
                          }}
                        >
                          {selectedMatch.team2Score || 0}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" mt={1}>
                        Rounds Won
                      </Typography>
                    </Box>

                    {/* Team 2 */}
                    <Box flex={1} textAlign="right">
                      <Typography variant="h5" fontWeight={700}>
                        {selectedMatch.team2?.name || 'TBD'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {selectedMatch.team2?.tag}
                      </Typography>
                      {selectedMatch.winner?.id === selectedMatch.team2?.id && (
                        <Box mt={1}>
                          <EmojiEventsIcon sx={{ color: 'success.main', fontSize: 28 }} />
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Box>

                {/* Player Leaderboards */}
                {(selectedMatch.team1Players || selectedMatch.team2Players) && (
                  <>
                    <Divider />
                    <Box>
                      <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <GroupsIcon color="primary" />
                        <Typography variant="subtitle1" fontWeight={600}>
                          Player Leaderboards
                        </Typography>
                      </Box>
                      <Grid container spacing={2}>
                        {/* Team 1 Players */}
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Card variant="outlined">
                            <CardContent>
                              <Typography
                                variant="subtitle2"
                                fontWeight={600}
                                mb={2}
                                color="primary"
                              >
                                {selectedMatch.team1?.name || 'Team 1'}
                              </Typography>
                              {selectedMatch.team1Players &&
                              selectedMatch.team1Players.length > 0 ? (
                                <Stack spacing={1}>
                                  {selectedMatch.team1Players
                                    .sort((a, b) => b.kills - a.kills)
                                    .map((player, idx) => (
                                      <Box
                                        key={player.steamId}
                                        sx={{
                                          p: 1.5,
                                          bgcolor: idx === 0 ? 'action.selected' : 'action.hover',
                                          borderRadius: 1,
                                        }}
                                      >
                                        <Box
                                          display="flex"
                                          justifyContent="space-between"
                                          alignItems="center"
                                        >
                                          <Typography variant="body2" fontWeight={600}>
                                            {player.name}
                                          </Typography>
                                          <Typography
                                            variant="body2"
                                            fontWeight={600}
                                            color={idx === 0 ? 'primary' : 'text.primary'}
                                          >
                                            {player.kills}/{player.deaths}/{player.assists}
                                          </Typography>
                                        </Box>
                                        <Box display="flex" justifyContent="space-between" mt={0.5}>
                                          <Typography variant="caption" color="text.secondary">
                                            KDA:{' '}
                                            {(
                                              (player.kills + player.assists) /
                                              Math.max(1, player.deaths)
                                            ).toFixed(2)}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary">
                                            HS: {player.headshots} | DMG: {player.damage}
                                          </Typography>
                                        </Box>
                                      </Box>
                                    ))}
                                </Stack>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  No player data available
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        </Grid>

                        {/* Team 2 Players */}
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Card variant="outlined">
                            <CardContent>
                              <Typography
                                variant="subtitle2"
                                fontWeight={600}
                                mb={2}
                                color="primary"
                              >
                                {selectedMatch.team2?.name || 'Team 2'}
                              </Typography>
                              {selectedMatch.team2Players &&
                              selectedMatch.team2Players.length > 0 ? (
                                <Stack spacing={1}>
                                  {selectedMatch.team2Players
                                    .sort((a, b) => b.kills - a.kills)
                                    .map((player, idx) => (
                                      <Box
                                        key={player.steamId}
                                        sx={{
                                          p: 1.5,
                                          bgcolor: idx === 0 ? 'action.selected' : 'action.hover',
                                          borderRadius: 1,
                                        }}
                                      >
                                        <Box
                                          display="flex"
                                          justifyContent="space-between"
                                          alignItems="center"
                                        >
                                          <Typography variant="body2" fontWeight={600}>
                                            {player.name}
                                          </Typography>
                                          <Typography
                                            variant="body2"
                                            fontWeight={600}
                                            color={idx === 0 ? 'primary' : 'text.primary'}
                                          >
                                            {player.kills}/{player.deaths}/{player.assists}
                                          </Typography>
                                        </Box>
                                        <Box display="flex" justifyContent="space-between" mt={0.5}>
                                          <Typography variant="caption" color="text.secondary">
                                            KDA:{' '}
                                            {(
                                              (player.kills + player.assists) /
                                              Math.max(1, player.deaths)
                                            ).toFixed(2)}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary">
                                            HS: {player.headshots} | DMG: {player.damage}
                                          </Typography>
                                        </Box>
                                      </Box>
                                    ))}
                                </Stack>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  No player data available
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        </Grid>
                      </Grid>
                    </Box>
                  </>
                )}

                {selectedMatch.config?.maplist && (
                  <>
                    <Divider />
                    <Box>
                      <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <MapIcon color="primary" />
                        <Typography variant="subtitle1" fontWeight={600}>
                          Map Pool
                        </Typography>
                      </Box>
                      <Box display="flex" flexWrap="wrap" gap={1}>
                        {selectedMatch.config.maplist.map((map, index) => (
                          <Chip key={index} label={map} variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  </>
                )}

                <Divider />

                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <CalendarTodayIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Timeline
                    </Typography>
                  </Box>
                  <Stack spacing={1}>
                    <Box display="flex" justifyContent="space-between">
                      <Typography variant="body2" color="text.secondary">
                        Created:
                      </Typography>
                      <Typography variant="body2">{formatDate(selectedMatch.createdAt)}</Typography>
                    </Box>
                    {selectedMatch.loadedAt && (
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">
                          Loaded:
                        </Typography>
                        <Typography variant="body2">
                          {formatDate(selectedMatch.loadedAt)}
                        </Typography>
                      </Box>
                    )}
                    {selectedMatch.completedAt && (
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">
                          Completed:
                        </Typography>
                        <Typography variant="body2">
                          {formatDate(selectedMatch.completedAt)}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </Box>
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
