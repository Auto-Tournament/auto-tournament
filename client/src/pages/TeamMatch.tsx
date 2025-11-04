import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Divider,
  Container,
  Paper,
  IconButton,
  Tooltip,
  Grid,
  Slider,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import StorageIcon from '@mui/icons-material/Storage';
import MapIcon from '@mui/icons-material/Map';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import HistoryIcon from '@mui/icons-material/History';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SettingsIcon from '@mui/icons-material/Settings';
import { io } from 'socket.io-client';
import { usePlayerConnections } from '../hooks/usePlayerConnections';
import {
  soundNotification,
  NOTIFICATION_SOUNDS,
  type NotificationSoundValue,
} from '../utils/soundNotification';
import { formatDate } from '../utils/matchUtils';

interface Team {
  id: string;
  name: string;
  tag?: string;
}

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  status?: string | null;
  statusDescription?: {
    label: string;
    description: string;
    color: 'success' | 'warning' | 'error' | 'info' | 'default';
  } | null;
}

interface MatchInfo {
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
  isTeam1: boolean;
  opponent: Team | null;
  server: Server | null;
  maps: string[];
  matchFormat: string;
  loadedAt?: number;
}

interface MatchHistoryItem {
  slug: string;
  round: number;
  matchNumber: number;
  opponent: Team | null;
  won: boolean;
  teamScore: number;
  opponentScore: number;
  completedAt: number;
}

interface TeamStats {
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface Standing {
  position: number;
  totalTeams: number;
  wins: number;
}

export default function TeamMatch() {
  const { teamId } = useParams<{ teamId: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [hasMatch, setHasMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(soundNotification.isMutedState());
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [volume, setVolume] = useState(soundNotification.getVolume());
  const [soundFile, setSoundFile] = useState<NotificationSoundValue>(
    soundNotification.getSoundFile()
  );
  const [showSettings, setShowSettings] = useState(false);

  const previousMatchStatus = useRef<string | null>(null);
  const { status: connectionStatus } = usePlayerConnections(match?.slug || null);

  const loadTeamMatch = async () => {
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
          setTeam({ id: teamId, name: teamId, tag: undefined });
          setHasMatch(false);
          setMatch(null);
        }
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (!data.success) {
        // If team exists but no matches, don't show as error
        if (data.team) {
          setTeam(data.team);
          setHasMatch(false);
          setMatch(null);
        } else {
          setError(data.error || 'Failed to load team information');
        }
        return;
      }

      setTeam(data.team);
      setHasMatch(data.hasMatch);
      setMatch(data.match || null);
    } catch (err) {
      // Network or parsing error
      console.error('Error loading team match:', err);
      // Don't show error for team without matches
      setError('');
    } finally {
      setLoading(false);
    }
  };

  const loadMatchHistory = async () => {
    if (!teamId) return;

    try {
      const response = await fetch(`/api/team/${teamId}/history?limit=5`);
      const data = await response.json();

      if (data.success) {
        setMatchHistory(data.matches || []);
      }
    } catch (err) {
      console.error('Failed to load match history:', err);
    }
  };

  const loadTeamStats = async () => {
    if (!teamId) return;

    try {
      const response = await fetch(`/api/team/${teamId}/stats`);
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
        setStanding(data.standing);
      }
    } catch (err) {
      console.error('Failed to load team stats:', err);
    }
  };

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

    return () => {
      socket.close();
    };
  }, [teamId]);

  // Sound notification when match becomes ready
  useEffect(() => {
    if (!match) return;

    // Check if status changed to 'loaded' or 'live'
    if (previousMatchStatus.current && previousMatchStatus.current !== match.status) {
      if (match.status === 'loaded' || match.status === 'live') {
        soundNotification.playNotification();
      }
    }

    previousMatchStatus.current = match.status;
  }, [match?.status]);

  const toggleMute = () => {
    const newMutedState = soundNotification.toggleMute();
    setIsMuted(newMutedState);
  };

  const handleVolumeChange = (newVolume: number) => {
    soundNotification.setVolume(newVolume);
    setVolume(newVolume);
  };

  const handlePreviewSound = () => {
    soundNotification.previewSound();
  };

  const handleSoundChange = (newSound: NotificationSoundValue) => {
    soundNotification.setSoundFile(newSound);
    setSoundFile(newSound);
  };

  const handleConnect = () => {
    if (!match?.server) return;

    const connectUrl = match.server.password
      ? `steam://connect/${match.server.host}:${match.server.port}/${match.server.password}`
      : `steam://connect/${match.server.host}:${match.server.port}`;

    window.location.href = connectUrl;
    setConnected(true);

    // Reset after a few seconds
    setTimeout(() => setConnected(false), 5000);
  };

  const handleCopyIP = () => {
    if (!match?.server) return;

    const connectCommand = match.server.password
      ? `connect ${match.server.host}:${match.server.port}; password ${match.server.password}`
      : `connect ${match.server.host}:${match.server.port}`;

    navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'error';
      case 'loaded':
        return 'warning';
      case 'ready':
        return 'info';
      case 'completed':
        return 'success';
      default:
        return 'default';
    }
  };

  const getRoundLabel = (round: number) => {
    if (round === 1) return 'Round 1';
    if (round === 2) return 'Round 2 (Semi-Finals)';
    if (round === 3) return 'Finals';
    return `Round ${round}`;
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="background.default"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="background.default"
        p={3}
      >
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!hasMatch || !match) {
    return (
      <Box minHeight="100vh" bgcolor="background.default" py={6}>
        <Container maxWidth="sm">
          <Stack spacing={3}>
            {/* Team Header - Simple version */}
            <Box textAlign="center">
              <Box display="flex" justifyContent="center" alignItems="center" gap={2} mb={2}>
                <Typography variant="h3" fontWeight={700}>
                  {team?.name}
                </Typography>
                <Box display="flex" gap={1}>
                  <Tooltip title="Sound settings">
                    <IconButton onClick={() => setShowSettings(!showSettings)} size="small">
                      <SettingsIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={isMuted ? 'Unmute notifications' : 'Mute notifications'}>
                    <IconButton
                      onClick={toggleMute}
                      size="small"
                      color={isMuted ? 'default' : 'primary'}
                    >
                      {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              {team?.tag && <Chip label={team.tag} sx={{ mb: 2 }} />}
            </Box>

            {/* Sound Settings Panel */}
            {showSettings && (
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    Sound Settings
                  </Typography>
                  <Stack spacing={2}>
                    <Box>
                      <FormControl fullWidth size="small">
                        <InputLabel>Notification Sound</InputLabel>
                        <Select
                          value={soundFile}
                          label="Notification Sound"
                          onChange={(e) =>
                            handleSoundChange(e.target.value as NotificationSoundValue)
                          }
                        >
                          {NOTIFICATION_SOUNDS.map((sound) => (
                            <MenuItem key={sound.value} value={sound.value}>
                              {sound.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                    <Box>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="body2">Volume</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {Math.round(volume * 100)}%
                        </Typography>
                      </Box>
                      <Box display="flex" gap={2} alignItems="center">
                        <Slider
                          value={volume * 100}
                          onChange={(_, value) => handleVolumeChange((value as number) / 100)}
                          min={0}
                          max={100}
                          sx={{ flex: 1 }}
                          color="primary"
                        />
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<PlayArrowIcon />}
                          onClick={handlePreviewSound}
                        >
                          Test
                        </Button>
                      </Box>
                    </Box>
                    <Divider />
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Sound plays when your match is ready or goes live.
                      </Typography>
                    </Box>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      <Typography variant="caption">
                        Sound Effect by{' '}
                        <a
                          href="https://pixabay.com/users/dragon-studio-38165424/"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'inherit' }}
                        >
                          DRAGON-STUDIO
                        </a>{' '}
                        from{' '}
                        <a
                          href="https://pixabay.com/sound-effects/"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'inherit' }}
                        >
                          Pixabay
                        </a>
                      </Typography>
                    </Alert>
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <SportsEsportsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" color="text.secondary" mt={2}>
                  No matches available right now
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                  Keep this page open to receive notifications when your match is ready
                </Typography>
              </CardContent>
            </Card>

            {/* Still show stats if available */}
            {stats && stats.totalMatches > 0 && (
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <LeaderboardIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Team Performance
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h4" fontWeight={700} color="primary">
                          {stats.wins}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Wins
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h4" fontWeight={700} color="error">
                          {stats.losses}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Losses
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h4" fontWeight={700} color="success.main">
                          {stats.winRate}%
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Win Rate
                        </Typography>
                      </Paper>
                    </Grid>
                    {standing && (
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                          <Typography variant="h4" fontWeight={700}>
                            #{standing.position}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            of {standing.totalTeams}
                          </Typography>
                        </Paper>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            )}

            {/* Match History */}
            {matchHistory.length > 0 && (
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={3}>
                    <HistoryIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Recent Matches
                    </Typography>
                  </Box>
                  <Stack spacing={2}>
                    {matchHistory.map((historyMatch) => (
                      <Paper
                        key={historyMatch.slug}
                        variant="outlined"
                        sx={{
                          p: 2,
                          borderLeft: 4,
                          borderColor: historyMatch.won ? 'success.main' : 'error.main',
                        }}
                      >
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          mb={1}
                        >
                          <Box display="flex" alignItems="center" gap={1}>
                            <Chip
                              label={historyMatch.won ? 'WIN' : 'LOSS'}
                              size="small"
                              color={historyMatch.won ? 'success' : 'error'}
                              sx={{ fontWeight: 600 }}
                            />
                            <Typography variant="body2" fontWeight={600}>
                              Match #{historyMatch.matchNumber}
                            </Typography>
                          </Box>
                          <Chip
                            label={`${historyMatch.teamScore} - ${historyMatch.opponentScore}`}
                            size="small"
                            variant="outlined"
                          />
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          vs {historyMatch.opponent?.name || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(historyMatch.completedAt)}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Container>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" bgcolor="background.default" py={6}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          {/* Team Header with Audio Controls */}
          <Card
            sx={{
              background:
                'linear-gradient(135deg, rgba(103, 80, 164, 0.1) 0%, rgba(103, 80, 164, 0.05) 100%)',
            }}
          >
            <CardContent sx={{ py: 4 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box flex={1} textAlign="center">
                  <Typography variant="h3" fontWeight={700} gutterBottom>
                    {team?.name}
                  </Typography>
                  {team?.tag && (
                    <Chip
                      label={team.tag}
                      size="medium"
                      sx={{ fontSize: '1rem', fontWeight: 600 }}
                    />
                  )}
                </Box>
                <Box display="flex" gap={1}>
                  <Tooltip title="Sound settings">
                    <IconButton onClick={() => setShowSettings(!showSettings)} color="primary">
                      <SettingsIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={isMuted ? 'Unmute notifications' : 'Mute notifications'}>
                    <IconButton onClick={toggleMute} color={isMuted ? 'default' : 'primary'}>
                      {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </CardContent>
          </Card>

          {/* Sound Settings Panel */}
          {showSettings && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  Sound Settings
                </Typography>
                <Stack spacing={2}>
                  <Box>
                    <FormControl fullWidth size="small">
                      <InputLabel>Notification Sound</InputLabel>
                      <Select
                        value={soundFile}
                        label="Notification Sound"
                        onChange={(e) =>
                          handleSoundChange(e.target.value as NotificationSoundValue)
                        }
                      >
                        {NOTIFICATION_SOUNDS.map((sound) => (
                          <MenuItem key={sound.value} value={sound.value}>
                            {sound.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="body2">Volume</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {Math.round(volume * 100)}%
                      </Typography>
                    </Box>
                    <Box display="flex" gap={2} alignItems="center">
                      <Slider
                        value={volume * 100}
                        onChange={(_, value) => handleVolumeChange((value as number) / 100)}
                        min={0}
                        max={100}
                        step={5}
                        sx={{ flex: 1 }}
                        color="primary"
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={handlePreviewSound}
                      >
                        Test
                      </Button>
                    </Box>
                  </Box>
                  <Divider />
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Sound plays when your match is ready or goes live.
                    </Typography>
                  </Box>
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    <Typography variant="caption">
                      Sound Effect by{' '}
                      <a
                        href="https://pixabay.com/users/dragon-studio-38165424/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'inherit' }}
                      >
                        DRAGON-STUDIO
                      </a>{' '}
                      from{' '}
                      <a
                        href="https://pixabay.com/sound-effects/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'inherit' }}
                      >
                        Pixabay
                      </a>
                    </Typography>
                  </Alert>
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Team Stats Card */}
          {stats && (
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <LeaderboardIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    Team Performance
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="primary">
                        {stats.wins}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Wins
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="error">
                        {stats.losses}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Losses
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="success.main">
                        {stats.winRate}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Win Rate
                      </Typography>
                    </Paper>
                  </Grid>
                  {standing && (
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h4" fontWeight={700}>
                          #{standing.position}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          of {standing.totalTeams}
                        </Typography>
                      </Paper>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}

          {/* Match Info Card */}
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box>
                  <Typography variant="h5" fontWeight={600}>
                    Match #{match.matchNumber}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {getRoundLabel(match.round)}
                  </Typography>
                </Box>
                <Chip
                  label={match.status.toUpperCase()}
                  color={getStatusColor(match.status)}
                  sx={{ fontWeight: 600, fontSize: '0.9rem', px: 2 }}
                />
              </Box>

              {/* VS Display */}
              <Paper
                variant="outlined"
                sx={{
                  p: 4,
                  mb: 3,
                  background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%)',
                }}
              >
                <Box display="flex" justifyContent="space-around" alignItems="center">
                  <Box textAlign="center">
                    <Typography variant="h4" fontWeight={700} color="primary">
                      {team?.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Your Team
                    </Typography>
                  </Box>
                  <Typography variant="h3" color="text.secondary" fontWeight={700}>
                    VS
                  </Typography>
                  <Box textAlign="center">
                    <Typography variant="h4" fontWeight={700}>
                      {match.opponent?.name || 'TBD'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Opponent
                    </Typography>
                  </Box>
                </Box>
              </Paper>

              {/* Connection Status */}
              {connectionStatus && connectionStatus.totalConnected > 0 && (
                <Alert
                  severity={connectionStatus.totalConnected >= 10 ? 'success' : 'warning'}
                  sx={{ mb: 3 }}
                >
                  <Typography variant="body2" fontWeight={600}>
                    {connectionStatus.totalConnected}/10 Players Connected
                  </Typography>
                  <Typography variant="caption">
                    Team 1: {connectionStatus.team1Connected}/5 • Team 2:{' '}
                    {connectionStatus.team2Connected}/5
                  </Typography>
                </Alert>
              )}

              {/* Server Connection */}
              {match.server ? (
                <>
                  <Divider sx={{ my: 3 }} />
                  <Box>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                      <StorageIcon color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Server
                      </Typography>
                    </Box>

                    <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
                      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                        <Typography variant="h6" fontWeight={600}>
                          {match.server.name}
                        </Typography>
                        {match.server.statusDescription && (
                          <Chip
                            label={match.server.statusDescription.label}
                            color={match.server.statusDescription.color}
                            size="small"
                            sx={{ fontWeight: 600 }}
                          />
                        )}
                      </Box>

                      {match.server.statusDescription && (
                        <Alert
                          severity={
                            match.server.statusDescription.color === 'default'
                              ? 'info'
                              : match.server.statusDescription.color
                          }
                          sx={{ mb: 2 }}
                          icon={false}
                        >
                          <Typography variant="body2">
                            {match.server.statusDescription.description}
                          </Typography>
                        </Alert>
                      )}

                      <Typography
                        variant="body1"
                        fontFamily="monospace"
                        color="text.secondary"
                        mb={2}
                      >
                        {match.server.host}:{match.server.port}
                      </Typography>

                      <Stack spacing={2}>
                        <Button
                          variant="contained"
                          size="large"
                          fullWidth
                          color={connected ? 'success' : 'primary'}
                          startIcon={<SportsEsportsIcon />}
                          onClick={handleConnect}
                          sx={{ py: 1.5 }}
                        >
                          {connected ? '✓ Connecting...' : 'Connect to Server'}
                        </Button>

                        <Button
                          variant="outlined"
                          size="small"
                          fullWidth
                          startIcon={copied ? null : <ContentCopyIcon />}
                          onClick={handleCopyIP}
                        >
                          {copied ? '✓ Copied!' : 'Copy Console Command'}
                        </Button>
                      </Stack>
                    </Paper>

                    <Alert severity="info">
                      <Typography variant="body2">
                        <strong>How to connect:</strong>
                        <br />
                        1. Click "Connect to Server" to launch CS2 and connect
                        <br />
                        OR
                        <br />
                        2. Copy the command and paste it in your CS2 console (~)
                      </Typography>
                    </Alert>
                  </Box>
                </>
              ) : (
                <Alert severity="info" sx={{ mt: 3 }}>
                  Server will be assigned when the match is ready. Please check back soon.
                </Alert>
              )}

              {/* Match Details */}
              <Divider sx={{ my: 3 }} />

              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <MapIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    Match Details
                  </Typography>
                </Box>

                <Stack spacing={2}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Format:</strong> {match.matchFormat}
                    </Typography>
                  </Box>

                  {match.maps.length > 0 && (
                    <Box>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        <strong>Map Pool:</strong>
                      </Typography>
                      <Box display="flex" flexWrap="wrap" gap={1} mt={1}>
                        {match.maps.map((map, idx) => (
                          <Chip key={idx} label={map} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}
                </Stack>
              </Box>

              {/* Status Messages */}
              {match.status === 'pending' && (
                <Alert severity="info" sx={{ mt: 3 }}>
                  Your match is scheduled. Waiting for server allocation...
                </Alert>
              )}

              {match.status === 'ready' && !match.server && (
                <Alert severity="warning" sx={{ mt: 3 }}>
                  Match is ready! Waiting for server assignment...
                </Alert>
              )}

              {match.status === 'loaded' && (
                <Alert severity="success" sx={{ mt: 3 }}>
                  🎮 Match is loaded! Connect now and get ready!
                </Alert>
              )}

              {match.status === 'live' && (
                <Alert severity="error" sx={{ mt: 3 }}>
                  🔴 MATCH IS LIVE! Connect immediately if you haven't already!
                </Alert>
              )}

              {match.status === 'completed' && (
                <Alert severity="success" sx={{ mt: 3 }}>
                  Match completed. Thank you for playing!
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Match History */}
          {matchHistory.length > 0 && (
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={3}>
                  <HistoryIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    Recent Matches
                  </Typography>
                </Box>
                <Stack spacing={2}>
                  {matchHistory.map((historyMatch) => (
                    <Paper
                      key={historyMatch.slug}
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderLeft: 4,
                        borderColor: historyMatch.won ? 'success.main' : 'error.main',
                      }}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip
                            label={historyMatch.won ? 'WIN' : 'LOSS'}
                            size="small"
                            color={historyMatch.won ? 'success' : 'error'}
                            sx={{ fontWeight: 600 }}
                          />
                          <Typography variant="body2" fontWeight={600}>
                            Match #{historyMatch.matchNumber}
                          </Typography>
                        </Box>
                        <Chip
                          label={`${historyMatch.teamScore} - ${historyMatch.opponentScore}`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        vs {historyMatch.opponent?.name || 'Unknown'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(historyMatch.completedAt)}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Footer */}
          <Typography variant="caption" color="text.secondary" textAlign="center">
            This page updates automatically. Keep it open during your match.
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
