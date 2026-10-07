import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { TournamentPageHeader } from '../components/tournament/overview/TournamentPageHeader';
import { LicensedBadge } from '../components/tournament/page/LicensedBadge';
import type { TournamentPageContext } from '../components/tournament/page/tournamentPageContext';
import { usePublicTournamentOverview } from '../hooks/usePublicTournamentOverview';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { useInstalledIntegrations } from '../integrations/registry';
import { onSocketReconnect } from '../utils/socketResync';
import {
  TOURNAMENT_TABS,
  tournamentTabPath,
  visibleTournamentTabs,
} from '../paths';
import { pageTitle } from '../utils/pageTitle';

/**
 * The tab a path is on: `/tournament/1/bracket` → 'bracket', `/tournament/1`
 * → 'overview', and a module tab's path (`highlights`) as it is.
 */
function tabOf(pathname: string, modulePaths: readonly string[]): string {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return (TOURNAMENT_TABS as readonly string[]).includes(last) || modulePaths.includes(last)
    ? last
    : 'overview';
}

/** Modules' tournament tabs (`tournamentTab`), by module. */
function useModuleTournamentTabs() {
  return useInstalledIntegrations().flatMap((integration) =>
    integration.tournamentTab ? [{ id: integration.id, ...integration.tournamentTab }] : []
  );
}

/** Page chrome while there is no tournament to show. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <Box minHeight="100vh" bgcolor="transparent">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        {children}
      </Container>
    </Box>
  );
}

/**
 * The public tournament page: the banner header (game, format, H1,
 * description) and the tabs, plus Manage for admins. Each tab is a nested route rendered in
 * the outlet, with the tournament loaded here once (`useTournamentPage`).
 *
 * 3.0 hosts exactly one tournament, so there is no list around it: the id in
 * the URL is that tournament's.
 */
export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { isAuthenticated, impersonation } = useAuth();
  const overview = usePublicTournamentOverview(id);
  const { tournament, reload } = overview;
  const moduleTabs = useModuleTournamentTabs();
  const tab = tabOf(
    pathname,
    moduleTabs.map((m) => m.path)
  );
  const socket = useSocket();
  // Which module tabs have anything for this tournament (each tab's probe says).
  const [tabAvailable, setTabAvailable] = useState<Record<string, boolean>>({});
  const reportTab = useCallback(
    (id: string, available: boolean) =>
      setTabAvailable((prev) => (prev[id] === available ? prev : { ...prev, [id]: available })),
    []
  );
  const shownModuleTabs = moduleTabs.filter((m) => tabAvailable[m.id] || m.path === tab);

  // Status, teams and the live count move while the tournament runs.
  useEffect(() => {
    const refresh = () => void reload();
    socket.on('tournament:update', refresh);
    socket.on('bracket:update', refresh);
    const offReconnect = onSocketReconnect(socket, refresh);
    return () => {
      offReconnect();
      socket.off('tournament:update', refresh);
      socket.off('bracket:update', refresh);
    };
  }, [socket, reload]);

  useEffect(() => {
    if (!tournament) {
      document.title = pageTitle(t('overviewPage.tabs.overview'));
      return;
    }
    const moduleTab = moduleTabs.find((m) => m.path === tab);
    const label = moduleTab ? t(moduleTab.labelKey, { ns: moduleTab.id }) : t(`overviewPage.tabs.${tab}`);
    document.title = pageTitle(tab === 'overview' ? tournament.name : `${label} · ${tournament.name}`);
  }, [tournament, tab, t, moduleTabs]);

  if (overview.loading) {
    return (
      <Shell>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress aria-label={t('overviewPage.loading')} />
        </Box>
      </Shell>
    );
  }

  if (overview.error) {
    return (
      <Shell>
        <Alert severity="error">{t('overviewPage.loadError')}</Alert>
      </Shell>
    );
  }

  if (!tournament) {
    return (
      <Shell>
        <Typography variant="h1" sx={{ mb: 1 }}>
          {t('overviewPage.notFoundTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('overviewPage.notFoundDescription')}
        </Typography>
      </Shell>
    );
  }

  const context: TournamentPageContext = {
    tournament,
    liveMatchCount: overview.liveMatchCount,
    teams: overview.teams,
    players: overview.players,
    viewerTeam: overview.viewerTeam,
    viewerHasSteamIdentity: overview.viewerHasSteamIdentity,
  };

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="tournament-page">
      <TopNavBar />
      <TournamentPageHeader
        tournament={tournament}
        tab={tab}
        tabs={visibleTournamentTabs(tournament, { hasTeam: Boolean(overview.viewerTeam) })}
        moduleTabs={shownModuleTabs.map((m) => ({ path: m.path, label: t(m.labelKey, { ns: m.id }) }))}
        showManage={isAuthenticated && !impersonation}
      />
      {/* Each module tab's probe: whether it has anything for this tournament. */}
      {moduleTabs.map(({ id, Component }) => (
        <Component
          key={id}
          probe
          tournamentId={tournament.id}
          tournamentStatus={tournament.status}
          onAvailability={(available) => reportTab(id, available)}
        />
      ))}
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
        <Box component="main" aria-labelledby="tournament-title">
          <Outlet context={context} />
        </Box>
        {/* Off unless an admin turns it on, and only for a valid license key. */}
        <LicensedBadge />
      </Container>
    </Box>
  );
}

/** `/tournament/:id/<path>`: a module's tab (CS2: Highlights), or back to Overview. */
export function TournamentModuleTab() {
  const { moduleTab } = useParams<{ moduleTab: string }>();
  const { tournament } = useOutletContext<TournamentPageContext>();
  const tab = useModuleTournamentTabs().find((m) => m.path === moduleTab);
  if (!tab) return <Navigate to={tournamentTabPath(tournament.id)} replace />;
  return <tab.Component tournamentId={tournament.id} tournamentStatus={tournament.status} />;
}

/** `/tournament/:id/leaderboard`, the tab's old address: Standings now. */
export function LegacyLeaderboardRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={tournamentTabPath(id ?? '', 'standings')} replace />;
}
