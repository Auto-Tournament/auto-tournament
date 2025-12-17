import React from 'react';
import { Stack, Typography, Chip, Paper, Box } from '@mui/material';

interface MatchScoreboardProps {
  leftName?: string | null;
  rightName?: string | null;
  leftMapRounds: number;
  rightMapRounds: number;
  leftSeriesWins: number;
  rightSeriesWins: number;
  liveStatusDisplay?: {
    label: string;
    chipColor: 'success' | 'info' | 'warning' | 'default';
  } | null;
  hideSeriesWins?: boolean;
}

export function MatchScoreboard({
  leftName,
  rightName,
  leftMapRounds,
  rightMapRounds,
  leftSeriesWins,
  rightSeriesWins,
  liveStatusDisplay,
  hideSeriesWins,
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
          <Typography variant="h4" fontWeight={700} color="primary.main">
            {leftName}
          </Typography>
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="primary.main">
                {leftSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Series Maps Won
              </Typography>
            </>
          )}
          <Typography variant="h4" fontWeight={700} color="primary.main">
            {leftMapRounds}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Map Rounds
          </Typography>
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
          <Typography variant="h4" fontWeight={700} color="error.main">
            {rightName || 'TBD'}
          </Typography>
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="error.main">
                {rightSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Series Maps Won
              </Typography>
            </>
          )}
          <Typography variant="h4" fontWeight={700} color="error.main">
            {rightMapRounds}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Map Rounds
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}

