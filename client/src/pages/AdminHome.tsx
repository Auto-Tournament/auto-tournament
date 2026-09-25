import { pageTitle } from '../utils/pageTitle';
import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentList } from '../hooks/useTournamentList';
import { useAdminHomeData } from '../hooks/useAdminHomeData';
import { useModuleSetupItems } from '../hooks/useModuleSetupItems';
import { SetupCard, type SetupItem } from '../components/adminHome/SetupCard';
import { TournamentsList } from '../components/adminHome/TournamentsList';
import { SiteLinksGrid } from '../components/adminHome/SiteLinksGrid';
import { useShellIntegrations, shellModule } from '../hooks/useShellIntegrations';
import { PeopleOverviewCard } from '../components/adminHome/PeopleOverviewCard';
import { PageHead } from '../components/common/ui';
import { paths } from '../paths';

declare const __APP_VERSION__: string | undefined;

/**
 * Admin home ("/"): the whole site, not one tournament (the draft's
 * `admin.html`). The site's name as the H1, a setup notice while something is
 * missing, the tournament first (that's the work an admin comes here to do),
 * then the site's pages, and the fleet and people summaries on the right.
 *
 * The Manage console already surfaces what needs a decision right now, so
 * this page doesn't duplicate that with its own banner: the live
 * tournament's "Manage" button is the way in.
 */
export default function AdminHome() {
  // The game's resource summary (CS2: the server fleet), from the module the
  // tournament runs (3.0 phase E). A game with no resources has no card, and
  // the page is one card shorter rather than showing an empty fleet.
  const { shell, loading: shellLoading } = useShellIntegrations();
  const ServersOverviewCard = shellModule(shell, (i) => i.dashboardWidgets.adminHomeResources)
    ?.dashboardWidgets.adminHomeResources;
  const { t } = useTranslation();
  const { tournaments, loading: tournamentsLoading } = useTournamentList();
  const {
    loading: dataLoading,
    steamConfigured,
    discordConfigured,
    playersCount,
    adminsCount,
    signedInThisWeekCount,
    siteName,
  } = useAdminHomeData();
  // The modules' own rows (CS2: add a server), after the first of core's.
  const { items: moduleSetupItems, loading: moduleSetupLoading } = useModuleSetupItems(
    shellLoading ? null : shell
  );

  useEffect(() => {
    document.title = pageTitle(t('dashboard.title'));
  }, [t]);

  // 3.0 hosts exactly one tournament row (see `useTournamentList`), so
  // "Create tournament" only makes sense while none exists yet; once it
  // does, the row below already offers Continue setup / Manage / View.
  const canCreateTournament = !tournamentsLoading && tournaments.length === 0;

  const setupItems: SetupItem[] = [
    { key: 'steam', done: steamConfigured, labelKey: 'dashboard.setup.steam' },
    ...moduleSetupItems.map((item) => ({ ...item, key: `${item.ns}:${item.key}` })),
    { key: 'discord', done: discordConfigured, optional: true, labelKey: 'dashboard.setup.discord' },
  ];

  const loading = tournamentsLoading || dataLoading || moduleSetupLoading;

  return (
    <Box component="main" data-testid="dashboard-page" sx={{ flexGrow: 1, backgroundColor: 'transparent' }}>
      <Box sx={{ width: '100%', maxWidth: 1700, mx: 'auto', pb: 5 }}>
        <PageHead
          title={loading ? ' ' : siteName}
          titleId="admin-home-title"
          subtitle={t('dashboard.header.version', {
            version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : t('dashboard.header.unknownVersion'),
          })}
          data-testid="admin-home-head"
          actions={
            canCreateTournament ? (
              <Button
                component={RouterLink}
                to={paths.tournament}
                variant="contained"
                data-testid="admin-home-create-tournament"
              >
                {t('dashboard.header.createTournament')}
              </Button>
            ) : undefined
          }
        />

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('dashboard.loading')} />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: { xs: 4, md: 6 } }}>
            <SetupCard items={setupItems} />

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
                gap: 4,
                alignItems: 'start',
              }}
            >
              <Box sx={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <TournamentsList tournaments={tournaments} loading={tournamentsLoading} />
                <SiteLinksGrid />
              </Box>
              <Box component="aside" sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
                {/* The module counts its own resources. */}
                {ServersOverviewCard && <ServersOverviewCard />}
                <PeopleOverviewCard
                  playersCount={playersCount}
                  signedInThisWeekCount={signedInThisWeekCount}
                  adminsCount={adminsCount}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
