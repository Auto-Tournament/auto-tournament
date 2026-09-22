import React from 'react';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PageHeaderProvider } from './contexts/PageHeaderContext';
import { SnackbarProvider, useSnackbar } from './contexts/SnackbarContext';
import { AtIcon } from './components/common/AtIcon';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Teams from './pages/Teams';
import Players from './pages/Players';
import Servers from './pages/Servers';
import Tournament from './pages/Tournament';
import Bracket from './pages/Bracket';
import Matches from './pages/Matches';
import AdminTools from './pages/AdminTools';
import Settings from './pages/Settings';
import Development from './pages/Development';
import { useIsDevelopment } from './hooks/useIsDevelopment';
import TeamMatch from './pages/TeamMatch';
import TeamProfile from './pages/TeamProfile';
import FindPlayer from './pages/FindPlayer';
import PlayerProfile from './pages/PlayerProfile';
import TournamentLeaderboard from './pages/TournamentLeaderboard';
import TournamentOverview from './pages/TournamentOverview';
import Home from './pages/Home';
import Browse from './pages/Browse';
import ConnectSteam from './pages/ConnectSteam';
import AccountConnections from './pages/AccountConnections';
import Maps from './pages/Maps';
import Templates from './pages/Templates';
import ELOTemplates from './pages/ELOTemplates';
import Layout from './components/layout/Layout';
import NotFound from './pages/NotFound';
import { theme } from './theme';
import { GamesOnboardingRedirect } from './components/games/GamesOnboardingRedirect';
import WelcomeGames from './pages/WelcomeGames';
import { ImpersonationBanner } from './components/common/ImpersonationBanner';

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
      return <Navigate to={`/player/${impersonation.steamId}`} replace />;
    }

    if (isAuthenticated) {
      // Admin session active – require Steam to be linked before allowing access
      // to the main dashboard and other protected admin routes.
      if (needsSteamLink && location.pathname !== '/connect-steam') {
        return <Navigate to="/connect-steam" replace />;
      }

      return <>{children}</>;
    }

    // If the user has a Steam identity but no admin session, send them to
    // their player page (registered or not – we show "not registered" there).
    if (playerSteamId) {
      return <Navigate to={`/player/${playerSteamId}`} replace />;
    }

    // No admin session and no player Steam ID – go to login.
    return <Navigate to="/login" state={{ from: location }} replace />;
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
 * - A real admin session (not impersonating): the admin dashboard shell
 *   (`Layout`, with its nested `/teams`, `/players`, etc. routes) — unchanged
 *   from before Home existed.
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
    if (needsSteamLink && location.pathname !== '/connect-steam') {
      return <Navigate to="/connect-steam" replace />;
    }
    return <Layout />;
  }

  if (playerSteamId) {
    return <Home />;
  }

  return <Navigate to="/login" state={{ from: location }} replace />;
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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading, playerSteamId } = useAuth();
  const isDevelopment = useIsDevelopment();

  if (isLoading) {
    return null; // Loading state is handled by ProtectedRoute
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            // Admins leaving login should land on the dashboard
            <Navigate to="/" replace />
          ) : playerSteamId ? (
            // Signed-in but not admin → their player page (shows "not registered" if needed)
            <Navigate to={`/player/${playerSteamId}`} replace />
          ) : (
            <Login />
          )
        }
      />

      {/* Admin Steam linking flow */}
      <Route
        path="/connect-steam"
        element={
          <ProtectedRoute>
            <ConnectSteam />
          </ProtectedRoute>
        }
      />

      {/* Viewer & player-facing pages – require a signed-in identity (admin or player) */}
      <Route
        path="/team/:teamId"
        element={
          <ProtectedRoute adminOnly={false}>
            <TeamMatch />
          </ProtectedRoute>
        }
      />
      {/*
        Public team profile. Deliberately not `/team/:teamId` or `/teams/:teamId`:
        the former is the team's live match/server page (`TeamMatch`, used during
        play by players and MatchZy flows) and must keep its URL unchanged; the
        latter would sit under the admin-only `/teams` list. `/t/team/:teamId`
        avoids both.
      */}
      <Route
        path="/t/team/:teamId"
        element={
          <ProtectedRoute adminOnly={false}>
            <TeamProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tournament/:id"
        element={
          <ProtectedRoute adminOnly={false}>
            <TournamentOverview />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tournament/:id/leaderboard"
        element={
          <ProtectedRoute adminOnly={false}>
            <TournamentLeaderboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/player"
        element={
          <ProtectedRoute adminOnly={false}>
            <FindPlayer />
          </ProtectedRoute>
        }
      />
      <Route
        path="/player/:steamId"
        element={
          <ProtectedRoute adminOnly={false}>
            <PlayerProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/browse"
        element={
          <ProtectedRoute adminOnly={false}>
            <Browse />
          </ProtectedRoute>
        }
      />

      {/* The signed-in player's own account */}
      <Route path="/me" element={<Navigate to="/me/connections" replace />} />
      <Route
        path="/me/connections"
        element={
          <RequireSignedIn>
            <AccountConnections />
          </RequireSignedIn>
        }
      />

      {/* "What do you play?" onboarding: first-visit redirect target, and
          "Edit games" (?edit=1) entry points navigate here too. */}
      <Route
        path="/welcome/games"
        element={
          <RequireSignedIn>
            <WelcomeGames />
          </RequireSignedIn>
        }
      />

      <Route path="/" element={<RootRoute />}>
        <Route index element={<Dashboard />} />
        <Route path="teams" element={<Teams />} />
        <Route path="players" element={<Players />} />
        <Route path="servers" element={<Servers />} />
        <Route path="tournament" element={<Tournament />} />
        <Route path="bracket" element={<Bracket />} />
        <Route path="matches" element={<Matches />} />
        <Route path="admin" element={<AdminTools />} />
        <Route path="settings" element={<Settings />} />
        <Route path="maps" element={<Maps />} />
        <Route path="templates" element={<Templates />} />
        <Route path="elo-templates" element={<ELOTemplates />} />
        {isDevelopment && <Route path="dev" element={<Development />} />}
        {/* Nested catch-all so removed/unknown child routes (e.g. /public) show a proper 404 within the app shell */}
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
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
              {/* "What do you play?": redirects to /welcome/games once per
                  account, from whatever page the player lands on. The API
                  decides whether it is due. */}
              <GamesOnboardingRedirect />
              <AppRoutes />
            </PageHeaderProvider>
          </SnackbarProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
