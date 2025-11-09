import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Chip,
  Card,
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
import BracketVisualization from '../components/visualizations/BracketVisualization';
import ModernBracketVisualization from '../components/visualizations/ModernBracketVisualization';
import RoundRobinView from '../components/visualizations/RoundRobinView';
import SwissView from '../components/visualizations/SwissView';
import DoubleEliminationView from '../components/visualizations/DoubleEliminationView';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { MatchCard } from '../components/shared/MatchCard';
import { getRoundLabel } from '../utils/matchUtils';
import { useBracket } from '../hooks/useBracket';
import type { Match } from '../types';

// Interfaces are now imported from useBracket hook

export default function Bracket() {
  const navigate = useNavigate();
  const {
    loading,
    error,
    tournament,
    matches,
    totalRounds,
    starting,
    startSuccess,
    startError,
    loadBracket,
    startTournament,
  } = useBracket();

  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const fullscreenRef = useRef<globalThis.HTMLDivElement>(null);

  // Derive the current match from matches array (automatically updates when matches change)
  const selectedMatch = selectedMatchId
    ? matches.find((m) => m.id === selectedMatchId) || null
    : null;

  // Calculate global match number
  const getGlobalMatchNumber = (match: Match): number => {
    const sortedMatches = [...matches].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.matchNumber - b.matchNumber;
    });
    return sortedMatches.findIndex((m) => m.id === match.id) + 1;
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!globalThis.document.fullscreenElement);
    };

    globalThis.document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      globalThis.document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) return;

    try {
      if (!globalThis.document.fullscreenElement) {
        await fullscreenRef.current.requestFullscreen();
      } else {
        await globalThis.document.exitFullscreen();
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
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
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Bracket
          </Typography>
        </Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!tournament) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Bracket
          </Typography>
        </Box>
        <EmptyState
          icon={AccountTreeOutlinedIcon}
          title="No bracket to display"
          description="Create a tournament and generate the bracket to get started"
          actionLabel="Create Tournament"
          actionIcon={AddIcon}
          onAction={() => navigate('/tournament')}
        />
      </Box>
    );
  }

  if (!matches.length) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <AccountTreeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={600}>
            Bracket
          </Typography>
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
        <>
          {/* Success/Error Alerts */}
          {startSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {startSuccess}
            </Alert>
          )}
          {startError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {startError}
            </Alert>
          )}

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
              {tournament.status === 'setup' && (
                <Button
                  variant="contained"
                  color="success"
                  onClick={startTournament}
                  disabled={starting}
                  startIcon={starting ? <CircularProgress size={16} /> : null}
                >
                  {starting ? 'Starting...' : '🚀 Start Tournament'}
                </Button>
              )}
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
        </>
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
          {/* Use appropriate visualization based on tournament type */}
          {tournament.type === 'round_robin' ? (
            <RoundRobinView
              matches={matches}
              teams={tournament.teams || []}
              onMatchClick={(match) => setSelectedMatchId(match.id)}
            />
          ) : tournament.type === 'swiss' ? (
            <SwissView
              matches={matches}
              teams={tournament.teams || []}
              totalRounds={totalRounds}
              onMatchClick={(match) => setSelectedMatchId(match.id)}
            />
          ) : tournament.type === 'double_elimination' ? (
            <DoubleEliminationView
              matches={matches}
              onMatchClick={(match) => setSelectedMatchId(match.id)}
            />
          ) : tournament.type === 'single_elimination' ? (
            <ModernBracketVisualization
              matches={matches}
              totalRounds={totalRounds}
              tournamentType={tournament.type}
              isFullscreen={isFullscreen}
              onMatchClick={(match) => setSelectedMatchId(match.id)}
            />
          ) : (
            <BracketVisualization
              matches={matches}
              totalRounds={totalRounds}
              tournamentType={tournament.type}
              isFullscreen={isFullscreen}
              onMatchClick={(match) => setSelectedMatchId(match.id)}
            />
          )}
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
                  <MatchCard
                    key={match.id}
                    match={match}
                    matchNumber={getGlobalMatchNumber(match)}
                    roundLabel={getRoundLabel(round, totalRounds)}
                    onClick={() => setSelectedMatchId(match.id)}
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {/* Match Details Modal */}
      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={getGlobalMatchNumber(selectedMatch)}
          roundLabel={getRoundLabel(selectedMatch.round, totalRounds)}
          onClose={() => setSelectedMatchId(null)}
        />
      )}
    </Box>
  );
}
