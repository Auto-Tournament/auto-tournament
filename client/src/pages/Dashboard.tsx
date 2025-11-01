import React from 'react';
import { Box, Typography, Card, CardContent, Button, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GroupsIcon from '@mui/icons-material/Groups';
import StorageIcon from '@mui/icons-material/Storage';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';

export default function Dashboard() {
  const navigate = useNavigate();

  const cards = [
    {
      title: 'Teams',
      description: 'Manage teams and players',
      icon: <GroupsIcon sx={{ fontSize: 48 }} />,
      path: '/teams',
      color: '#6750A4',
    },
    {
      title: 'Servers',
      description: 'Configure CS2 servers',
      icon: <StorageIcon sx={{ fontSize: 48 }} />,
      path: '/servers',
      color: '#7D5260',
    },
    {
      title: 'Matches',
      description: 'Create and manage matches',
      icon: <SportsEsportsIcon sx={{ fontSize: 48 }} />,
      path: '/matches',
      color: '#386A20',
    },
  ];

  return (
    <Box>
      <Typography variant="h4" fontWeight={600} mb={4}>
        Dashboard
      </Typography>

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
