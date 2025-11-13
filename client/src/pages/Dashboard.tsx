import React, { useEffect } from 'react';
import { Box, Typography, Card, CardContent, Button, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GroupsIcon from '@mui/icons-material/Groups';
import StorageIcon from '@mui/icons-material/Storage';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SettingsIcon from '@mui/icons-material/Settings';
import { OnboardingChecklist } from '../components/dashboard/OnboardingChecklist';

export default function Dashboard() {
  const navigate = useNavigate();

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Dashboard';
  }, []);

  const cards = [
    {
      title: 'Tournament',
      description: 'Configure tournament settings',
      icon: <EmojiEventsIcon sx={{ fontSize: 48 }} />,
      path: '/tournament',
      color: '#6750A4',
    },
    {
      title: 'Bracket',
      description: 'View tournament bracket',
      icon: <AccountTreeIcon sx={{ fontSize: 48 }} />,
      path: '/bracket',
      color: '#7D5260',
    },
    {
      title: 'Teams',
      description: 'Manage teams and players',
      icon: <GroupsIcon sx={{ fontSize: 48 }} />,
      path: '/teams',
      color: '#386A20',
    },
    {
      title: 'Servers',
      description: 'Configure CS2 servers',
      icon: <StorageIcon sx={{ fontSize: 48 }} />,
      path: '/servers',
      color: '#005FAF',
    },
    {
      title: 'Matches',
      description: 'Create and manage matches',
      icon: <SportsEsportsIcon sx={{ fontSize: 48 }} />,
      path: '/matches',
      color: '#984061',
    },
    {
      title: 'Settings',
      description: 'Manage webhook URLs and integrations',
      icon: <SettingsIcon sx={{ fontSize: 48 }} />,
      path: '/settings',
      color: '#1D4ED8',
    },
  ];

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

      <Grid container spacing={3}>
        {cards.map((card) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={card.path}>
            <Card
              sx={{
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 6,
                },
              }}
              onClick={() => navigate(card.path)}
            >
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <Box sx={{ color: card.color, mb: 2 }}>{card.icon}</Box>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  {card.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={3}>
                  {card.description}
                </Typography>
                <Button variant="outlined">Open</Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
