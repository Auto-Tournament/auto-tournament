import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack, Tooltip } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { getStatusColor, getStatusLabel, getRoundLabel } from '../../utils/matchUtils';
import { isManualMatch, isShuffleMatch, isVetoDisabledForMatch } from '../../utils/matchFlags';
import type { Match } from '../../types';
import { CURRENT_MAP_SCORE_LABEL, SERIES_SCORE_LABEL } from '../../utils/matchScoreDisplay';

interface MatchCardProps {
  match: Match;
  matchNumber: number; // Global match number
  roundLabel?: string; // Optional custom round label
  variant?: 'live' | 'completed' | 'default'; // Visual variant
  vetoCompleted?: boolean; // Whether veto is complete
  tournamentStarted?: boolean; // Whether tournament has started
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  allocationETA?: number | null; // Estimated seconds until server allocation (null if already allocated)
  queuePosition?: number | null; // Position in allocation queue (1 = first in queue)
  hasAvailableServers?: boolean; // Whether there are servers available right now
}

export const MatchCard: React.FC<MatchCardProps> = ({
  match,
  matchNumber,
  roundLabel,
  variant = 'default',
  vetoCompleted,
  tournamentStarted,
  onClick,
  selectable: _selectable,
  selected,
  onToggleSelected: _onToggleSelected,
  allocationETA,
  queuePosition,
  hasAvailableServers,
}) => {
  const getBorderColor = () => {
    // Bracket view / generic match card server status accents:
    // - allocated (serverId set, not yet loaded/live/completed) => yellow
    // - loaded (warmup) => blue
    // - live  => red
    // - completed or upcoming (no server) => no colored border
    if (match.status === 'live') return 'error.main';
    if (match.status === 'loaded') return 'info.main';
    if (match.serverId && match.status !== 'completed') return 'warning.main';
    // For completed and all other non-live states without a server, no colored border.
    return 'transparent';
  };

  const isWinnerById = (teamId: string | undefined) => {
    // Only treat a team as winner when both an explicit winner.id and a
    // concrete teamId are present. This avoids "both winners" for manual
    // matches where team IDs are null/undefined.
    if (!teamId || !match.winner?.id) return false;
    return match.winner.id === teamId;
  };
  const shuffle = isShuffleMatch(match);
  const manual = isManualMatch(match);
  const vetoDisabled = isVetoDisabledForMatch(match);

  const getTeamName = (teamId: string | undefined, which: 'team1' | 'team2') => {
    const team = teamId === match.team1?.id ? match.team1 : match.team2;
    if (team) {
      return team.name;
    }
    // Fallback for manual/ad‑hoc matches where inline config contains team
    // names but the DB team IDs are null.
    const configTeam =
      which === 'team1'
        ? (match.config?.team1 as { name?: string } | undefined)
        : (match.config?.team2 as { name?: string } | undefined);
    if (configTeam?.name) {
      return configTeam.name;
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

  // Derive a winner side for display purposes:
  // - Prefer explicit winner.id when present (bracket matches with real teams)
  // - Fall back to series map score when match is completed (manual/ad‑hoc matches)
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

  const team1IsWinner = winnerSide === 'team1';
  const team2IsWinner = winnerSide === 'team2';

  const isWinnerVisual = (which: 'team1' | 'team2') => {
    // Prefer series-derived winnerSide for visual state when available,
    // otherwise fall back to explicit winner.id.
    if (winnerSide) return winnerSide === which;
    const id = which === 'team1' ? match.team1?.id : match.team2?.id;
    return isWinnerById(id);
  };

  const getTeamBgColor = (which: 'team1' | 'team2') => {
    if (isWinnerVisual(which)) return 'success.main';
    return 'background.paper';
  };

  const getTeamBorderColor = (which: 'team1' | 'team2') => {
    if (isWinnerVisual(which)) return 'success.dark';
    return 'divider';
  };

  const getTeamTextColor = (which: 'team1' | 'team2') => {
    if (isWinnerVisual(which)) return 'success.contrastText';
    const team = which === 'team1' ? match.team1 : match.team2;
    if (team) return 'text.primary';
    return 'text.disabled';
  };

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
        borderLeftColor: getBorderColor(),
        border: selected ? 2 : 0,
        borderRadius: 2,
        borderStyle: 'solid',
        borderColor: selected ? 'primary.main' : getBorderColor(),
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
          <Box display="flex" alignItems="center" gap={1}>
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
              {!match.serverId && queuePosition !== undefined && queuePosition !== null && (
                <Typography
                  variant="caption"
                  color="primary.main"
                  display="block"
                  fontWeight={600}
                  sx={{ 
                    bgcolor: 'primary.50',
                    px: 1,
                    py: 0.25,
                    borderRadius: 0.5,
                    display: 'inline-block',
                    mt: 0.5
                  }}
                >
                  📋 Queue Position: #{queuePosition}
                </Typography>
              )}
              {!match.serverId && allocationETA !== undefined && allocationETA !== null && (
                <Typography
                  variant="caption"
                  color={
                    allocationETA === -1
                      ? 'error.main'
                      : allocationETA === 0 && hasAvailableServers
                      ? 'success.main'
                      : allocationETA === 0
                      ? 'error.main'
                      : 'warning.main'
                  }
                  display="block"
                  fontWeight={500}
                  sx={{ mt: 0.25 }}
                >
                  {allocationETA === -1
                    ? '⏸️ Waiting for servers...'
                    : allocationETA === 0 && !hasAvailableServers
                    ? '⏸️ Waiting for servers...'
                    : allocationETA === 0
                    ? '⚡ Allocating now...'
                    : `⏳ Allocates in ${Math.floor(allocationETA / 60)}:${(allocationETA % 60).toString().padStart(2, '0')}`}
                </Typography>
              )}
            </Box>
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
            {match.config?.simulation && (
              <Chip
                icon={<SmartToyIcon />}
                label="Simulation"
                size="small"
                color="secondary"
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
                Boolean(match.serverId),
                match.liveStats?.team1Score,
                match.liveStats?.team2Score,
                match.config?.maxRounds,
                typeof match.config?.cvars === 'object' && match.config.cvars
                  ? typeof (match.config.cvars as Record<string, string | number>)[
                      'mp_overtime_maxrounds'
                    ] === 'number'
                    ? Number(
                        (match.config.cvars as Record<string, string | number>)[
                          'mp_overtime_maxrounds'
                        ]
                      )
                    : undefined
                  : undefined
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
              bgcolor: getTeamBgColor('team1'),
              border: 1,
              borderColor: getTeamBorderColor('team1'),
            }}
          >
            <Box display="flex" alignItems="center" gap={1} flex={1}>
              <Typography
                variant="body1"
                fontWeight={team1IsWinner ? 600 : 500}
                sx={{ color: getTeamTextColor('team1') }}
              >
                {getTeamName(match.team1?.id, 'team1')}
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
              <Tooltip
                title={match.status === 'completed' ? SERIES_SCORE_LABEL : CURRENT_MAP_SCORE_LABEL}
                placement="top"
              >
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
              </Tooltip>
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
              bgcolor: getTeamBgColor('team2'),
              border: 1,
              borderColor: getTeamBorderColor('team2'),
            }}
          >
            <Box display="flex" alignItems="center" gap={1} flex={1}>
              <Typography
                variant="body1"
                fontWeight={team2IsWinner ? 600 : 500}
                sx={{ color: getTeamTextColor('team2') }}
              >
                {getTeamName(match.team2?.id, 'team2')}
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
              <Tooltip
                title={match.status === 'completed' ? SERIES_SCORE_LABEL : CURRENT_MAP_SCORE_LABEL}
                placement="top"
              >
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
              </Tooltip>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};
