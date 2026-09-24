import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentList } from '../hooks/useTournamentList';
import { useAdminHomeData } from '../hooks/useAdminHomeData';
import { SetupCard, type SetupItem } from '../components/adminHome/SetupCard';
import { TournamentsList } from '../components/adminHome/TournamentsList';
import { SiteLinksGrid } from '../components/adminHome/SiteLinksGrid';
import { useShellIntegrations, shellModule } from '../hooks/useShellIntegrations';
import { PeopleOverviewCard } from '../components/adminHome/PeopleOverviewCard';

declare const __APP_VERSION__: string | undefined;

/**
 * Admin home ("/"): the whole site, not one tournament. Tournaments first
 * (that's the work an admin comes here to do), then site-wide setup,
 * cross-cutting links, and fleet/people summaries.
 *
 * Replaces the old stats-heavy Dashboard. The Manage console (PR #268)
 * already surfaces what needs a decision right now, so this page doesn't
 * duplicate that with its own banner — the live tournament's "Manage" button
 * in the list below is the way in.
 */
export default function AdminHome() {
  // The game's resource summary (CS2: the server fleet), from the module the
  // tournament runs (3.0 phase E). A game with no resources has no card, and
  // the page is one card shorter rather than showing an empty fleet.
  const { shell } = useShellIntegrations();
  const ServersOverviewCard = shellModule(shell, (i) => i.dashboardWidgets.adminHomeResources)
    ?.dashboardWidgets.adminHomeResources;
  const { t } = useTranslation();
  const { tournaments, loading: tournamentsLoading } = useTournamentList();
  const {
    loading: dataLoading,
    steamConfigured,
    discordConfigured,
    igdbConfigured,
    serversCount,
    playersCount,
    adminsCount,
  } = useAdminHomeData();

  useEffect(() => {
    document.title = t('dashboard.title');
  }, [t]);

  // 3.0 hosts exactly one tournament row (see `useTournamentList`), so
  // "Create tournament" only makes sense while none exists yet; once it
  // does, the row below already offers Continue setup / Manage / View.
  const canCreateTournament = !tournamentsLoading && tournaments.length === 0;

  const setupItems: SetupItem[] = [
    { key: 'steam', done: steamConfigured, labelKey: 'dashboard.setup.steam' },
    {
      key: 'servers',
      done: serversCount > 0,
      labelKey:
        serversCount > 0
          ? serversCount === 1
            ? 'dashboard.setup.serversDone'
            : 'dashboard.setup.serversDonePlural'
          : 'dashboard.setup.serversTodo',
      labelValues: { count: serversCount },
    },
    { key: 'discord', done: discordConfigured, optional: true, labelKey: 'dashboard.setup.discord' },
    { key: 'igdb', done: igdbConfigured, optional: true, labelKey: 'dashboard.setup.igdb' },
  ];

  const loading = tournamentsLoading || dataLoading;

  return (
    <Box component="main" data-testid="dashboard-page" sx={{ flexGrow: 1, backgroundColor: 'transparent' }}>
      <Stack spacing={4} sx={{ width: '100%', maxWidth: 1700, mx: 'auto', pb: 5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'flex-end' }}
          spacing={2}
        >
          <Box>
            <Typography variant="h4" fontWeight={700}>
              {t('dashboard.header.brand')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('dashboard.header.version', {
                version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : t('dashboard.header.unknownVersion'),
              })}
            </Typography>
          </Box>
          {canCreateTournament && (
            <Button
              component={RouterLink}
              to="/tournament"
              variant="contained"
              data-testid="admin-home-create-tournament"
            >
              {t('dashboard.header.createTournament')}
            </Button>
          )}
        </Stack>

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <SetupCard items={setupItems} />

            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Stack spacing={4}>
                  <TournamentsList tournaments={tournaments} loading={tournamentsLoading} />
                  <SiteLinksGrid />
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Stack spacing={2}>
                  {/* The module counts its own resources. */}
                  {ServersOverviewCard && <ServersOverviewCard />}
                  <PeopleOverviewCard playersCount={playersCount} adminsCount={adminsCount} />
                </Stack>
              </Grid>
            </Grid>
          </>
        )}
      </Stack>
    </Box>
  );
}
