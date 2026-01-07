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
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Set dynamic page title
  useEffect(() => {
    document.title = t('login.title');
  }, [t]);

  interface LocationState {
    from?: { pathname: string };
  }
  const from = (location.state as LocationState)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!password.trim()) {
      setError(t('login.passwordRequired'));
      setLoading(false);
      return;
    }

    try {
      const isValid = await api.verifyToken(password);
      if (isValid) {
        login(password);
        navigate(from, { replace: true });
      } else {
        setError(t('login.invalidPassword'));
      }
    } catch {
      setError(t('login.connectionFailed'));
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
                  {t('login.welcome')}
                </Typography>
                <Typography variant="body2" color="text.secondary" maxWidth={320}>
                  {t('login.subtitle')}
                </Typography>
              </Stack>
            </Stack>

            <Stack component="form" onSubmit={handleSubmit} spacing={2.5} sx={{ width: '100%' }}>
              <TextField
                fullWidth
                id="password"
                label={t('login.apiTokenLabel')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.apiTokenPlaceholder')}
                autoFocus
                disabled={loading}
                slotProps={{
                  htmlInput: { 'data-testid': 'login-api-token-input' },
                }}
              />

              {error && (
                <Alert severity="error" sx={{ borderRadius: 2 }} data-testid="login-error-message">
                  {error}
                </Alert>
              )}

              <Button
                data-testid="login-sign-in-button"
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={loading}
              >
                {loading ? t('login.signingIn') : t('login.signIn')}
              </Button>
            </Stack>

            <Divider flexItem />

            <Stack spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              <Typography variant="body2" color="text.secondary">
                {t('login.needToken')}
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
                  {t('login.github')}
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
                  {t('login.documentation')}
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </Link>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {t('login.version')}{' '}
                {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Unknown'}
              </Typography>
            </Stack>
          </Stack>
        </Card>
      </Container>
    </Box>
  );
}
