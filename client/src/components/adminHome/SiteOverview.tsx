/**
 * The site at a glance, at the top of Manage's home (it was the admin home at
 * "/" before 2026-10): the site's name and version, a setup checklist while
 * something is missing, the tournaments, and the module's resources, people
 * and license on the side. The rail beside it is the way to every admin page.
 */

import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentList } from '../../hooks/useTournamentList';
import { useAdminHomeData } from '../../hooks/useAdminHomeData';
import { useModuleSetupItems } from '../../hooks/useModuleSetupItems';
import { SetupCard, type SetupItem } from './SetupCard';
import { TournamentsList } from './TournamentsList';
import { useShellIntegrations, shellModule } from '../../hooks/useShellIntegrations';
import { PeopleOverviewCard } from './PeopleOverviewCard';
import { LicenseOverviewCard } from './LicenseOverviewCard';
import { EventLicensePrompt } from './EventLicensePrompt';
import { paths } from '../../paths';
import { SIGN_IN_SETTINGS_PATH } from '../../utils/signInSetup';
import { tokens, fontDisplay } from '../../theme/tokens';

declare const __APP_VERSION__: string | undefined;

export function SiteOverview() {
  // The game's resource summary (CS2: the server fleet), from the module the
  // tournament runs. A game with no resources has no card.
  const { shell, loading: shellLoading } = useShellIntegrations();
  const ServersOverviewCard = shellModule(shell, (i) => i.dashboardWidgets.adminHomeResources)
    ?.dashboardWidgets.adminHomeResources;
  const { t } = useTranslation();
  const { tournaments, loading: tournamentsLoading } = useTournamentList();
  const {
    loading: dataLoading,
    signInConfigured,
    playersCount,
    adminsCount,
    signedInThisWeekCount,
    siteName,
  } = useAdminHomeData();
  // The modules' own rows (CS2: add a server), after the first of core's.
  const { items: moduleSetupItems, loading: moduleSetupLoading } = useModuleSetupItems(
    shellLoading ? null : shell
  );

  const canCreateTournament = !tournamentsLoading && tournaments.length === 0;
  const setupItems: SetupItem[] = [
    {
      key: 'signin',
      done: signInConfigured,
      labelKey: 'dashboard.setup.signIn',
      to: SIGN_IN_SETTINGS_PATH,
    },
    ...moduleSetupItems.map((item) => ({ ...item, key: `${item.ns}:${item.key}` })),
  ];
  const loading = tournamentsLoading || dataLoading || moduleSetupLoading;

  return (
    <Box component="section" data-testid="dashboard-page" sx={{ display: 'grid', gap: 4, mb: 6 }}>
      <Box
        sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}
        data-testid="admin-home-head"
      >
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <Typography
            component="h2"
            id="admin-home-title"
            sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.5rem' }}
          >
            {loading ? ' ' : siteName}
          </Typography>
          <Typography sx={{ color: tokens.color.ink2, fontSize: '0.875rem' }}>
            {t('dashboard.header.version', {
              version:
                typeof __APP_VERSION__ !== 'undefined'
                  ? __APP_VERSION__
                  : t('dashboard.header.unknownVersion'),
            })}
          </Typography>
        </Box>
        {canCreateTournament && (
          <Button
            component={RouterLink}
            to={paths.tournament}
            variant="contained"
            data-testid="admin-home-create-tournament"
          >
            {t('dashboard.header.createTournament')}
          </Button>
        )}
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress aria-label={t('dashboard.loading')} />
        </Box>
      ) : (
        <>
          {/* Event licenses only: a quiet, dismissible question, never blocking. */}
          <EventLicensePrompt />
          <SetupCard items={setupItems} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: 'minmax(0, 1.6fr) minmax(0, 1fr)',
              },
              gap: 4,
              alignItems: 'start',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <TournamentsList tournaments={tournaments} loading={tournamentsLoading} />
            </Box>
            <Box component="aside" sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
              {/* The module counts its own resources. */}
              {ServersOverviewCard && <ServersOverviewCard />}
              <PeopleOverviewCard
                playersCount={playersCount}
                signedInThisWeekCount={signedInThisWeekCount}
                adminsCount={adminsCount}
              />
              <LicenseOverviewCard />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
