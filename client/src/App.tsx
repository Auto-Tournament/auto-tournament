import React from 'react';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PageHeaderProvider } from './contexts/PageHeaderContext';
import { SnackbarProvider, useSnackbar } from './contexts/SnackbarContext';
import { AtIcon } from './components/common/AtIcon';
import Login from './pages/Login';
import Setup from './pages/Setup';
import AdminLogin from './pages/AdminLogin';
import FirstSignIn from './pages/FirstSignIn';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import EmailLink from './pages/EmailLink';
import { BlockedNotice } from './components/auth/BlockedNotice';
import Reports from './pages/Reports';
import Manage from './pages/Manage';
import Teams from './pages/Teams';
import Players from './pages/Players';
import Tournament from './pages/Tournament';
import Tournaments from './pages/Tournaments';
import { ScopedTournamentRedirect, TournamentScope } from './components/manage/TournamentScope';
import Bracket from './pages/Bracket';
import ManageMatch from './pages/ManageMatch';
import Matches from './pages/Matches';
import Disputes from './pages/Disputes';
import PlayedMatches from './pages/PlayedMatches';
import ImportMatch from './pages/ImportMatch';
import HighlightsAdmin from './pages/HighlightsAdmin';
import Modules from './pages/Modules';
import AdminTools from './pages/AdminTools';
import Settings from './pages/Settings';
import License from './pages/License';
import Development from './pages/Development';
import { useIsDevelopment } from './hooks/useIsDevelopment';
import TeamProfile from './pages/TeamProfile';
import PlayerProfile from './pages/PlayerProfile';
import MatchPage from './pages/MatchPage';
import TournamentLeaderboard from './pages/TournamentLeaderboard';
import TournamentOverview from './pages/TournamentOverview';
import TournamentPage, {
  LegacyLeaderboardRedirect,
  TournamentModuleTab,
} from './pages/TournamentPage';
import TournamentBracketTab from './pages/TournamentBracketTab';
import TournamentMatchesTab from './pages/TournamentMatchesTab';
import TournamentTeamsTab from './pages/TournamentTeamsTab';
import TournamentRulesTab from './pages/TournamentRulesTab';
import TournamentMatchRedirect from './pages/TournamentMatchRedirect';
import TournamentSignupTab from './pages/TournamentSignupTab';
import { TopNavBar } from './components/layout/TopNavBar';
import { ModuleGlobalOverlays } from './components/layout/ModuleGlobalOverlays';
import Home from './pages/Home';
import Browse from './pages/Browse';
import PlayersDirectory from './pages/PlayersDirectory';
import Leaderboard from './pages/Leaderboard';
import Friends from './pages/Friends';
import Notifications from './pages/Notifications';
import TeamsDirectory from './pages/TeamsDirectory';
import TeamManage from './pages/TeamManage';
import TournamentPrizes from './pages/TournamentPrizes';
import TournamentSchedule from './pages/TournamentSchedule';
import TeamJoin from './pages/TeamJoin';
import Compatibility from './pages/Compatibility';
import Play from './pages/Play';
import PlayLobby from './pages/PlayLobby';
import { MatchmakingOverlay } from './components/matchmaking/MatchmakingOverlay';
import { ChatDock } from './components/chat/ChatDock';
import { PartyInviteToast } from './components/social/PartyInviteToast';
import { PresenceReporter } from './components/social/PresenceReporter';
import AccountConnections from './pages/AccountConnections';
import ConnectSteam from './pages/ConnectSteam';
import Templates from './pages/Templates';
import ELOTemplates from './pages/ELOTemplates';
import Layout from './components/layout/Layout';
import { SiteFooter } from './components/layout/SiteFooter';
import { AdminTournamentProvider, useAdminTournament } from './contexts/AdminTournamentContext';

/** The admin shell, remounted when the admin picks another tournament so every page reloads for it. */
function ScopedLayout() {
  const { version } = useAdminTournament();
  return <Layout key={version} />;
}
import { AdminCallsHost } from './components/admin/AdminCallsHost';
import NotFound from './pages/NotFound';
import MatchNow from './pages/MatchNow';
import { theme } from './theme';
import { GamesOnboardingRedirect } from './components/games/GamesOnboardingRedirect';
import WelcomeGames from './pages/WelcomeGames';
import LicenseConsent from './pages/LicenseConsent';
import { LicenseConsentGate } from './components/license/LicenseConsentGate';
import { AddressMismatchBanner } from './components/admin/AddressMismatchBanner';
import { AdminConsentRedirect } from './components/license/AdminConsentRedirect';
import { LicenseGate } from './components/license/LicenseGate';
import { ImpersonationBanner } from './components/common/ImpersonationBanner';
import { listRouteIntegrations } from './integrations/registry';
import { useModuleState } from './module-loader/useModuleState';
import { modulesMayArrive } from './module-loader/moduleState';
import { ModulePendingRoute } from './components/common/ModuleNotInstalledNotice';
import { MatchDetailsHost } from './components/modals/MatchDetailsHost';
import {
  adminRoute,
  LEGACY_ADMIN_PATHS,
  matchPagePath,
  MOVED_PUBLIC_PATHS,
  paths,
  playerProfilePath,
} from './paths';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * When true (default), only authenticated admins can access the route.
   * Non-admin players are redirected away (to their player page or login).
   *
   * When false, any authenticated identity (admin or player) may access the
   * route; anonymous visitors are still redirected to login.
   */
  adminOnly?: boolean;
}

function ProtectedRoute({ children, adminOnly = true }: ProtectedRouteProps) {
  const {
    isAuthenticated,
    isLoading,
    playerSteamId,
    needsSteamLink,
    adminDenialMessage,
    impersonation,
  } = useAuth();
  const location = useLocation();
  const { showWarning } = useSnackbar();

  // Being bounced to your own player page when you expected the admin panel is
  // indistinguishable from the app being broken, and it used to happen in
  // silence — which is why "it redirects me even though I am an admin" was
  // never diagnosable. Say what the server said.
  const willRedirectFromAdminRoute =
    !isLoading && adminOnly && !isAuthenticated && !!playerSteamId && !!adminDenialMessage;

  React.useEffect(() => {
    if (willRedirectFromAdminRoute && adminDenialMessage) {
      showWarning(adminDenialMessage);
    }
    // Keyed on the message so a changed reason is shown again, but the same
    // reason does not re-fire on every render.
  }, [willRedirectFromAdminRoute, adminDenialMessage, showWarning]);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
        }}
      >
        <Box textAlign="center">
          <Box
            sx={{
              width: 80,
              height: 80,
              mb: 2,
              display: 'inline-flex',
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.5 },
              },
            }}
          >
            <AtIcon size={80} title="Logo" />
          </Box>
        </Box>
      </Box>
    );
  }

  if (adminOnly) {
    // Admin-only routes (default): require an authenticated admin session with a linked Steam ID.
    // Impersonating: the UI behaves as that player, so admin pages send you to
    // their profile. The banner (rendered app-wide) keeps "stop" available.
    // The API still honours the real admin session on purpose, so stopping
    // and anything done explicitly from the banner keep working.
    if (impersonation) {
      return <Navigate to={playerProfilePath(impersonation.steamId)} replace />;
    }

    if (isAuthenticated) {
      // Admin session active – require Steam to be linked before allowing access
      // to the main dashboard and other protected admin routes.
      if (needsSteamLink && location.pathname !== paths.connectSteam) {
        return <Navigate to={paths.connectSteam} replace />;
      }

      return <>{children}</>;
    }

    // If the user has a Steam identity but no admin session, send them to
    // their player page (registered or not – we show "not registered" there).
    if (playerSteamId) {
      return <Navigate to={playerProfilePath(playerSteamId)} replace />;
    }

    // No admin session and no player Steam ID – go to login.
    return <Navigate to={paths.login} state={{ from: location }} replace />;
  }

  // Non-admin-only "public" routes:
  //
  // These pages (e.g. /player, /team/:teamId, /tournament/:id/leaderboard) are
  // intentionally viewable by anyone – including:
  // - anonymous visitors
  // - signed-in players
  // - admins (even before linking a Steam account)
  //
  // The underlying components still *optionally* use auth context when present
  // (e.g. to show "this is you" badges or quick links), but access itself
  // should never be blocked or redirected here.
  return <>{children}</>;
}

/**
 * What "/" shows.
 *
 * - A real admin session (not impersonating): Home when the admin is also a
 *   player, else `/manage`. Every other path under "/" is the Manage
 *   dashboard (`Layout`, with its nested `/manage/*` routes).
 * - A signed-in player (including an admin impersonating one — impersonation
 *   is there to preview the player experience, and this is the player
 *   experience): `Home`.
 * - Signed out: `/login`, same as before.
 *
 * Only "/" changes here. `/player/:steamId` stays reachable (nav avatar menu,
 * direct links) for anyone who wants it; players are just no longer bounced
 * there automatically.
 */
function RootRoute() {
  const { isAuthenticated, isLoading, playerSteamId, needsSteamLink, impersonation } = useAuth();
  const location = useLocation();
  // A page a code module brings (CS2's /watch/…, /highlights) is not routed
  // until the module has arrived; until then its address lands here. Wait for
  // the modules instead of sending the visitor to login or their profile.
  const modulesArriving = modulesMayArrive(useModuleState());

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
        }}
      >
        <AtIcon size={80} title="Logo" />
      </Box>
    );
  }

  if (isAuthenticated && !impersonation) {
    if (needsSteamLink && location.pathname !== paths.connectSteam) {
      return <Navigate to={paths.connectSteam} replace />;
    }
    // "/" is Home for everyone (2026-10): an admin who plays gets the
    // player Home with Manage in the top bar; a username-only admin has no
    // player Home, so Manage is theirs.
    if (location.pathname === paths.root) {
      return playerSteamId ? <Home /> : <Navigate to={paths.manage} replace />;
    }
    // The admin shell opens once the license terms are accepted.
    return (
      <LicenseConsentGate>
        <AdminTournamentProvider>
          <ScopedLayout />
        </AdminTournamentProvider>
      </LicenseConsentGate>
    );
  }

  if (location.pathname !== paths.root && modulesArriving) {
    return <ModulePendingRoute fallback={<NotFound />} />;
  }

  if (playerSteamId) {
    // Home is only "/". Any other path under this route is an admin page
    // (/admin, /teams, …): send the player to their own page, as before Home.
    if (location.pathname !== paths.root) {
      return <Navigate to={playerProfilePath(playerSteamId)} replace />;
    }
    return <Home />;
  }

  return <Navigate to={paths.login} state={{ from: location }} replace />;
}

/**
 * Pages about the viewer's own account (/me/*): any signed-in player, admin
 * or not. Anonymous visitors go to login and come back afterwards.
 */
function RequireSignedIn({ children }: { children: React.ReactNode }) {
  const { playerSteamId, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return null;
  if (!playerSteamId) {
    return <Navigate to={paths.login} state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading, playerSteamId } = useAuth();
  const isDevelopment = useIsDevelopment();
  // Re-render when a code module arrives, so its routes are mounted.
  useModuleState();

  if (isLoading) {
    return null; // Loading state is handled by ProtectedRoute
  }

  // Pages the game integrations own (CS2: Servers, Maps).
  //
  // Every installed module's, not just the one the tournament runs: the
  // *links* to these pages follow the game (see `useShellIntegrations`), but
  // the pages themselves stay mounted, so a bookmark, a link in a Discord
  // message or a half-finished setup opens the page instead of a 404.
  const integrationRoutes = listRouteIntegrations().flatMap((integration) => integration.routes);

  return (
    <Routes>
      <Route
        path={paths.login}
        element={
          isAuthenticated ? (
            // Admins leaving login should land on the dashboard
            <Navigate to={paths.root} replace />
          ) : playerSteamId ? (
            // Signed-in but not admin → their player page (shows "not registered" if needed)
            <Navigate to={playerProfilePath(playerSteamId)} replace />
          ) : (
            <Login />
          )
        }
      />

      {/* Local admin sign-in; an admin already signed in goes to the dashboard. */}
      <Route
        path={paths.adminLogin}
        element={isAuthenticated ? <Navigate to={paths.root} replace /> : <AdminLogin />}
      />

      {/* First sign-in of an account an admin made, password recovery by
          email, and the links emails carry. Reachable signed in or not: each
          page asks the API what applies. */}
      <Route path={paths.firstSignIn} element={<FirstSignIn />} />
      <Route path={paths.forgotPassword} element={<ForgotPassword />} />
      <Route path={paths.resetPassword} element={<ResetPassword />} />
      <Route path={paths.emailVerify} element={<EmailLink kind="verify" />} />
      <Route path={paths.emailUnsubscribe} element={<EmailLink kind="unsubscribe" />} />

      {/* First-admin setup / reset-admin recovery. Always reachable: the API
          says whether it is open. */}
      <Route path={paths.setup} element={<Setup />} />

      {/* Linking Steam to an admin who signed in with another provider. Steam
          is the platform's sign-in, so this page is core's for every game. */}
      <Route
        path={paths.connectSteam}
        element={
          <ProtectedRoute>
            <ConnectSteam />
          </ProtectedRoute>
        }
      />

      {/* Accepting the license terms: required once before the admin UI
          (LicenseConsentGate sends admins here). Admin only; players and
          public pages never see it. */}
      <Route
        path={paths.licenseConsent}
        element={
          <ProtectedRoute>
            <LicenseConsent />
          </ProtectedRoute>
        }
      />

      {/* Admin-only pages outside the shell, owned by a game integration */}
      {integrationRoutes
        .filter((route) => route.scope === 'admin-standalone')
        .map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <ProtectedRoute>
                <LicenseConsentGate>{route.element}</LicenseConsentGate>
              </ProtectedRoute>
            }
          />
        ))}

      {/* Viewer & player-facing pages – require a signed-in identity (admin or player) */}
      {/* A team's page. Its match is played in the match room (`/match/:slug`), which it links to. */}
      <Route
        path={paths.teamProfile}
        element={
          <ProtectedRoute adminOnly={false}>
            <TeamProfile />
          </ProtectedRoute>
        }
      />
      {/* The public tournament page: one header, a tab per nested route. */}
      <Route
        path={paths.tournamentOverview}
        element={
          <ProtectedRoute adminOnly={false}>
            <TournamentPage />
          </ProtectedRoute>
        }
      >
        <Route index element={<TournamentOverview />} />
        <Route path="bracket" element={<TournamentBracketTab />} />
        <Route path="matches" element={<TournamentMatchesTab />} />
        <Route path="teams" element={<TournamentTeamsTab />} />
        <Route path="standings" element={<TournamentLeaderboard />} />
        <Route path="rules" element={<TournamentRulesTab />} />
        {/* The old "Your match" tab: the player's match room now. */}
        <Route path="match" element={<TournamentMatchRedirect />} />
        <Route path="signup" element={<TournamentSignupTab />} />
        {/* A module's own tab (CS2: highlights). */}
        <Route path=":moduleTab" element={<TournamentModuleTab />} />
      </Route>
      {/* Standings' old address, still in bookmarks and older links. */}
      <Route path={paths.tournamentLeaderboard} element={<LegacyLeaderboardRedirect />} />
      {/* The old Find player page: the Players directory finds anyone now. */}
      <Route path={paths.findPlayer} element={<Navigate to={paths.communityPlayers} replace />} />
      {/* Public pages that moved (2026-10): their old addresses redirect, query kept. */}
      {MOVED_PUBLIC_PATHS.map(({ from, to }) => (
        <Route key={from} path={from} element={<MovedRedirect to={to} />} />
      ))}
      {/* Old shared match links (`/matches/<slug>`), for anyone: the match page. */}
      <Route path="/matches/:slug" element={<MatchSlugRedirect />} />
      <Route
        path={paths.match}
        element={
          <ProtectedRoute adminOnly={false}>
            <Box minHeight="100vh" bgcolor="transparent">
              <TopNavBar />
              <MatchPage />
            </Box>
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.playerProfile}
        element={
          <ProtectedRoute adminOnly={false}>
            <PlayerProfile />
          </ProtectedRoute>
        }
      />
      {/* Pages for signed-in players, owned by a game integration (CS2: the
          skin inventory), under the site's top bar. */}
      {integrationRoutes
        .filter((route) => route.scope === 'site')
        .map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <ProtectedRoute adminOnly={false}>
                <Box minHeight="100vh" bgcolor="transparent">
                  <TopNavBar />
                  {route.element}
                </Box>
              </ProtectedRoute>
            }
          />
        ))}
      <Route
        path={paths.tournamentList}
        element={
          <ProtectedRoute adminOnly={false}>
            <Browse />
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.friends}
        element={
          <ProtectedRoute adminOnly={false}>
            <Friends />
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.notifications}
        element={
          <ProtectedRoute adminOnly={false}>
            <Notifications />
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.leaderboards}
        element={
          <ProtectedRoute adminOnly={false}>
            <Leaderboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.communityPlayers}
        element={
          <ProtectedRoute adminOnly={false}>
            <PlayersDirectory />
          </ProtectedRoute>
        }
      />
      <Route
        path={paths.teamManage}
        element={
          <ProtectedRoute adminOnly={false}>
            <TeamManage />
          </ProtectedRoute>
        }
      />
      <Route path={paths.teamJoin} element={<TeamJoin />} />
      <Route
        path={paths.communityTeams}
        element={
          <ProtectedRoute adminOnly={false}>
            <TeamsDirectory />
          </ProtectedRoute>
        }
      />

      {/* Ready Up compatibility: public, anonymous visitors included, and
          outside the admin shell so a signed-in admin sees the same page. */}
      <Route path={paths.compatibility} element={<Compatibility />} />

      {/* The signed-in player's own account */}
      <Route path={paths.me} element={<Navigate to={paths.meConnections} replace />} />
      <Route
        path={paths.meConnections}
        element={
          <RequireSignedIn>
            <AccountConnections />
          </RequireSignedIn>
        }
      />

      {/* "My match": wherever the signed-in player's match lives. */}
      <Route
        path={paths.matchNow}
        element={
          <RequireSignedIn>
            <MatchNow />
          </RequireSignedIn>
        }
      />

      {/* Matchmaking: find a match, the match room. */}
      <Route
        path={paths.play}
        element={
          <RequireSignedIn>
            <Play />
          </RequireSignedIn>
        }
      />
      {/* Public when an admin allows it; the API decides. */}
      <Route
        path={paths.playLobby}
        element={
          <RequireSignedIn>
            <PlayLobby />
          </RequireSignedIn>
        }
      />

      {/* "What do you play?" onboarding: first-visit redirect target, and
          "Edit games" (?edit=1) entry points navigate here too. */}
      <Route
        path={paths.welcomeGames}
        element={
          <RequireSignedIn>
            <WelcomeGames />
          </RequireSignedIn>
        }
      />

      <Route path={paths.root} element={<RootRoute />}>
        <Route path={adminRoute(paths.manage)} element={<Manage />} />
        <Route path={adminRoute(paths.teams)} element={<Teams />} />
        <Route path={adminRoute(paths.players)} element={<Players />} />
        <Route path={adminRoute(paths.reports)} element={<Reports />} />
        <Route path={adminRoute(paths.tournaments)} element={<Tournaments />} />
        <Route path={adminRoute('/manage/match/:slug')} element={<ManageMatch />} />
        {/* One tournament: its id in the address, its pages as tabs. */}
        <Route path={adminRoute(paths.manageTournament)} element={<TournamentScope />}>
          <Route index element={<Navigate to="matches" replace />} />
          <Route path="matches" element={<Matches />} />
          <Route path="matches/:slug" element={<ManageMatch />} />
          <Route path="bracket" element={<Bracket />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="setup" element={<Tournament />} />
          <Route path="prizes" element={<TournamentPrizes />} />
          <Route path="schedule" element={<TournamentSchedule />} />
        </Route>
        {/* Their old addresses: the tournament Manage last had open. */}
        <Route
          path={adminRoute(paths.tournament)}
          element={<ScopedTournamentRedirect tab="setup" />}
        />
        <Route
          path={adminRoute(paths.bracket)}
          element={<ScopedTournamentRedirect tab="bracket" />}
        />
        <Route
          path={adminRoute(paths.matches)}
          element={<ScopedTournamentRedirect tab="matches" />}
        />
        <Route path={`${adminRoute(paths.matches)}/:slug`} element={<MatchSlugRedirect />} />
        {/* Mounted for every instance, not only one whose game can have a
            dispute: the page itself says "nothing to settle here" when the
            tournament's module fills no queue, and a bookmarked URL is better
            answered that way than with a 404. */}
        <Route
          path={adminRoute(paths.disputes)}
          element={<ScopedTournamentRedirect tab="disputes" />}
        />
        <Route path={adminRoute(paths.playedMatches)} element={<PlayedMatches />} />
        <Route path={adminRoute(paths.importMatch)} element={<ImportMatch />} />
        <Route path={adminRoute(paths.highlights)} element={<HighlightsAdmin />} />
        <Route path={adminRoute(paths.modules)} element={<Modules />} />
        <Route path={adminRoute(paths.admin)} element={<AdminTools />} />
        <Route path={adminRoute(paths.settings)} element={<Settings />} />
        <Route path={adminRoute(paths.license)} element={<License />} />
        {integrationRoutes
          .filter((route) => route.scope === 'admin')
          .map((route) => (
            // A module names its page by URL (`links.servers()`); nested in
            // the shell, the route is that URL without its leading slash.
            <Route key={route.path} path={adminRoute(route.path)} element={route.element} />
          ))}
        <Route path={adminRoute(paths.templates)} element={<Templates />} />
        <Route path={adminRoute(paths.eloTemplates)} element={<ELOTemplates />} />
        {/* The page was renamed Ratings; old bookmarks still land on it. */}
        <Route
          path={adminRoute(paths.eloTemplatesLegacy)}
          element={<Navigate to={paths.eloTemplates} replace />}
        />
        {isDevelopment && <Route path={adminRoute(paths.dev)} element={<Development />} />}
        {/* The admin pages' old addresses (before /manage): redirect with
            the rest of the path and the query. /tournament/:id stays the
            public tournament page, so only bare /tournament moves. */}
        {LEGACY_ADMIN_PATHS.flatMap((old) => [
          <Route key={old} path={adminRoute(old)} element={<LegacyAdminRedirect />} />,
          ...(old === '/tournament'
            ? []
            : [
                <Route
                  key={`${old}/*`}
                  path={`${adminRoute(old)}/*`}
                  element={<LegacyAdminRedirect />}
                />,
              ]),
        ])}
        <Route path="admin" element={<Navigate to={paths.admin} replace />} />
        {/* Nested catch-all so removed/unknown child routes (e.g. /public) show a proper 404 within the app shell */}
        {/* A path no route matches may be a code module's that has not
            arrived yet: pending until the modules settle, then a 404. */}
        <Route path="*" element={<ModulePendingRoute fallback={<NotFound />} />} />
      </Route>
      <Route path="*" element={<ModulePendingRoute fallback={<NotFound />} />} />
    </Routes>
  );
}

/** An admin page's old root address → the same under /manage, path rest and query kept. */
function LegacyAdminRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={`${paths.manage}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

/** An old public address → its new one, keeping its params, the query and the hash. */
function MovedRedirect({ to }: { to: string }) {
  const location = useLocation();
  const params = useParams();
  const filled = to.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
  const [path, query = ''] = filled.split('?');
  const search = new URLSearchParams(query);
  new URLSearchParams(location.search).forEach((value, key) => search.set(key, value));
  const searchText = search.toString();
  return <Navigate to={`${path}${searchText ? `?${searchText}` : ''}${location.hash}`} replace />;
}

/** `/matches/:slug` (old shared links) → the match's own page. */
function MatchSlugRedirect() {
  const { slug = '' } = useParams();
  return <Navigate to={matchPagePath(slug)} replace />;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <SnackbarProvider>
            <PageHeaderProvider>
              {/* Rendered above every route: impersonation applies app-wide,
                  including the public/player-facing pages it exists to test. */}
              <ImpersonationBanner />
              {/* A paid license that isn't paid: a warning for admins, then the "expired" page for everyone. */}
              <LicenseGate />
              {/* Admins on another address than FRONTEND_BASE_URL (e.g. by IP). */}
              <AddressMismatchBanner />
              {/* Admins choose a license before anything else, on every page. */}
              <AdminConsentRedirect />
              <ModuleGlobalOverlays />
              {/* "What do you play?": redirects to /welcome/games once per
                  account, from whatever page the player lands on. The API
                  decides whether it is due. */}
              <GamesOnboardingRedirect />
              {/* Renders at once. Code modules load alongside (main.tsx
                  starts them); a module's routes and slots show a pending
                  state until it arrives, and re-render when it does. */}
              <BlockedNotice />
              <AppRoutes />
              <SiteFooter />
              {/* The one match details dialog a game module opens with the
                  SDK's openMatchDetails(slug). Core's, so it needs no module
                  to have arrived. Core pages keep their own. */}
              <MatchDetailsHost />
              {/* Players calling for an admin from a game server: on every
                  page a signed-in admin opens, until someone resolves them. */}
              <AdminCallsHost />
              {/* Matchmaking's queue bar and "Match found" dialog, on every
                  page; nothing while matchmaking is off for this player. */}
              <MatchmakingOverlay />
              {/* Chat: the viewer's match, team and party, on every page. */}
              <ChatDock />
              {/* A party invite arriving: a card under the top bar on every page. */}
              <PartyInviteToast />
              {/* Online or away: this tab says when it goes idle. */}
              <PresenceReporter />
            </PageHeaderProvider>
          </SnackbarProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
