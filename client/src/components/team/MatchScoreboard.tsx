import React from 'react';
import { Stack, Typography, Chip, Paper, Box } from '@mui/material';
import { CURRENT_MAP_SCORE_LABEL, SERIES_SCORE_LABEL } from '../../utils/matchScoreDisplay';

interface MatchScoreboardProps {
  leftName?: string | null;
  rightName?: string | null;
  leftMapRounds: number;
  rightMapRounds: number;
  leftSeriesWins: number;
  rightSeriesWins: number;
  leftTeamElo?: number | null;
  rightTeamElo?: number | null;
  liveStatusDisplay?: {
    label: string;
    chipColor: 'success' | 'info' | 'warning' | 'default';
  } | null;
  hideSeriesWins?: boolean;
  /**
   * When true, hide the per-map rounds score row and only show the series score (maps won).
   * Used for player-facing views where live round counts are confusing.
   */
  hideMapRounds?: boolean;
}

export function MatchScoreboard({
  leftName,
  rightName,
  leftMapRounds,
  rightMapRounds,
  leftSeriesWins,
  rightSeriesWins,
  leftTeamElo,
  rightTeamElo,
  liveStatusDisplay,
  hideSeriesWins,
  hideMapRounds,
}: MatchScoreboardProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 4,
        background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%)',
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Stack spacing={1} alignItems="center" flex={1}>
          <Typography variant="h4" fontWeight={700} color="primary.main" align="center">
            {leftName}
          </Typography>
          {typeof leftTeamElo === 'number' && Number.isFinite(leftTeamElo) && (
            <Typography variant="body2" color="text.secondary">
              ELO (avg): {leftTeamElo}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="primary.main">
                {leftSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {SERIES_SCORE_LABEL}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={700} color="primary.main">
                {leftMapRounds}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {CURRENT_MAP_SCORE_LABEL}
              </Typography>
            </>
          )}
        </Stack>
        <Stack spacing={1} alignItems="center" mx={3}>
          <Typography variant="h3" color="text.secondary" fontWeight={700}>
            VS
          </Typography>
          {liveStatusDisplay && (
            <Chip
              label={liveStatusDisplay.label}
              color={liveStatusDisplay.chipColor}
              size="small"
              sx={{ fontWeight: 600 }}
            />
          )}
        </Stack>
        <Stack spacing={1} alignItems="center" flex={1}>
          <Typography variant="h4" fontWeight={700} color="error.main" align="center">
            {rightName || 'TBD'}
          </Typography>
          {typeof rightTeamElo === 'number' && Number.isFinite(rightTeamElo) && (
            <Typography variant="body2" color="text.secondary">
              ELO (avg): {rightTeamElo}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="error.main">
                {rightSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {SERIES_SCORE_LABEL}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={700} color="error.main">
                {rightMapRounds}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {CURRENT_MAP_SCORE_LABEL}
              </Typography>
            </>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}

