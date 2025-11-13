import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  TextField,
  Button,
  Alert,
  Container,
  Link,
  Stack,
  Typography,
  Divider,
} from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Set dynamic page title
  useEffect(() => {
    document.title = 'Login';
  }, []);

  interface LocationState {
    from?: { pathname: string };
  }
  const from = (location.state as LocationState)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!password.trim()) {
      setError('Password is required');
      setLoading(false);
      return;
    }

    try {
      const isValid = await api.verifyToken(password);
      if (isValid) {
        login(password);
        navigate(from, { replace: true });
      } else {
        setError('Invalid password. Please check your API token.');
      }
    } catch {
      setError('Failed to connect to the API. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1C1B1F 0%, #2B2930 100%)',
      }}
    >
      <Container maxWidth="xs">
        <Card
          elevation={0}
          sx={{
            p: { xs: 4, md: 5 },
            backgroundColor: 'background.paper',
            borderRadius: 3,
            boxShadow: (theme) => theme.shadows[location.pathname === '/login' ? 8 : 2],
          }}
        >
          <Stack spacing={4} alignItems="center">
            <Stack spacing={2} alignItems="center" sx={{ width: '100%' }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <img
                  src="/icon.svg"
                  alt="MatchZy Auto Tournament Logo"
                  style={{ width: '108px', height: '108px' }}
                />
              </Box>

              <Stack spacing={0.5} alignItems="center" sx={{ textAlign: 'center', px: 2 }}>
                <Typography variant="h5" fontWeight={600}>
                  Welcome back
                </Typography>
                <Typography variant="body2" color="text.secondary" maxWidth={320}>
                  Enter the administrator API token to manage tournaments, servers, and teams.
                </Typography>
              </Stack>
            </Stack>

            <Stack component="form" onSubmit={handleSubmit} spacing={2.5} sx={{ width: '100%' }}>
              <TextField
                fullWidth
                id="password"
                label="API Token"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your API token"
                autoFocus
                disabled={loading}
              />

              {error && (
                <Alert severity="error" sx={{ borderRadius: 2 }}>
                  {error}
                </Alert>
              )}

              <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </Stack>

            <Divider flexItem />

            <Stack spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              <Typography variant="body2" color="text.secondary">
                Need the token or access instructions?
              </Typography>

              <Stack direction="row" spacing={2}>
                <Link
                  href="https://github.com/sivert-io/matchzy-auto-tournament"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  GitHub
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </Link>
                <Link
                  href="https://mat.sivert.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  Documentation
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </Link>
              </Stack>
            </Stack>
          </Stack>
        </Card>
      </Container>
    </Box>
  );
}
