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
import TeamMatch from './pages/TeamMatch';
import FindPlayer from './pages/FindPlayer';
import PlayerProfile from './pages/PlayerProfile';
import TournamentLeaderboard from './pages/TournamentLeaderboard';
import Maps from './pages/Maps';
import Templates from './pages/Templates';
import ELOTemplates from './pages/ELOTemplates';
import Layout from './components/layout/Layout';
import { theme } from './theme';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
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

  return isAuthenticated ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" state={{ from: location }} replace />
  );
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null; // Loading state is handled by ProtectedRoute
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />

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
        <Route path="settings" element={<Settings />} />
        <Route path="maps" element={<Maps />} />
        <Route path="templates" element={<Templates />} />
        <Route path="elo-templates" element={<ELOTemplates />} />
        {((import.meta as unknown as { env: { DEV: boolean; VITE_ENABLE_DEV_PAGE?: string } }).env.DEV ||
          (import.meta as unknown as { env: { VITE_ENABLE_DEV_PAGE?: string } }).env.VITE_ENABLE_DEV_PAGE === 'true') && (
          <Route path="dev" element={<Development />} />
        )}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
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
