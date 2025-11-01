import React from 'react';
import { AppBar, Toolbar, Typography, Box, Button, Container, IconButton } from '@mui/material';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import LogoutIcon from '@mui/icons-material/Logout';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import StorageIcon from '@mui/icons-material/Storage';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import BuildIcon from '@mui/icons-material/Build';
import { useAuth } from '../../contexts/AuthContext';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  const isDevelopment = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV;

  const navItems = [
    { label: 'Tournament', path: '/tournament', icon: EmojiEventsIcon },
    { label: 'Bracket', path: '/bracket', icon: AccountTreeIcon },
    { label: 'Matches', path: '/matches', icon: SportsEsportsIcon },
    { label: 'Teams', path: '/teams', icon: GroupsIcon },
    { label: 'Servers', path: '/servers', icon: StorageIcon },
    ...(isDevelopment ? [{ label: 'Dev Tools', path: '/dev', icon: BuildIcon }] : []),
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
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  startIcon={<Icon />}
                  sx={{
                    color: 'white',
                    backgroundColor: isActive(item.path)
                      ? 'rgba(255, 255, 255, 0.1)'
                      : 'transparent',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
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
