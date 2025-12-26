import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack } from '@mui/material';
import { getStatusColor, getStatusLabel, getRoundLabel } from '../../utils/matchUtils';
import { isManualMatch, isShuffleMatch, isVetoDisabledForMatch } from '../../utils/matchFlags';
import type { Match } from '../../types';

interface MatchCardProps {
  match: Match;
  matchNumber: number; // Global match number
  roundLabel?: string; // Optional custom round label
  variant?: 'live' | 'completed' | 'default'; // Visual variant
  vetoCompleted?: boolean; // Whether veto is complete
  tournamentStarted?: boolean; // Whether tournament has started
  onClick?: () => void;
}

export const MatchCard: React.FC<MatchCardProps> = ({
  match,
  matchNumber,
  roundLabel,
  variant = 'default',
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
    // Use the same pastel red accent for LIVE across all match cards
    if (match.status === 'live') return 'error.main';
    // Loaded = warmup (soft blue), ready/pending stay neutral
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
  const shuffle = isShuffleMatch(match);
  const manual = isManualMatch(match);
  const vetoDisabled = isVetoDisabledForMatch(match);

  const getTeamName = (teamId: string | undefined) => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      return team.name;
    }
    if (match.status === 'completed') return '—';
    return 'TBD';
  };

  // Score display logic:
  // - While a match is LIVE/LOADED, cards should show current **map rounds** (e.g. 8‑5)
  //   so they match the live modal.
  // - Once a match is COMPLETED, cards should show the final **series result** in maps
  //   (e.g. 1‑0, 2‑1) for BO formats.
  const deriveSeriesMaps = () => {
    let seriesMapsTeam1: number | undefined =
      typeof match.team1Score === 'number' ? match.team1Score : undefined;
    let seriesMapsTeam2: number | undefined =
      typeof match.team2Score === 'number' ? match.team2Score : undefined;

    // Fallback: if series scores are missing, derive from mapResults
    if (
      (seriesMapsTeam1 === undefined || seriesMapsTeam2 === undefined) &&
      match.mapResults &&
      match.mapResults.length > 0
    ) {
      const derived = match.mapResults.reduce(
        (acc, result) => {
          if (result.team1Score > result.team2Score) acc.team1 += 1;
          else if (result.team2Score > result.team1Score) acc.team2 += 1;
          return acc;
        },
        { team1: 0, team2: 0 }
      );
      seriesMapsTeam1 = derived.team1;
      seriesMapsTeam2 = derived.team2;
    }

    return { seriesMapsTeam1, seriesMapsTeam2 };
  };

  const { seriesMapsTeam1, seriesMapsTeam2 } = deriveSeriesMaps();

  const team1IsWinner = isWinner(match.team1?.id);
  const team2IsWinner = isWinner(match.team2?.id);

  const getTeamScoreDisplay = (team: 'team1' | 'team2'): number | undefined => {
    // For completed matches, prioritize series map wins (e.g. 1‑0, 2‑1).
    if (match.status === 'completed') {
      const seriesScore = team === 'team1' ? seriesMapsTeam1 : seriesMapsTeam2;
      return typeof seriesScore === 'number' ? seriesScore : undefined;
    }

    // For live/loaded/ready/pending matches, show current map rounds (e.g. 8‑5)
    // using the DB-backed scores which the backend keeps in sync with liveStats.
    const roundsScore = team === 'team1' ? match.team1Score : match.team2Score;
    return typeof roundsScore === 'number' ? roundsScore : undefined;
  };

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
            {shuffle && (
              <Chip
                label={manual ? 'Shuffle manual' : 'Shuffle'}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            )}
            {!shuffle && manual && (
              <Chip
                label="Manual"
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            )}
            <Chip
              label={getStatusLabel(
                match.status,
                false,
                // Shuffle tournaments and veto-disabled matches don't use veto – treat
                // as completed to avoid "VETO PENDING" labels on the list view.
                vetoDisabled ? true : vetoCompleted,
                tournamentStarted,
                Boolean(match.serverId)
              )}
              size="small"
              color={getStatusColor(match.status)}
              sx={{ fontWeight: 600, minWidth: variant === 'live' ? 140 : 'auto' }}
            />
          </Box>
        </Box>

        {/* Teams with right-aligned score */}
        <Stack spacing={1.5}>
          {/* Team 1 row */}
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
            <Box display="flex" alignItems="center" gap={1} flex={1}>
              <Typography
                variant="body1"
                fontWeight={team1IsWinner ? 600 : 500}
                sx={{ color: getTeamTextColor(match.team1?.id) }}
              >
                {getTeamName(match.team1?.id)}
              </Typography>
              {team1IsWinner && (
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
            {getTeamScoreDisplay('team1') !== undefined && (
              <Typography
                variant="h6"
                fontWeight={700}
                sx={{
                  minWidth: 24,
                  textAlign: 'right',
                  ml: 1,
                  // On the green winner background we want a dark score color
                  // for better contrast; on non-winner rows keep the default.
                  color: team1IsWinner ? 'grey.900' : 'text.primary',
                }}
              >
                {getTeamScoreDisplay('team1')}
              </Typography>
            )}
          </Box>

          {/* Team 2 row */}
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
            <Box display="flex" alignItems="center" gap={1} flex={1}>
              <Typography
                variant="body1"
                fontWeight={team2IsWinner ? 600 : 500}
                sx={{ color: getTeamTextColor(match.team2?.id) }}
              >
                {getTeamName(match.team2?.id)}
              </Typography>
              {team2IsWinner && (
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
            {getTeamScoreDisplay('team2') !== undefined && (
              <Typography
                variant="h6"
                fontWeight={700}
                sx={{
                  minWidth: 24,
                  textAlign: 'right',
                  ml: 1,
                  color: team2IsWinner ? 'grey.900' : 'text.primary',
                }}
              >
                {getTeamScoreDisplay('team2')}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};
