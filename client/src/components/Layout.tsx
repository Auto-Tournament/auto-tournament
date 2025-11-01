import React from 'react';
import { AppBar, Toolbar, Typography, Box, Button, Container, IconButton } from '@mui/material';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  const navItems = [
    { label: 'Teams', path: '/teams' },
    { label: 'Servers', path: '/servers' },
    { label: 'Matches', path: '/matches' },
  ];

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname === path + '/';
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => navigate('/')}
            sx={{ mr: 2, p: 0.5 }}
            title="Home"
          >
            <Box component="img" src="/icon.svg" alt="Logo" sx={{ width: 36, height: 36 }} />
          </IconButton>

          <Box sx={{ flexGrow: 1, display: 'flex', gap: 1 }}>
            {navItems.map((item) => (
              <Button
                key={item.path}
                onClick={() => navigate(item.path)}
                sx={{
                  color: 'white',
                  backgroundColor: isActive(item.path) ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  },
                }}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          <IconButton color="inherit" onClick={handleLogout} title="Logout">
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          py: 4,
          backgroundColor: 'background.default',
        }}
      >
        <Container maxWidth="xl">
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
