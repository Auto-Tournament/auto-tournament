import { useEffect } from 'react';
import { Box, Stack, Alert, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { OnboardingChecklist } from '../components/dashboard/OnboardingChecklist';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus';
import { DashboardStats } from '../components/dashboard/DashboardStats';
import { useTranslation } from 'react-i18next';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Set dynamic page title
  useEffect(() => {
    document.title = t('dashboard.title');
  }, [t]);

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
      sx={{
        flexGrow: 1,
        // Transparent so the page sits on the body's paper colour.
        backgroundColor: 'transparent',
        overflow: 'auto',
      }}
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

        {/* Banner pointing admins to the Manage console, which surfaces the
            things that actually need a decision (out of the way here so the
            Dashboard keeps its own broader stats view). */}
        <Alert
          severity="info"
          sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/manage')}>
              {t('dashboard.manageBanner.cta')}
            </Button>
          }
        >
          {t('dashboard.manageBanner.text')}
        </Alert>

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
            {t('dashboard.notReady')}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
