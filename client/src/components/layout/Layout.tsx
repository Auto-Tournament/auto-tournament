import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  Container,
  IconButton,
  Snackbar,
  Alert,
} from '@mui/material';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LibraryBooks,
  Logout,
} from '@mui/icons-material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupsIcon from '@mui/icons-material/Groups';
import StorageIcon from '@mui/icons-material/Storage';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CampaignIcon from '@mui/icons-material/Campaign';
import SettingsIcon from '@mui/icons-material/Settings';
import BuildIcon from '@mui/icons-material/Build';
import MapIcon from '@mui/icons-material/Map';
import DescriptionIcon from '@mui/icons-material/Description';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';
import type { SettingsResponse } from '../../types/api.types';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [webhookConfigured, setWebhookConfigured] = useState<boolean | null>(null);

  const isDevelopment = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV;

  const navItems = [
    { label: 'Tournament', path: '/tournament', icon: EmojiEventsIcon },
    { label: 'Bracket', path: '/bracket', icon: AccountTreeIcon },
    { label: 'Matches', path: '/matches', icon: SportsEsportsIcon },
    { label: 'Teams', path: '/teams', icon: GroupsIcon },
    { label: 'Servers', path: '/servers', icon: StorageIcon },
    { label: 'Maps', path: '/maps', icon: MapIcon },
    { label: 'Templates', path: '/templates', icon: DescriptionIcon },
    { label: 'Admin Tools', path: '/admin', icon: CampaignIcon },
    { label: 'Settings', path: '/settings', icon: SettingsIcon },
    ...(isDevelopment ? [{ label: 'Dev Tools', path: '/dev', icon: BuildIcon }] : []),
  ];

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await api.get<SettingsResponse>('/api/settings');
        if (isMounted) {
          setWebhookConfigured(Boolean(response.settings?.webhookConfigured));
        }
      } catch {
        if (isMounted) {
          setWebhookConfigured(false);
        }
      }
    };

    loadSettings();

    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<SettingsResponse['settings']>;
      setWebhookConfigured(Boolean(customEvent.detail?.webhookConfigured));
    };

    window.addEventListener('matchzy:settingsUpdated', handleSettingsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('matchzy:settingsUpdated', handleSettingsUpdated);
    };
  }, []);

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname === path + '/';
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ top: 0, zIndex: (theme) => theme.zIndex.drawer + 1 }}>
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
                    color: 'inherit',
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

          <Button
            color="inherit"
            href="https://mat.sivert.io/"
            target="_blank"
            rel="noopener noreferrer"
            sx={{ mr: 2 }}
            startIcon={<LibraryBooks />}
          >
            Documentation
          </Button>

          <Button color="error" onClick={handleLogout} startIcon={<Logout />}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: (theme) => ({
            xs: `calc(56px + ${theme.spacing(4)})`, // Mobile toolbar height
            sm: `calc(64px + ${theme.spacing(4)})`, // Desktop toolbar height
          }),
          pb: 4,
          backgroundColor: 'background.default',
        }}
      >
        <Container maxWidth="xl">
          <Outlet />
        </Container>
      </Box>

      <Snackbar
        open={webhookConfigured === false}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        autoHideDuration={null}
      >
        <Alert
          severity="error"
          variant="filled"
          icon={false}
          sx={{
            alignItems: 'center',
            display: 'flex',
          }}
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => navigate('/settings')}
            >
              Open Settings
            </Button>
          }
        >
          Webhook URL is not configured. Matches and servers cannot receive events until it is set.
        </Alert>
      </Snackbar>
    </Box>
  );
}
