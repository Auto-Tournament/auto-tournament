import { Box, Card, CardContent, Typography, Grid, Paper } from '@mui/material';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { useTranslation } from 'react-i18next';
import type { TeamStats, TeamStanding } from '../../types';

interface TeamStatsCardProps {
  stats: TeamStats | null;
  standing: TeamStanding | null;
}

export function TeamStatsCard({ stats, standing }: TeamStatsCardProps) {
  const { t } = useTranslation();

  if (!stats || stats.totalMatches === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <LeaderboardIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('teamStatsCard.title')}
          </Typography>
        </Box>
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={700} color="primary">
                {stats.wins}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('teamStatsCard.wins')}
              </Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={700} color="error">
                {stats.losses}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('teamStatsCard.losses')}
              </Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={700} color="success.main">
                {stats.winRate}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('teamStatsCard.winRate')}
              </Typography>
            </Paper>
          </Grid>
          {standing && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={700}>
                  #{standing.position}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('teamStatsCard.ofTotal', { total: standing.totalTeams })}
                </Typography>
              </Paper>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}

