import React from 'react';
import { Card, CardContent, Box, Typography, Chip } from '@mui/material';
import { getStatusColor, getStatusLabel, getRoundLabel } from '../../utils/matchUtils';
import {
  isManualMatch,
  isShuffleMatch,
  isVetoDisabledForMatch,
  type MatchLike,
} from '../../utils/matchFlags';
import type { Match } from '../../types';

interface MatchListCardProps {
  match: Match;
  matchNumber: number;
  roundLabel?: string;
  onClick?: () => void;
}

export const MatchListCard: React.FC<MatchListCardProps> = ({
  match,
  matchNumber,
  roundLabel,
  onClick,
}) => {
  const matchLike = match as unknown as MatchLike;
  const shuffle = isShuffleMatch(matchLike);
  const manual = isManualMatch(matchLike);
  const vetoDisabled = isVetoDisabledForMatch(matchLike);

  const deriveSeriesMaps = () => {
    let seriesMapsTeam1: number | undefined =
      typeof match.team1Score === 'number' ? match.team1Score : undefined;
    let seriesMapsTeam2: number | undefined =
      typeof match.team2Score === 'number' ? match.team2Score : undefined;

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

  // Winner side: prefer explicit winner.id where possible, fall back to series score.
  let winnerSide: 'team1' | 'team2' | null = null;
  if (match.status === 'completed') {
    if (match.winner?.id && match.team1?.id && match.winner.id === match.team1.id) {
      winnerSide = 'team1';
    } else if (match.winner?.id && match.team2?.id && match.winner.id === match.team2.id) {
      winnerSide = 'team2';
    } else if (
      typeof seriesMapsTeam1 === 'number' &&
      typeof seriesMapsTeam2 === 'number' &&
      seriesMapsTeam1 !== seriesMapsTeam2
    ) {
      winnerSide = seriesMapsTeam1 > seriesMapsTeam2 ? 'team1' : 'team2';
    }
  }

  const getTeamName = (teamId: string | undefined, which: 'team1' | 'team2') => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      return team.name;
    }
    const configTeam =
      which === 'team1'
        ? (match.config?.team1 as { name?: string } | undefined)
        : (match.config?.team2 as { name?: string } | undefined);
    if (configTeam?.name) return configTeam.name;
    if (match.status === 'completed') return '—';
    return 'TBD';
  };

  const getTeamScoreDisplay = (team: 'team1' | 'team2'): number | undefined => {
    if (match.status === 'completed') {
      const seriesScore = team === 'team1' ? seriesMapsTeam1 : seriesMapsTeam2;
      return typeof seriesScore === 'number' ? seriesScore : undefined;
    }
    const roundsScore = team === 'team1' ? match.team1Score : match.team2Score;
    return typeof roundsScore === 'number' ? roundsScore : undefined;
  };

  return (
    <Card
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s, box-shadow 0.15s',
        '&:hover': onClick
          ? {
              transform: 'translateY(-2px)',
              boxShadow: 4,
            }
          : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box
          position="relative"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          width="100%"
        >
          {/* Match meta */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" fontWeight={600} display="block">
              #{matchNumber} · {roundLabel || getRoundLabel(match.round)}
            </Typography>
            {match.serverName && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {match.serverName}
              </Typography>
            )}
          </Box>

          <Box
            flex={1}
            minWidth={0}
            position="absolute"
            justifyContent="center"
            alignItems="center"
            display="flex"
            left={0}
            right={0}
            top={0}
            bottom={0}
          >
            <Box position="relative">
              <Typography
                variant="body2"
                fontWeight={winnerSide === 'team1' ? 600 : 500}
                noWrap
                position="absolute"
                right="120%"
                top={0}
                bottom={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                color={winnerSide === 'team1' ? 'success' : 'text.secondary'}
              >
                {getTeamName(match.team1?.id, 'team1')}
              </Typography>

              <Typography variant="h6" fontWeight={700}>
                {getTeamScoreDisplay('team1') !== undefined &&
                  getTeamScoreDisplay('team2') !== undefined &&
                  `${getTeamScoreDisplay('team1')} - ${getTeamScoreDisplay('team2')}`}
              </Typography>

              <Typography
                variant="body2"
                fontWeight={winnerSide === 'team2' ? 600 : 500}
                noWrap
                position="absolute"
                left="120%"
                top={0}
                bottom={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                color={winnerSide === 'team2' ? 'success' : 'text.secondary'}
              >
                {getTeamName(match.team2?.id, 'team2')}
              </Typography>
            </Box>
          </Box>

          {/* Status / badges */}
          <Box display="flex" alignItems="center" gap={0.5}>
            {shuffle && (
              <Chip
                label={manual ? 'Shuffle manual' : 'Shuffle'}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            )}
            {!shuffle && manual && (
              <Chip label="Manual" size="small" variant="outlined" sx={{ fontWeight: 500 }} />
            )}
            <Chip
              label={getStatusLabel(
                match.status,
                false,
                vetoDisabled ? true : match.vetoCompleted,
                undefined,
                Boolean(match.serverId)
              )}
              size="small"
              color={getStatusColor(match.status)}
              sx={{ fontWeight: 600 }}
            />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
