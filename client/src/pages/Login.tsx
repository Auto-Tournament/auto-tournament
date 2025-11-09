import React, { useState, useEffect } from 'react';
import { Box, Card, TextField, Button, Alert, Container, Link } from '@mui/material';
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
            p: 4,
            backgroundColor: 'background.paper',
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              component="img"
              src="/icon.svg"
              alt="MatchZy Auto Tournament Logo"
              sx={{
                width: 120,
                height: 120,
                mb: 3,
              }}
            />
          </Box>

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your API token"
              autoFocus
              disabled={loading}
              sx={{ mb: 3 }}
            />

            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading}
              sx={{
                py: 1.5,
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <Box sx={{ textAlign: 'center', mt: 3 }}>
            <Link
              href="https://github.com/sivert-io/matchzy-auto-tournament"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                fontSize: '0.875rem',
                color: 'text.secondary',
                textDecoration: 'none',
                '&:hover': {
                  color: 'primary.main',
                  textDecoration: 'underline',
                },
              }}
            >
              GitHub
              <OpenInNewIcon sx={{ fontSize: '1rem' }} />
            </Link>
          </Box>
        </Card>
      </Container>
    </Box>
  );
}
