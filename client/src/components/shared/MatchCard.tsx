import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import DownloadIcon from '@mui/icons-material/Download';
import { LinearProgress, IconButton, Tooltip } from '@mui/material';
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
  onDownloadDemo?: (event: React.MouseEvent) => void;
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
  onDownloadDemo,
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

  const normalizeConfigPlayers = (
    rawPlayers: unknown
  ): Array<{ name: string; elo?: number }> => {
    if (!rawPlayers) return [];

    // Already an array of players
    if (Array.isArray(rawPlayers)) {
      return rawPlayers
        .map((p) => {
          if (!p || typeof p !== 'object') return null;
          const obj = p as { name?: string; elo?: number };
          if (!obj.name) return null;
          return { name: obj.name, elo: obj.elo };
        })
        .filter((p): p is { name: string; elo?: number } => p !== null);
    }

    // MatchZy-style map: { steamId: name } or { steamId: { name, elo? } }
    if (typeof rawPlayers === 'object') {
      const entries: Array<{ name: string; elo?: number }> = [];
      Object.values(rawPlayers as Record<string, unknown>).forEach((value) => {
        if (typeof value === 'string') {
          entries.push({ name: value });
        } else if (value && typeof value === 'object' && 'name' in (value as any)) {
          const v = value as { name?: string; elo?: number };
          if (v.name) {
            entries.push({ name: v.name, elo: v.elo });
          }
        }
      });
      return entries;
    }

    return [];
  };

  const getTeamName = (teamId: string | undefined) => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      // For shuffle tournaments, keep the card compact – just show player count, not full roster
      if (isShuffleMatch()) {
        const configTeam = teamId === match.team1?.id ? match.config?.team1 : match.config?.team2;
        const configPlayers = normalizeConfigPlayers(configTeam?.players);
        const playerCount =
          configPlayers.length ||
          (teamId === match.team1?.id
            ? match.team1Players?.length || match.config?.expected_players_team1 || 5
            : match.team2Players?.length || match.config?.expected_players_team2 || 5);

        return `${playerCount} players`;
      }
      return team.name;
    }
    if (match.status === 'completed') return '—';
    return 'TBD';
  };

  const expectedPlayers = match.config?.expected_players_total || 10;
  const playerProgress = playerCount !== undefined ? (playerCount / expectedPlayers) * 100 : 0;
  const totalMaps =
    match.config?.num_maps ??
    (match.config?.maplist && match.config.maplist.length > 0
      ? match.config.maplist.length
      : undefined);
  const mapDisplayNumber =
    typeof match.mapNumber === 'number'
      ? totalMaps
        ? Math.min(match.mapNumber + 1, totalMaps)
        : match.mapNumber + 1
      : null;

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
            {/* For shuffle tournaments the map is fixed and veto-less, so hide the extra map chip */}
            {!isShuffleMatch() && mapDisplayNumber && totalMaps && (
              <Chip
                label={`Map ${mapDisplayNumber}/${totalMaps}`}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            )}
            {match.demoFilePath && onDownloadDemo && (
              <Tooltip title="Download demo">
                <IconButton size="small" onClick={onDownloadDemo} sx={{ color: 'primary.main' }}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Teams */}
        <Stack spacing={1.5}>
          {/* Team 1 */}
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
                sx={{
                  color: getTeamTextColor(match.team1?.id),
                }}
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
            {liveScores?.team1Score !== undefined && (
              <Chip
                label={liveScores.team1Score}
                size="small"
                sx={{ fontWeight: 600, minWidth: 40 }}
              />
            )}
          </Box>

          {/* VS Divider */}
          <Box display="flex" justifyContent="center">
            <Typography variant="body2" color="text.secondary" fontWeight={600}>
              VS
            </Typography>
          </Box>

          {/* Team 2 */}
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
                sx={{
                  color: getTeamTextColor(match.team2?.id),
                }}
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
            {liveScores?.team2Score !== undefined && (
              <Chip
                label={liveScores.team2Score}
                size="small"
                sx={{ fontWeight: 600, minWidth: 40 }}
              />
            )}
          </Box>
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
                  vetoCompleted,
                  tournamentStarted
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
