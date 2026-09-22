import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface PeopleOverviewCardProps {
  playersCount: number;
  adminsCount: number;
}

/**
 * Right-column "People" summary: players and admins. Both come straight off
 * GET /api/players (count + the isAdmin flag) — no invented "signed in
 * recently" or "pending approval" numbers, since this instance has no data
 * source for either today.
 */
export function PeopleOverviewCard({ playersCount, adminsCount }: PeopleOverviewCardProps) {
  const { t } = useTranslation();

  return (
    <Card variant="outlined" data-testid="admin-home-people-card">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('dashboard.people.title')}
          </Typography>
          <Typography
            component={RouterLink}
            to="/players"
            variant="body2"
            color="text.secondary"
            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            {t('dashboard.people.open')}
          </Typography>
        </Box>
        <Box display="flex" justifyContent="space-between" mb={1}>
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.people.players')}
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {playersCount}
          </Typography>
        </Box>
        <Box display="flex" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.people.admins')}
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {adminsCount}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
