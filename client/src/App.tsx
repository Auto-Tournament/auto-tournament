import React from 'react';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PageHeaderProvider } from './contexts/PageHeaderContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
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
import FindPlayer from './pages/FindPlayer';
import PlayerProfile from './pages/PlayerProfile';
import TournamentLeaderboard from './pages/TournamentLeaderboard';
import ConnectSteam from './pages/ConnectSteam';
import Maps from './pages/Maps';
import Templates from './pages/Templates';
import ELOTemplates from './pages/ELOTemplates';
import Layout from './components/layout/Layout';
import NotFound from './pages/NotFound';
import { theme } from './theme';

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
  const { isAuthenticated, isLoading, playerSteamId, needsSteamLink } = useAuth();
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
        <Box textAlign="center">
          <Box
            component="img"
            src="/icon.svg"
            alt="Logo"
            sx={{
              width: 80,
              height: 80,
              mb: 2,
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.5 },
              },
            }}
          />
        </Box>
      </Box>
    );
  }

  if (adminOnly) {
    // Admin-only routes (default): require an authenticated admin session with a linked Steam ID.
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
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
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
              <AppRoutes />
            </PageHeaderProvider>
          </SnackbarProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
