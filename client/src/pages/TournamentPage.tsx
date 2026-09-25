import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { TournamentPageHeader } from '../components/tournament/overview/TournamentPageHeader';
import type { TournamentPageContext } from '../components/tournament/page/tournamentPageContext';
import { usePublicTournamentOverview } from '../hooks/usePublicTournamentOverview';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { onSocketReconnect } from '../utils/socketResync';
import { TOURNAMENT_TABS, tournamentTabPath, type TournamentTab } from '../paths';
import { pageTitle } from '../utils/pageTitle';

/** The tab a path is on: `/tournament/1/bracket` → 'bracket', `/tournament/1` → 'overview'. */
function tabOf(pathname: string): TournamentTab {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return (TOURNAMENT_TABS as readonly string[]).includes(last)
    ? (last as TournamentTab)
    : 'overview';
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
 * The public tournament page: one header (game, status, H1, organizer ·
 * dates · location) and the tabs Overview, Bracket, Matches, Teams and
 * Standings, plus Manage for admins. Each tab is a nested route rendered in
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
  const tab = tabOf(pathname);
  const socket = useSocket();

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
    document.title = pageTitle(
      tab === 'overview'
        ? tournament.name
        : `${t(`overviewPage.tabs.${tab}`)} · ${tournament.name}`
    );
  }, [tournament, tab, t]);

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
    viewerTeam: overview.viewerTeam,
    viewerHasSteamIdentity: overview.viewerHasSteamIdentity,
  };

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="tournament-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <TournamentPageHeader
          tournament={tournament}
          tab={tab}
          showManage={isAuthenticated && !impersonation}
        />
        <Box component="main" aria-labelledby="tournament-title" sx={{ mt: 3 }}>
          <Outlet context={context} />
        </Box>
      </Container>
    </Box>
  );
}

/** `/tournament/:id/leaderboard`, the tab's old address: Standings now. */
export function LegacyLeaderboardRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={tournamentTabPath(id ?? '', 'standings')} replace />;
}
