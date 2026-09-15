import { Stack, Typography, Chip, Paper, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

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
              {t('matchInfo.scoreboard.eloAvg', { elo: leftTeamElo })}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="primary.main">
                {leftSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.mapsWon')}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={700} color="primary.main">
                {leftMapRounds}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.currentMapScore')}
              </Typography>
            </>
          )}
        </Stack>
        <Stack spacing={1} alignItems="center" mx={3}>
          <Typography variant="h3" color="text.secondary" fontWeight={700}>
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
          <Typography variant="h4" fontWeight={700} color="error.main" align="center">
            {rightName || t('matchInfo.scoreboard.tbd')}
          </Typography>
          {typeof rightTeamElo === 'number' && Number.isFinite(rightTeamElo) && (
            <Typography variant="body2" color="text.secondary">
              {t('matchInfo.scoreboard.eloAvg', { elo: rightTeamElo })}
            </Typography>
          )}
          {!hideSeriesWins && (
            <>
              <Typography variant="h1" fontWeight={900} color="error.main">
                {rightSeriesWins}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('matchInfo.scoreboard.mapsWon')}
              </Typography>
            </>
          )}
          {!hideMapRounds && (
            <>
              <Typography variant="h4" fontWeight={700} color="error.main">
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

