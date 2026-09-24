import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { ServerFleetCounts } from '../../../hooks/useAdminHomeData';
import type { AdminHomeResourcesProps as ServersOverviewCardProps } from '../../types';
import { paths } from '../../../paths';

/** A thin stacked bar: in-match / free / offline, in that order (matches the Manage server grid's chip colours). */
function FleetBar({ fleet }: { fleet: ServerFleetCounts }) {
  const total = fleet.total || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <Box
      aria-hidden
      sx={{
        height: 6,
        borderRadius: 3,
        bgcolor: 'background.surface2',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <Box sx={{ width: pct(fleet.inMatch), bgcolor: 'info.main' }} />
      <Box sx={{ width: pct(fleet.free), bgcolor: 'success.main' }} />
      <Box sx={{ width: pct(fleet.offline), bgcolor: 'error.main' }} />
    </Box>
  );
}

/**
 * Right-column "Servers" summary: online/total, a stacked in-match/free/
 * offline bar, and plugin version agreement — all from the same
 * server-availability + servers endpoints Manage and Servers already use.
 */
export function ServersOverviewCard({ fleet, pluginVersions }: ServersOverviewCardProps) {
  const { t } = useModuleTranslation('cs2');

  return (
    <Card variant="outlined" data-testid="admin-home-servers-card">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('dashboard.servers.title')}
          </Typography>
          <Typography
            component={RouterLink}
            to={paths.servers}
            variant="body2"
            color="text.secondary"
            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            {t('dashboard.servers.open')}
          </Typography>
        </Box>

        {!fleet || fleet.total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.servers.none')}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <Box display="flex" alignItems="baseline" gap={1}>
              <Typography variant="h4" fontWeight={700}>
                {fleet.online}/{fleet.total}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('dashboard.servers.online')}
              </Typography>
            </Box>
            <FleetBar fleet={fleet} />
            <Box display="flex" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                {t('dashboard.servers.inMatch')}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {fleet.inMatch}
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                {t('dashboard.servers.free')}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {fleet.free}
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between">
              <Typography variant="body2" color="error.main">
                {t('dashboard.servers.offline')}
              </Typography>
              <Typography variant="body2" fontWeight={600} color="error.main">
                {fleet.offline}
              </Typography>
            </Box>
            {pluginVersions && pluginVersions.versions.length > 0 && (
              <Box display="flex" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  {t('dashboard.servers.plugin')}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {pluginVersions.commonVersion
                    ? t('dashboard.servers.pluginSame', { version: pluginVersions.commonVersion })
                    : t('dashboard.servers.pluginMixed', { count: pluginVersions.versions.length })}
                </Typography>
              </Box>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
