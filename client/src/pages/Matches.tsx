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
    const apiUrl = import.meta.env.VITE_API_URL || '';
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
      const token = localStorage.getItem('token');
      const response = await fetch('/api/matches', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch matches');

      const data = await response.json();
      if (data.success) {
        const matches = data.matches || [];
        const live = matches.filter((m: Match) => m.status === 'live' || m.status === 'ready');
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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

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
              <Stack spacing={2}>
                {liveMatches.map((match) => {
                  const event = liveEvents.get(match.slug);
                  return (
                    <Card
                      key={match.id}
                      sx={{
                        borderLeft: 4,
                        borderColor: match.status === 'live' ? 'error.main' : 'info.main',
                        cursor: 'pointer',
                        '&:hover': {
                          boxShadow: 4,
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
                          <Typography variant="body2" fontWeight={600} color="text.secondary">
                            {getRoundLabel(match.round)} - Match {match.matchNumber}
                          </Typography>
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
                  );
                })}
              </Stack>
            </Box>
          )}

          {/* Match History Section */}
          {matchHistory.length > 0 && (
            <Box>
              <Typography variant="h6" fontWeight={600} mb={2}>
                Match History ({matchHistory.length})
              </Typography>
              <Stack spacing={2}>
                {matchHistory.map((match) => (
                  <Card
                    key={match.id}
                    sx={{
                      borderLeft: 4,
                      borderColor: 'success.main',
                      cursor: 'pointer',
                      '&:hover': {
                        boxShadow: 4,
                      },
                    }}
                    onClick={() => setSelectedMatch(match)}
                  >
                    <CardContent>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                          {getRoundLabel(match.round)} - Match {match.matchNumber}
                        </Typography>
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
                        <Typography variant="caption" color="text.secondary" mt={2} display="block">
                          Completed: {formatDate(match.completedAt)}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
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
                    Match Details
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedMatch.slug}
                  </Typography>
                </Box>
                <IconButton onClick={() => setSelectedMatch(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={3} mt={1}>
                <Box>
                  <Chip
                    label={selectedMatch.status.toUpperCase()}
                    color={getStatusColor(selectedMatch.status)}
                    sx={{ fontWeight: 600 }}
                  />
                </Box>

                <Divider />

                <Box>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <GroupsIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Teams
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Team 1
                          </Typography>
                          <Typography variant="h6" fontWeight={600}>
                            {selectedMatch.team1?.name || 'TBD'}
                          </Typography>
                          {selectedMatch.winner?.id === selectedMatch.team1?.id && (
                            <Chip
                              label="WINNER"
                              size="small"
                              color="success"
                              sx={{ mt: 1, fontWeight: 600 }}
                              icon={<EmojiEventsIcon />}
                            />
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Team 2
                          </Typography>
                          <Typography variant="h6" fontWeight={600}>
                            {selectedMatch.team2?.name || 'TBD'}
                          </Typography>
                          {selectedMatch.winner?.id === selectedMatch.team2?.id && (
                            <Chip
                              label="WINNER"
                              size="small"
                              color="success"
                              sx={{ mt: 1, fontWeight: 600 }}
                              icon={<EmojiEventsIcon />}
                            />
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>

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
