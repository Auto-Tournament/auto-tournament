import React, { useEffect } from 'react';
import { Box, Button, Container, Typography, Card, CardContent, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { SteamIcon } from '../components/icons/SteamIcon';

export default function ConnectSteam() {
  const { isAuthenticated, isLoading, playerSteamId, loginWithSteam, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (isLoading) return;

    // No admin session – send back to login.
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    // Already linked to Steam – go to the dashboard.
    if (playerSteamId) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, playerSteamId, navigate]);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // While resolving auth state or if we’re about to redirect, keep the page blank.
  if (isLoading || !isAuthenticated || playerSteamId) {
    return null;
  }

  return (
    <Box minHeight="100vh" bgcolor="background.default" display="flex" alignItems="center">
      <Container maxWidth="sm">
        <Card>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t('connectSteam.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              {t('connectSteam.bodyIntro')}
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              {t('connectSteam.bodyRequirement')}
            </Typography>
            <Box mt={3}>
              <Stack spacing={1.5}>
                <Button
                  variant="contained"
                  color="inherit"
                  size="large"
                  onClick={loginWithSteam}
                  fullWidth
                  startIcon={<SteamIcon />}
                  sx={{
                    bgcolor: '#171a21',
                    color: '#ffffff',
                    '&:hover': {
                      bgcolor: '#1b2838',
                    },
                  }}
                >
                  {t('connectSteam.button')}
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  size="small"
                  onClick={handleSignOut}
                  fullWidth
                >
                  {t('nav.signOut')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
