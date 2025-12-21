import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { LinearProgress } from '@mui/material';
import {
  getStatusColor,
  getStatusLabel,
  getDetailedStatusLabel,
  getRoundLabel,
} from '../../utils/matchUtils';
import type { Match } from '../../types';

interface MatchCardProps {
  match: Match;
  matchNumber: number; // Global match number
  roundLabel?: string; // Optional custom round label
  variant?: 'live' | 'completed' | 'default'; // Visual variant
  playerCount?: number; // Current player count
  liveScores?: { team1Score?: number; team2Score?: number }; // Live scores
  showPlayerProgress?: boolean; // Show player connection progress bar
  vetoCompleted?: boolean; // Whether veto is complete
  tournamentStarted?: boolean; // Whether tournament has started
  onClick?: () => void;
}

export const MatchCard: React.FC<MatchCardProps> = ({
  match,
  matchNumber,
  roundLabel,
  variant = 'default',
  playerCount,
  liveScores,
  showPlayerProgress = false,
  vetoCompleted,
  tournamentStarted,
  onClick,
}) => {
  const getBorderColor = () => {
    if (variant === 'live') {
      return match.status === 'live' ? 'error.main' : 'info.main';
    }
    if (variant === 'completed') {
      return 'success.main';
    }
    if (match.status === 'completed') return 'success.main';
    if (match.status === 'live') return 'warning.main';
    if (match.status === 'loaded') return 'info.main';
    return 'grey.300';
  };

  const isWinner = (teamId: string | undefined) => {
    return match.winner?.id === teamId;
  };

  const getTeamBgColor = (teamId: string | undefined) => {
    if (isWinner(teamId)) return 'success.main';
    return 'background.paper';
  };

  const getTeamBorderColor = (teamId: string | undefined) => {
    if (isWinner(teamId)) return 'success.dark';
    return 'divider';
  };

  const getTeamTextColor = (teamId: string | undefined) => {
    if (isWinner(teamId)) return 'success.contrastText';
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) return 'text.primary';
    return 'text.disabled';
  };

  const isShuffleMatch = () => {
    // Check if team IDs match shuffle tournament pattern
    return (
      (match.team1?.id?.startsWith('shuffle-') || match.team2?.id?.startsWith('shuffle-')) ||
      (match.config?.team1?.id?.startsWith('shuffle-') || match.config?.team2?.id?.startsWith('shuffle-'))
    );
  };

  const getTeamName = (teamId: string | undefined) => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      return team.name;
    }
    if (match.status === 'completed') return '—';
    return 'TBD';
  };

  const expectedPlayers = match.config?.expected_players_total || 10;
  const playerProgress = playerCount !== undefined ? (playerCount / expectedPlayers) * 100 : 0;

  // Derive series maps won (BO formats) and current/last map rounds
  const seriesMapsTeam1 = typeof match.team1Score === 'number' ? match.team1Score : undefined;
  const seriesMapsTeam2 = typeof match.team2Score === 'number' ? match.team2Score : undefined;

  let mapRoundsTeam1: number | undefined;
  let mapRoundsTeam2: number | undefined;

  if (match.mapResults && match.mapResults.length > 0) {
    const lastResult = match.mapResults[match.mapResults.length - 1];
    mapRoundsTeam1 = lastResult.team1Score;
    mapRoundsTeam2 = lastResult.team2Score;
  }

  // While live, prefer liveScores for the current map rounds when provided
  if (liveScores && (liveScores.team1Score !== undefined || liveScores.team2Score !== undefined)) {
    mapRoundsTeam1 = liveScores.team1Score ?? mapRoundsTeam1;
    mapRoundsTeam2 = liveScores.team2Score ?? mapRoundsTeam2;
  }

  return (
    <Card
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        borderLeft: 4,
        borderColor: getBorderColor(),
        '&:hover': onClick
          ? {
              transform: 'translateY(-4px)',
              boxShadow: 6,
            }
          : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.25 }}>
              Match #{matchNumber}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {roundLabel || getRoundLabel(match.round)}
            </Typography>
            {match.serverName && (
              <Typography variant="caption" color="text.secondary" display="block">
                Server: {match.serverName}
              </Typography>
            )}
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Chip
              label={getStatusLabel(
                match.status,
                false,
                // Shuffle tournaments have no veto – treat as completed to avoid "VETO PENDING"
                isShuffleMatch() ? true : vetoCompleted,
                tournamentStarted,
                Boolean(match.serverId)
              )}
              size="small"
              color={getStatusColor(match.status)}
              sx={{ fontWeight: 600, minWidth: variant === 'live' ? 140 : 'auto' }}
            />
          </Box>
        </Box>

        {/* Teams + Score Summary */}
        <Stack spacing={1.5}>
          {/* Team rows */}
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: getTeamBgColor(match.team1?.id),
              border: 1,
              borderColor: getTeamBorderColor(match.team1?.id),
            }}
          >
            <Box flex={1}>
              <Typography
                variant="body1"
                fontWeight={isWinner(match.team1?.id) ? 600 : 500}
                sx={{ color: getTeamTextColor(match.team1?.id) }}
              >
                {getTeamName(match.team1?.id)}
              </Typography>
            </Box>
            {isWinner(match.team1?.id) && (
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
              bgcolor: getTeamBgColor(match.team2?.id),
              border: 1,
              borderColor: getTeamBorderColor(match.team2?.id),
            }}
          >
            <Box flex={1}>
              <Typography
                variant="body1"
                fontWeight={isWinner(match.team2?.id) ? 600 : 500}
                sx={{ color: getTeamTextColor(match.team2?.id) }}
              >
                {getTeamName(match.team2?.id)}
              </Typography>
            </Box>
            {isWinner(match.team2?.id) && (
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

          {/* Compact score summary */}
          {(seriesMapsTeam1 !== undefined ||
            seriesMapsTeam2 !== undefined ||
            mapRoundsTeam1 !== undefined ||
            mapRoundsTeam2 !== undefined) && (
            <Box display="flex" justifyContent="space-between" alignItems="center" mt={0.5}>
              <Box>
                {seriesMapsTeam1 !== undefined && seriesMapsTeam2 !== undefined && (
                  <Typography variant="body2" fontWeight={600}>
                    Series Maps Won: {seriesMapsTeam1} - {seriesMapsTeam2}
                  </Typography>
                )}
                {mapRoundsTeam1 !== undefined && mapRoundsTeam2 !== undefined && (
                  <Typography variant="body2" color="text.secondary">
                    Map Rounds:{' '}
                    <strong>
                      {mapRoundsTeam1} - {mapRoundsTeam2}
                    </strong>
                  </Typography>
                )}
              </Box>
              {isShuffleMatch() && (
                <Typography variant="caption" color="text.secondary">
                  Shuffle match
                </Typography>
              )}
            </Box>
          )}
        </Stack>

        {/* Player Count Info (for live matches) */}
        {showPlayerProgress && playerCount !== undefined && (
          <Box
            mt={2}
            p={1.5}
            bgcolor={
              match.status === 'loaded'
                ? playerCount >= expectedPlayers
                  ? 'success.dark'
                  : 'warning.dark'
                : 'info.dark'
            }
            borderRadius={1}
          >
            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
              <PersonIcon sx={{ fontSize: 18, color: 'white' }} />
              <Typography variant="body2" fontWeight={600} color="white">
                {getDetailedStatusLabel(
                  match.status,
                  playerCount,
                  expectedPlayers,
                  false,
                  // Shuffle tournaments have no veto – treat as completed to avoid "VETO PENDING"
                  isShuffleMatch() ? true : vetoCompleted,
                  tournamentStarted,
                  Boolean(match.serverId)
                )}
              </Typography>
            </Box>
            {match.status === 'loaded' && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={playerProgress}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: 'white',
                      borderRadius: 3,
                    },
                  }}
                />
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};
