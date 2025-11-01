import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AddIcon from '@mui/icons-material/Add';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import BracketVisualization from '../components/BracketVisualization';

interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  status: string;
  team1?: { id: string; name: string; tag?: string };
  team2?: { id: string; name: string; tag?: string };
  winner?: { id: string; name: string; tag?: string };
}

interface Tournament {
  id: number;
  name: string;
  type: string;
  format: string;
  status: string;
  maps: string[];
  teamIds: string[];
}

export default function Bracket() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBracket();
    const interval = setInterval(loadBracket, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await fullscreenRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  };

  const loadBracket = async () => {
    try {
      const response = await api.get('/api/tournament/bracket');
      if (response.success) {
        setTournament(response.tournament);
        setMatches(response.matches);
        setTotalRounds(response.totalRounds);
        setError('');
      }
    } catch (err) {
      // Don't show error for "no tournament" case - it's expected
      const error = err as { message?: string };
      if (error.message?.includes('No tournament')) {
        setError('');
        setTournament(null);
        setMatches([]);
      } else {
        setError(error.message || 'Failed to load bracket');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="h4" fontWeight={600}>
              Bracket
            </Typography>
          </Box>
        </Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!tournament) {
    return (
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="h4" fontWeight={600}>
              Bracket
            </Typography>
          </Box>
        </Box>
        <Card sx={{ textAlign: 'center', py: 8 }}>
          <EmojiEventsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No tournament yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Create a tournament and generate the bracket to get started
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/tournament')}
          >
            Create Tournament
          </Button>
        </Card>
      </Box>
    );
  }

  if (!matches.length) {
    return (
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="h4" fontWeight={600}>
              Bracket
            </Typography>
          </Box>
        </Box>
        <Card sx={{ textAlign: 'center', py: 8 }}>
          <EmojiEventsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Bracket not generated yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Generate the bracket to create matches for {tournament.name}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/tournament')}>
            Go to Tournament Settings
          </Button>
        </Card>
      </Box>
    );
  }

  // Group matches by round
  const matchesByRound: { [round: number]: Match[] } = {};
  matches.forEach((match) => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  const getRoundLabel = (round: number, total: number): string => {
    if (round === total) return 'Finals';
    if (round === total - 1) return 'Semi-Finals';
    if (round === total - 2) return 'Quarter-Finals';
    return `Round ${round}`;
  };

  return (
    <Box
      ref={fullscreenRef}
      sx={{
        bgcolor: 'background.default',
        minHeight: '100vh',
        position: 'relative',
        height: isFullscreen ? '100vh' : 'auto',
        overflow: isFullscreen ? 'hidden' : 'visible',
      }}
    >
      {/* Header - hidden in fullscreen mode */}
      {!isFullscreen && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 4,
            p: 2,
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
            <Box>
              <Typography variant="h4" fontWeight={600} gutterBottom>
                {tournament.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tournament.type.replace('_', ' ').toUpperCase()} •{' '}
                {tournament.format.toUpperCase()}
              </Typography>
            </Box>
          </Box>
          <Box display="flex" gap={2} alignItems="center">
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, newMode) => newMode && setViewMode(newMode)}
              size="small"
            >
              <ToggleButton value="visual">
                <AccountTreeOutlinedIcon sx={{ mr: 1 }} fontSize="small" />
                Visual
              </ToggleButton>
              <ToggleButton value="list">
                <ViewListIcon sx={{ mr: 1 }} fontSize="small" />
                List
              </ToggleButton>
            </ToggleButtonGroup>
            <Chip
              label={tournament.status.replace('_', ' ').toUpperCase()}
              color={
                tournament.status === 'setup'
                  ? 'default'
                  : tournament.status === 'ready'
                  ? 'info'
                  : tournament.status === 'in_progress'
                  ? 'warning'
                  : 'success'
              }
              sx={{ fontWeight: 600 }}
            />
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadBracket}
              size="small"
            >
              Refresh
            </Button>
            <IconButton
              onClick={toggleFullscreen}
              color="primary"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Fullscreen exit button - only visible in fullscreen */}
      {isFullscreen && (
        <IconButton
          onClick={toggleFullscreen}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            bgcolor: 'rgba(42, 42, 42, 0.95)',
            backdropFilter: 'blur(10px)',
            boxShadow: 3,
            color: '#e0e0e0',
            border: '1px solid #555',
            '&:hover': {
              bgcolor: 'rgba(58, 58, 58, 1)',
              color: '#ffffff',
            },
          }}
          title="Exit Fullscreen"
        >
          <FullscreenExitIcon />
        </IconButton>
      )}

      {/* Bracket visualization */}
      {viewMode === 'visual' ? (
        <Box
          sx={{
            height: isFullscreen ? '100vh' : 'auto',
            pt: 0,
          }}
        >
          <BracketVisualization
            matches={matches}
            totalRounds={totalRounds}
            tournamentType={tournament.type}
            isFullscreen={isFullscreen}
          />
        </Box>
      ) : (
        <Box
          sx={{
            height: isFullscreen ? '100vh' : 'auto',
            pt: isFullscreen ? 2 : 0,
            px: isFullscreen ? 2 : 0,
            overflowY: isFullscreen ? 'auto' : 'visible',
          }}
        >
          {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => (
            <Box key={round} mb={4}>
              <Typography variant="h6" fontWeight={600} mb={2}>
                {getRoundLabel(round, totalRounds)}
              </Typography>
              <Stack spacing={2}>
                {matchesByRound[round]?.map((match) => (
                  <Card
                    key={match.id}
                    sx={{
                      borderLeft: 4,
                      borderColor:
                        match.status === 'completed'
                          ? 'success.main'
                          : match.status === 'live'
                          ? 'warning.main'
                          : match.status === 'ready'
                          ? 'info.main'
                          : 'grey.300',
                    }}
                  >
                    <CardContent>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                          Match {match.matchNumber} ({match.slug})
                        </Typography>
                        <Chip
                          label={match.status.toUpperCase()}
                          size="small"
                          color={
                            match.status === 'completed'
                              ? 'success'
                              : match.status === 'live'
                              ? 'warning'
                              : match.status === 'ready'
                              ? 'info'
                              : 'default'
                          }
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
                                ? 'success.main'
                                : 'background.paper',
                            border: 1,
                            borderColor:
                              match.winner?.id === match.team1?.id ? 'success.dark' : 'divider',
                          }}
                        >
                          <Typography
                            variant="body1"
                            fontWeight={match.winner?.id === match.team1?.id ? 600 : 400}
                            sx={{
                              color:
                                match.winner?.id === match.team1?.id
                                  ? 'success.contrastText'
                                  : match.team1
                                  ? 'text.primary'
                                  : 'text.disabled',
                            }}
                          >
                            {match.team1 ? match.team1.name : 'TBD'}
                          </Typography>
                          {match.winner?.id === match.team1?.id && (
                            <Chip
                              label="WINNER"
                              size="small"
                              variant="outlined"
                              sx={{
                                fontWeight: 600,
                                color: 'success.contrastText',
                                borderColor: 'success.contrastText',
                              }}
                            />
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
                                ? 'success.main'
                                : 'background.paper',
                            border: 1,
                            borderColor:
                              match.winner?.id === match.team2?.id ? 'success.dark' : 'divider',
                          }}
                        >
                          <Typography
                            variant="body1"
                            fontWeight={match.winner?.id === match.team2?.id ? 600 : 400}
                            sx={{
                              color:
                                match.winner?.id === match.team2?.id
                                  ? 'success.contrastText'
                                  : match.team2
                                  ? 'text.primary'
                                  : 'text.disabled',
                            }}
                          >
                            {match.team2 ? match.team2.name : 'TBD'}
                          </Typography>
                          {match.winner?.id === match.team2?.id && (
                            <Chip
                              label="WINNER"
                              size="small"
                              variant="outlined"
                              sx={{
                                fontWeight: 600,
                                color: 'success.contrastText',
                                borderColor: 'success.contrastText',
                              }}
                            />
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
