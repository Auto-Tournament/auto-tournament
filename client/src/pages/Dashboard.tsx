import React, { useEffect, useState } from 'react';
import { Box, Stack, CircularProgress, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { OnboardingChecklist } from '../components/dashboard/OnboardingChecklist';
import TournamentDashboardHeader from '../components/dashboard/TournamentDashboardHeader';
import TournamentMainGrid from '../components/dashboard/TournamentMainGrid';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus';
import { api } from '../utils/api';
import type { Tournament, MatchListItem, Server } from '../types';

export default function Dashboard() {
  // Set dynamic page title
  useEffect(() => {
    document.title = 'Dashboard';
  }, []);

  const { tournamentStatus, loading: onboardingLoading, hasWebhookUrl, hasServers, hasTeams, hasTournament } = useOnboardingStatus();
  
  // Check if onboarding is complete
  const onboardingComplete = hasWebhookUrl && hasServers && hasTeams && hasTournament;
  
  // Show onboarding if not complete AND tournament hasn't started
  const showOnboarding =
    !onboardingLoading &&
    !onboardingComplete &&
    tournamentStatus !== 'in_progress' &&
    tournamentStatus !== 'completed';

  // Only show dashboard when tournament is started
  const showDashboard = tournamentStatus === 'in_progress' || tournamentStatus === 'completed';

  // Load dashboard data
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [serverStatuses, setServerStatuses] = useState<Record<string, 'online' | 'offline'>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showDashboard) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load tournament
        try {
          const tournamentRes = await api.get<{ success: boolean; tournament: Tournament }>(
            '/api/tournament'
          );
          if (tournamentRes.success && tournamentRes.tournament) {
            setTournament(tournamentRes.tournament);
          }
        } catch {
          // Tournament might not exist, that's OK
        }

        // Load matches
        try {
          const matchesRes = await api.get<{ success: boolean; matches: MatchListItem[] }>(
            '/api/matches'
          );
          if (matchesRes.success && matchesRes.matches) {
            setMatches(matchesRes.matches);
          }
        } catch (e) {
          console.error('Failed to load matches:', e);
        }

        // Load servers
        try {
          const serversRes = await api.get<{ success: boolean; servers: Server[] }>('/api/servers');
          if (serversRes.success && serversRes.servers) {
            setServers(serversRes.servers);
            // Check server statuses
            const statusPromises = serversRes.servers.map(async (server) => {
              try {
                const statusRes = await api.get<{ success: boolean; status: string }>(
                  `/api/servers/${server.id}/status`
                );
                return { id: server.id, status: statusRes.status as 'online' | 'offline' };
              } catch {
                return { id: server.id, status: 'offline' as const };
              }
            });
            const statuses = await Promise.all(statusPromises);
            const statusMap: Record<string, 'online' | 'offline'> = {};
            statuses.forEach((s) => {
              statusMap[s.id] = s.status;
            });
            setServerStatuses(statusMap);
          }
        } catch (e) {
          console.error('Failed to load servers:', e);
        }
      } catch (e) {
        setError('Failed to load dashboard data');
        console.error('Error loading dashboard:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [showDashboard]);

  return (
    <Box
      component="main"
      data-testid="dashboard-page"
      sx={(theme) => ({
        flexGrow: 1,
        backgroundColor: theme.vars
          ? `rgba(${theme.vars.palette.background.defaultChannel} / 1)`
          : alpha(theme.palette.background.default, 1),
        overflow: 'auto',
      })}
    >
      <Stack
        spacing={2}
        sx={{
          alignItems: 'center',
          mx: 3,
          pb: 5,
          mt: { xs: 8, md: 0 },
        }}
      >
        {/* Show onboarding checklist if not complete and tournament hasn't started */}
      {showOnboarding && (
          <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
          <OnboardingChecklist />
        </Box>
      )}

        {/* Show dashboard when tournament is started */}
        {showDashboard && (
          <>
            <TournamentDashboardHeader tournamentName={tournament?.name} />
            {loading ? (
              <Box 
                display="flex" 
                justifyContent="center" 
                alignItems="center" 
                minHeight="400px"
                sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}
              >
                <CircularProgress />
              </Box>
            ) : error ? (
              <Alert 
                severity="error" 
                sx={{ 
                  width: '100%', 
                  maxWidth: { sm: '100%', md: '1700px' } 
                }}
              >
                {error}
              </Alert>
            ) : (
              <TournamentMainGrid
                tournament={tournament}
                matches={matches}
                servers={servers}
                serverStatuses={serverStatuses}
              />
            )}
          </>
        )}

        {/* Show message if tournament not started and onboarding is complete */}
        {!showOnboarding && !showDashboard && onboardingComplete && (
          <Alert 
            severity="info" 
            sx={{ 
              width: '100%', 
              maxWidth: { sm: '100%', md: '1700px' } 
            }}
          >
            Tournament dashboard will appear here once the tournament is started.
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
