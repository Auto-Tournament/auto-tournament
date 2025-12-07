import React, { useEffect } from 'react';
import { Box, Stack, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { OnboardingChecklist } from '../components/dashboard/OnboardingChecklist';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus';
import { DashboardStats } from '../components/dashboard/DashboardStats';

export default function Dashboard() {
  // Set dynamic page title
  useEffect(() => {
    document.title = 'Dashboard';
  }, []);

  const {
    tournamentStatus,
    loading: onboardingLoading,
    hasWebhookUrl,
    hasServers,
    hasTeams,
    hasTournament,
  } = useOnboardingStatus();

  // Check if onboarding is complete
  const onboardingComplete = hasWebhookUrl && hasServers && hasTeams && hasTournament;

  // Show onboarding if not complete AND tournament hasn't started
  const showOnboarding =
    !onboardingLoading &&
    !onboardingComplete &&
    tournamentStatus !== 'in_progress' &&
    tournamentStatus !== 'completed';

  // Only show "dashboard not ready" message when onboarding is complete but tournament not started
  const showDashboardMessage =
    !showOnboarding &&
    !onboardingLoading &&
    onboardingComplete &&
    tournamentStatus !== 'in_progress' &&
    tournamentStatus !== 'completed';

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
        {/* Onboarding checklist */}
        {showOnboarding && (
          <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
            <OnboardingChecklist />
          </Box>
        )}

        {/* Main dashboard stats (handles its own loading/error) */}
        <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
          <DashboardStats showOnboarding={showOnboarding} />
        </Box>

        {/* Message if tournament not started and onboarding is complete */}
        {showDashboardMessage && (
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
