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
import ViewListIcon from '@mui/icons-material/ViewList';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useNavigate } from 'react-router-dom';
import BracketsViewerVisualization from '../components/visualizations/BracketsViewerVisualization';
import SwissView from '../components/visualizations/SwissView';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { MatchCard } from '../components/shared/MatchCard';
import { RoundStatusCard } from '../components/tournament/RoundStatusCard';
import { getRoundLabel } from '../utils/matchUtils';
import { useBracket } from '../hooks/useBracket';
import { api } from '../utils/api';
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
    loadBracket,
    startTournament,
  } = useBracket();

  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [roundStatus, setRoundStatus] = useState<{
    roundNumber: number;
    totalMatches: number;
    completedMatches: number;
    pendingMatches: number;
    isComplete: boolean;
    map: string;
  } | null>(null);
  const [shuffleTotalRounds, setShuffleTotalRounds] = useState<number | null>(null);
  const fullscreenRef = useRef<globalThis.HTMLDivElement>(null);

  // Derive the current match from matches array (automatically updates when matches change)
  const selectedMatch = selectedMatchId
    ? matches.find((m) => m.id === selectedMatchId) || null
    : null;

  // Load round status for shuffle tournaments
  useEffect(() => {
    if (tournament?.type === 'shuffle' && tournament?.id) {
      const loadRoundStatus = async () => {
        try {
          const response = await api.get<{
            success: boolean;
            roundStatus?: {
              roundNumber: number;
              totalMatches: number;
              completedMatches: number;
              pendingMatches: number;
              isComplete: boolean;
              map: string;
            };
            totalRounds?: number;
            currentRound?: number;
          }>(`/api/tournament/${tournament.id}/round-status`);
          
          if (response.success && response.roundStatus) {
            setRoundStatus(response.roundStatus);
            // Prefer backend-provided totalRounds; fall back to map sequence length
            if (typeof response.totalRounds === 'number') {
              setShuffleTotalRounds(response.totalRounds);
            } else if (Array.isArray(tournament.mapSequence)) {
              setShuffleTotalRounds(tournament.mapSequence.length);
            } else if (Array.isArray(tournament.maps)) {
              setShuffleTotalRounds(tournament.maps.length);
            }
          }
        } catch (err) {
          console.error('Failed to load round status:', err);
        }
      };

      loadRoundStatus();
      // Refresh every 30 seconds
      const interval = setInterval(loadRoundStatus, 30000);
      return () => clearInterval(interval);
    }
    // Non-shuffle or no tournament:
    // We intentionally do not reset shuffle-specific state here; guards below ensure
    // it is only used when the current tournament is a shuffle tournament.
  }, [tournament?.type, tournament?.id, tournament?.mapSequence, tournament?.maps]);

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Bracket';
  }, []);

  // Calculate global match number
  const getGlobalMatchNumber = (match: Match): number => {
    const sortedMatches = [...matches].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return a.matchNumber - b.matchNumber;
    });
    return sortedMatches.findIndex((m) => m.id === match.id) + 1;
  };

  const handleMatchClick = (match: Match) => {
    if (!match.team1 || !match.team2) {
      return;
    }
    setSelectedMatchId(match.id);
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
      <Box sx={{ width: '100%', height: '100%' }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!tournament) {
    return (
      <Box>
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

  // Special-case: Shuffle tournaments don't use a traditional bracket
  if (tournament.type === 'shuffle' && !matches.length) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        <Card data-testid="bracket-empty-state" sx={{ textAlign: 'center', py: 8, px: 3 }}>
          <EmojiEventsIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No bracket for shuffle tournaments
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Shuffle tournaments don&apos;t use a fixed bracket view. Teams are reshuffled each round based on player ELO.
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Use the <strong>Matches</strong> page to monitor live and upcoming matches, and the{' '}
            <strong>Standings</strong> page to track player rankings.
          </Typography>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button variant="contained" onClick={() => navigate('/matches')}>
              Go to Matches
            </Button>
            <Button variant="outlined" onClick={() => navigate(`/tournament/${tournament.id}/leaderboard`)}>
              View Leaderboard
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  if (!matches.length) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        <Card data-testid="bracket-empty-state" sx={{ textAlign: 'center', py: 8 }}>
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

  // For shuffle tournaments, prefer shuffleTotalRounds; fall back to max round present
  const effectiveTotalRounds =
    tournament.type === 'shuffle'
      ? shuffleTotalRounds ??
        (Object.keys(matchesByRound).length
          ? Math.max(...Object.keys(matchesByRound).map((r) => Number(r)))
          : 0)
      : totalRounds;

  return (
    <Box
      ref={fullscreenRef}
      data-testid="bracket-page"
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
              <Box data-testid="bracket-tournament-info">
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

      {/* Round Status for Shuffle Tournaments */}
      {tournament.type === 'shuffle' && roundStatus && (
        <RoundStatusCard
          roundStatus={roundStatus}
          totalRounds={shuffleTotalRounds ?? totalRounds}
          isActive={!roundStatus.isComplete}
        />
      )}

      {/* Bracket visualization */}
      {viewMode === 'visual' ? (
        <Box
          data-testid="bracket-visualization"
          sx={{
            height: isFullscreen ? '100vh' : 'auto',
            pt: 0,
          }}
        >
          {/* Use appropriate visualization based on tournament type */}
          {tournament.type === 'swiss' ? (
            <SwissView
              matches={matches}
              teams={tournament.teams || []}
              totalRounds={totalRounds}
              onMatchClick={handleMatchClick}
            />
          ) : tournament.type === 'shuffle' ? (
            // Shuffle tournaments don't have a fixed bracket tree – hide BracketsViewer entirely
            <Box
              sx={{
                py: 6,
                px: 3,
                textAlign: 'center',
              }}
            >
              <Typography variant="h6" gutterBottom>
                No visual bracket for shuffle tournaments
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Matches are generated dynamically each round based on player ELO and team balancing.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Use the <strong>List</strong> view, the <strong>Matches</strong> page, and{' '}
                <strong>Standings</strong> to track shuffle tournament progress.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                For a full walkthrough of how shuffle works, see the{' '}
                <strong>Shuffle Tournaments</strong> guide in the documentation.
              </Typography>
            </Box>
          ) : (
            // All bracket-manager types: single_elimination, double_elimination, round_robin
            <BracketsViewerVisualization
              matches={matches}
              tournamentType={tournament.type}
              isFullscreen={isFullscreen}
              onMatchClick={handleMatchClick}
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
          {Array.from({ length: effectiveTotalRounds }, (_, i) => i + 1).map((round) => {
            const roundMatches = matchesByRound[round] || [];
            if (roundMatches.length === 0) return null;
            
            return (
              <Box key={round} mb={4}>
                <Typography variant="h6" fontWeight={600} mb={2}>
                  {getRoundLabel(round, effectiveTotalRounds)}
                  {tournament.type === 'shuffle' && roundStatus && roundStatus.roundNumber === round && (
                    <Chip
                      label={roundStatus.map}
                      size="small"
                      sx={{ ml: 1 }}
                      color="primary"
                      variant="outlined"
                    />
                  )}
                </Typography>
                <Stack spacing={2}>
                  {roundMatches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      matchNumber={getGlobalMatchNumber(match)}
                      roundLabel={getRoundLabel(round, totalRounds)}
                      onClick={() => handleMatchClick(match)}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })}
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
