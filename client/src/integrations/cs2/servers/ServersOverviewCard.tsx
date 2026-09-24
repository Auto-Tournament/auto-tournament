import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import { api, links, useModuleTranslation } from '../../../module-sdk';
import {
  SERVER_AVAILABILITY_ENDPOINT,
  type PluginVersionSummary,
  type ServerAvailability,
  type Server,
  type ServerFleetCounts,
  type ServersResponse,
} from '../cs2.types';

/**
 * Online / in-match / free / offline from the allocator's view of the fleet,
 * plus the enabled servers it does not list yet because they never sent an
 * event, so the card counts the same servers as the Servers page.
 */
function countFleet(availability: ServerAvailability, servers: Server[]): ServerFleetCounts {
  const notConfigured = servers.filter((s) => s.enabled && !s.lastSeen).length;
  const counts: ServerFleetCounts = {
    online: 0,
    inMatch: 0,
    free: 0,
    offline: 0,
    notConfigured,
    total: notConfigured,
  };
  for (const server of availability.servers ?? []) {
    counts.total += 1;
    if (!server.online) {
      counts.offline += 1;
      continue;
    }
    counts.online += 1;
    if (server.allocatable) counts.free += 1;
    else counts.inMatch += 1;
  }
  return counts;
}

/** Which plugin versions the enabled servers report, and whether they agree. */
function summarisePluginVersions(servers: ServersResponse['servers']): PluginVersionSummary {
  const versions = Array.from(
    new Set(
      servers.filter((s) => s.enabled && s.pluginVersion).map((s) => s.pluginVersion as string)
    )
  );
  return { versions, commonVersion: versions.length === 1 ? versions[0] : null };
}

/**
 * The card's numbers, asked once when it mounts: the fleet breakdown from the
 * allocator's availability route, the plugin versions from the server list.
 * Either failing leaves its part out, as the admin home always did.
 */
function useFleetSummary(): {
  loaded: boolean;
  fleet: ServerFleetCounts | null;
  pluginVersions: PluginVersionSummary | null;
} {
  const [loaded, setLoaded] = useState(false);
  const [fleet, setFleet] = useState<ServerFleetCounts | null>(null);
  const [pluginVersions, setPluginVersions] = useState<PluginVersionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.get<ServerAvailability>(SERVER_AVAILABILITY_ENDPOINT).catch(() => null),
      api.get<ServersResponse>('/api/servers').catch(() => null),
    ]).then(([availability, list]) => {
      if (cancelled) return;
      const servers = list?.servers ?? [];
      setFleet(availability ? countFleet(availability, servers) : null);
      setPluginVersions(list ? summarisePluginVersions(servers) : null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { loaded, fleet, pluginVersions };
}

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
      <Box sx={{ width: pct(fleet.notConfigured), bgcolor: 'action.disabled' }} />
    </Box>
  );
}

/**
 * Right-column "Servers" summary: online/total, a stacked in-match/free/
 * offline bar, and plugin version agreement — all from the same
 * server-availability + servers endpoints Manage and Servers already use.
 *
 * It asks for them itself (client API 0.2.0): `AdminHomeResourcesProps` is
 * empty, the admin home hands it nothing.
 */
export function ServersOverviewCard() {
  const { t } = useModuleTranslation('cs2');
  const { loaded, fleet, pluginVersions } = useFleetSummary();

  return (
    <Card variant="outlined" data-testid="admin-home-servers-card">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('dashboard.servers.title')}
          </Typography>
          <Typography
            component={RouterLink}
            to={links.servers()}
            variant="body2"
            color="text.secondary"
            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            {t('dashboard.servers.open')}
          </Typography>
        </Box>

        {!loaded ? (
          <Stack spacing={1} data-testid="admin-home-servers-card-loading">
            <Skeleton variant="text" width="40%" height={40} />
            <Skeleton variant="rounded" height={6} />
            <Skeleton variant="text" />
          </Stack>
        ) : !fleet || fleet.total === 0 ? (
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
            {fleet.notConfigured > 0 && (
              <Box display="flex" justifyContent="space-between" data-testid="admin-home-servers-not-configured">
                <Typography variant="body2" color="text.secondary">
                  {t('dashboard.servers.notConfigured')}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {fleet.notConfigured}
                </Typography>
              </Box>
            )}
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
