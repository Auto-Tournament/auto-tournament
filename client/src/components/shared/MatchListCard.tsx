import React from 'react';
import { Card, CardContent, Box, Typography, Chip, Tooltip } from '@mui/material';
import { getStatusColor, getStatusLabel } from '../../utils/matchUtils';
import {
  isManualMatch,
  isShuffleMatch,
  isVetoDisabledForMatch,
  type MatchLike,
} from '../../utils/matchFlags';
import type { Match, MatchLiveStats } from '../../types';
import {
  CURRENT_MAP_SCORE_LABEL,
  SERIES_SCORE_LABEL,
  deriveCurrentMapScore,
  deriveSeriesScore,
} from '../../utils/matchScoreDisplay';

interface MatchListCardProps {
  match: Match;
  matchNumber: number;
  roundLabel?: string;
  onClick?: () => void;
  scoreDisplayMode?: 'auto' | 'series';
}

export const MatchListCard: React.FC<MatchListCardProps> = ({
  match,
  matchNumber,
  roundLabel: _roundLabel,
  onClick,
  scoreDisplayMode = 'auto',
}) => {
  const bracketMatch = match as Match & { liveStats?: MatchLiveStats | null };
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
    if (scoreDisplayMode === 'series') {
      const series = deriveSeriesScore(bracketMatch, bracketMatch.liveStats ?? null);
      return team === 'team1' ? series.team1 : series.team2;
    }

    if (match.status === 'completed') {
      // Normal path: use derived series maps (best-of-N).
      let seriesScore = team === 'team1' ? seriesMapsTeam1 : seriesMapsTeam2;

      // If we have a declared winner but the series scores are tied (e.g. 1-1),
      // this is typically a single-map series where the map ended tied on
      // rounds but the plugin broke the tie by performance (damage).
      // In that case, force a clear 1–0 / 0–1 display instead of 1–1.
      if (
        match.status === 'completed' &&
        winnerSide &&
        typeof seriesMapsTeam1 === 'number' &&
        typeof seriesMapsTeam2 === 'number' &&
        seriesMapsTeam1 === seriesMapsTeam2 &&
        (!match.mapResults || match.mapResults.length === 0)
      ) {
        seriesScore = team === winnerSide ? 1 : 0;
      }

      return typeof seriesScore === 'number' ? seriesScore : undefined;
    }
    const roundsScore = team === 'team1' ? match.team1Score : match.team2Score;
    return typeof roundsScore === 'number' ? roundsScore : undefined;
  };

  // In the bracket list view we want to emphasise the map number rather than
  // the round label, so always show "Map N" (defaulting to Map 1 when unknown).
  const metaLabel =
    typeof match.mapNumber === 'number' ? `Map ${match.mapNumber + 1}` : 'Map 1';

  const tooltipTitle = (() => {
    if (scoreDisplayMode === 'series') {
      const series = deriveSeriesScore(bracketMatch, bracketMatch.liveStats ?? null);
      const current = deriveCurrentMapScore(bracketMatch, bracketMatch.liveStats ?? null, {
        mapNumber: match.mapNumber ?? null,
      });
      const hasLiveRounds =
        !!bracketMatch.liveStats &&
        (match.status === 'live' || match.status === 'loaded') &&
        (current.source === 'liveStats' || current.team1 !== 0 || current.team2 !== 0);
      return hasLiveRounds
        ? `${CURRENT_MAP_SCORE_LABEL}: ${current.team1} - ${current.team2}`
        : `${SERIES_SCORE_LABEL}: ${series.team1} - ${series.team2}`;
    }
    return match.status === 'completed' ? SERIES_SCORE_LABEL : CURRENT_MAP_SCORE_LABEL;
  })();

  const getBorderColor = () => {
    // Bracket list view server status accents:
    // - allocated (serverId set, not yet loaded/live/completed) => yellow
    // - loaded (warmup) => blue
    // - live  => red
    // - completed or upcoming (no server) => no colored border
    if (match.status === 'live') return 'error.main';
    if (match.status === 'loaded') return 'info.main';
    if (match.serverId && match.status !== 'completed') return 'warning.main';
    return 'transparent';
  };

  return (
    <Card
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s, box-shadow 0.15s',
        borderLeftWidth: 4,
        borderLeftStyle: 'solid',
        borderLeftColor: getBorderColor(),
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
              #{matchNumber} · {metaLabel}
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

              <Tooltip title={tooltipTitle} placement="top">
                <Typography variant="h6" fontWeight={700}>
                  {getTeamScoreDisplay('team1') !== undefined &&
                    getTeamScoreDisplay('team2') !== undefined &&
                    `${getTeamScoreDisplay('team1')} - ${getTeamScoreDisplay('team2')}`}
                </Typography>
              </Tooltip>

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
