import React, { useEffect } from 'react';
import { Box, Button, Container, Typography, Card, CardContent } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ConnectSteam() {
  const { isAuthenticated, isLoading, playerSteamId, loginWithSteam } = useAuth();
  const navigate = useNavigate();

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
              Connect your Steam account
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              To finish setting up your access, please link a Steam account. This lets the
              tournament system identify you as a player and, for the first linked admin, grants
              access to the dashboard.
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              After linking, you&apos;ll be redirected to the appropriate page based on your
              role:
            </Typography>
            <ul>
              <li>
                <Typography variant="body2" color="text.secondary">
                  Admins go to the main dashboard.
                </Typography>
              </li>
              <li>
                <Typography variant="body2" color="text.secondary">
                  Players go to their public player page.
                </Typography>
              </li>
            </ul>
            <Box mt={3}>
              <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={loginWithSteam}
                fullWidth
              >
                Connect with Steam
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}


