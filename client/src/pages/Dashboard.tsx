import React, { useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import { OnboardingChecklist } from '../components/dashboard/OnboardingChecklist';

export default function Dashboard() {
  // Set dynamic page title
  useEffect(() => {
    document.title = 'Dashboard';
  }, []);

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <DashboardIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Dashboard
        </Typography>
      </Box>

      {/* Onboarding Checklist */}
      <Box mb={4}>
        <OnboardingChecklist />
      </Box>
    </Box>
  );
}
