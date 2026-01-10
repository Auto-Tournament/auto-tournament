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
import PublicPages from './pages/PublicPages';
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, playerSteamId } = useAuth();
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

  if (isAuthenticated) {
    // Admin session active – allow access to protected routes (dashboard, etc.)
    return <>{children}</>;
  }

  // If the user has a Steam identity but no admin session, treat them as a
  // signed-in player and send them to their player page instead of back to
  // the login form.
  if (playerSteamId) {
    return <Navigate to={`/player/${playerSteamId}`} replace />;
  }

  // No admin session and no player Steam ID – go to login.
  return <Navigate to="/login" state={{ from: location }} replace />;
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
          isAuthenticated
            ? // Admins leaving login should land on the dashboard
              <Navigate to="/" replace />
            : // Signed-in players should go straight to their player page instead of seeing login again
              playerSteamId
            ? <Navigate to={`/player/${playerSteamId}`} replace />
            : <Login />
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

      {/* Public pages - no auth required */}
      <Route path="/team/:teamId" element={<TeamMatch />} />
      <Route path="/player" element={<FindPlayer />} />
      <Route path="/player/:steamId" element={<PlayerProfile />} />
      <Route path="/tournament/:id/leaderboard" element={<TournamentLeaderboard />} />

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
        <Route path="public" element={<PublicPages />} />
        <Route path="settings" element={<Settings />} />
        <Route path="maps" element={<Maps />} />
        <Route path="templates" element={<Templates />} />
        <Route path="elo-templates" element={<ELOTemplates />} />
        {isDevelopment && <Route path="dev" element={<Development />} />}
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
