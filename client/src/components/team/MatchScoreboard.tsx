import { Stack, Typography, Chip, Paper, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { tokens, mono } from '../../theme/tokens';

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
  const { t } = useTranslation();

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 4 },
        bgcolor: 'background.surface2',
        borderColor: 'transparent',
        borderRadius: `${tokens.radius.md}px`,
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Stack spacing={1} alignItems="center" flex={1}>
          <Typography variant="h5" color="text.primary" align="center" sx={{ overflowWrap: 'anywhere' }}>
            {leftName}
          </Typography>
          {typeof leftTeamElo === 'number' && Number.isFinite(leftTeamElo) && (
            <Typography variant="body2" color="text.secondary">
              {t('matchInfo.scoreboard.eloAvg', { elo: leftTeamElo })}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={600} color="text.primary" sx={mono}>
                {leftSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.mapsWon')}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={600} color="text.secondary" sx={mono}>
                {leftMapRounds}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.currentMapScore')}
              </Typography>
            </>
          )}
        </Stack>
        <Stack spacing={1} alignItems="center" mx={{ xs: 1, sm: 3 }}>
          <Typography variant="body2" color="text.disabled" sx={mono}>
            {t('matchInfo.scoreboard.vs')}
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
          <Typography variant="h5" color="text.primary" align="center" sx={{ overflowWrap: 'anywhere' }}>
            {rightName || t('matchInfo.scoreboard.tbd')}
          </Typography>
          {typeof rightTeamElo === 'number' && Number.isFinite(rightTeamElo) && (
            <Typography variant="body2" color="text.secondary">
              {t('matchInfo.scoreboard.eloAvg', { elo: rightTeamElo })}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={600} color="text.primary" sx={mono}>
                {rightSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.mapsWon')}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={600} color="text.secondary" sx={mono}>
                {rightMapRounds}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.currentMapScore')}
              </Typography>
            </>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}

