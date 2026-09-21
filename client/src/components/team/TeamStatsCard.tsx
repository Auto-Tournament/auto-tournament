import { Box, Card, CardContent, Typography } from '@mui/material';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { useTranslation } from 'react-i18next';
import type { TeamStats, TeamStanding } from '../../types';
import { StatTile } from '../common/ui';
import { tokens } from '../../theme/tokens';

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
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
            gap: 1,
          }}
        >
          <StatTile size="lg" value={stats.wins} label={t('teamStatsCard.wins')} accent={tokens.color.live} />
          <StatTile size="lg" value={stats.losses} label={t('teamStatsCard.losses')} accent={tokens.color.ban} />
          <StatTile size="lg" value={`${stats.winRate}%`} label={t('teamStatsCard.winRate')} />
          {standing && (
            <StatTile
              size="lg"
              value={`#${standing.position}`}
              label={t('teamStatsCard.ofTotal', { total: standing.totalTeams })}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

