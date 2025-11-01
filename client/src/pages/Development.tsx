import React, { useState } from 'react';
import {
  Container,
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Alert,
  Divider,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  BugReport as BugReportIcon,
  Group as GroupIcon,
  Storage as StorageIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

const Development: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleCreateTestTeams = async (count: number) => {
    setLoading(true);
    setMessage(null);

    try {
      const teams: Array<{
        id: string;
        name: string;
        tag: string;
        players: Array<{ steamId: string; name: string }>;
      }> = [];
      const teamNames = [
        'Astralis',
        'Natus Vincere',
        'FaZe Clan',
        'Team Liquid',
        'G2 Esports',
        'Ninjas in Pyjamas',
        'Fnatic',
        'Vitality',
        'MOUZ',
        'Heroic',
        'FURIA',
        'Cloud9',
        'Team Spirit',
        'BIG',
        'Complexity',
        'ENCE',
      ];

      for (let i = 0; i < count; i++) {
        const teamName = teamNames[i % teamNames.length];
        const suffix = i >= teamNames.length ? ` ${Math.floor(i / teamNames.length) + 1}` : '';

        teams.push({
          id: `test-team-${Date.now()}-${i}`,
          name: `${teamName}${suffix}`,
          tag: teamName.substring(0, 3).toUpperCase(),
          players: [
            { steamId: `7656119${Math.floor(Math.random() * 100000000)}`, name: 'Player1' },
            { steamId: `7656119${Math.floor(Math.random() * 100000000)}`, name: 'Player2' },
            { steamId: `7656119${Math.floor(Math.random() * 100000000)}`, name: 'Player3' },
            { steamId: `7656119${Math.floor(Math.random() * 100000000)}`, name: 'Player4' },
            { steamId: `7656119${Math.floor(Math.random() * 100000000)}`, name: 'Player5' },
          ],
        });
      }

      const response = await globalThis.fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
        },
        body: JSON.stringify(teams),
      });

      if (!response.ok) {
        throw new Error('Failed to create test teams');
      }

      setMessage({ type: 'success', text: `Successfully created ${count} test teams!` });
    } catch (error) {
      console.error('Error creating test teams:', error);
      setMessage({ type: 'error', text: 'Failed to create test teams' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTestServers = async (count: number) => {
    setLoading(true);
    setMessage(null);

    try {
      const servers: Array<{
        id: string;
        name: string;
        host: string;
        port: number;
        password: string;
      }> = [];

      for (let i = 0; i < count; i++) {
        servers.push({
          id: `test-server-${Date.now()}-${i}`,
          name: `Test Server #${i + 1}`,
          host: '192.168.1.1',
          port: 27015 + i,
          password: 'test123',
        });
      }

      const response = await globalThis.fetch('/api/servers/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
        },
        body: JSON.stringify(servers),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create test servers');
      }

      setMessage({ type: 'success', text: `Successfully created ${count} test servers!` });
    } catch (error) {
      console.error('Error creating test servers:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create test servers';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllTestData = async () => {
    if (
      !(globalThis as { confirm?: (message: string) => boolean }).confirm?.(
        'Are you sure you want to delete ALL test data?'
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // Delete all teams that start with 'test-team-'
      const teamsResponse = await globalThis.fetch('/api/teams', {
        headers: {
          Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
        },
      });

      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json();
        const testTeams =
          teamsData.teams?.filter((t: { id: string }) => t.id.startsWith('test-team-')) || [];

        for (const team of testTeams) {
          await globalThis.fetch(`/api/teams/${team.id}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
            },
          });
        }
      }

      // Delete all servers that start with 'test-server-'
      const serversResponse = await globalThis.fetch('/api/servers', {
        headers: {
          Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
        },
      });

      if (serversResponse.ok) {
        const serversData = await serversResponse.json();
        const testServers =
          serversData.servers?.filter((s: { id: string }) => s.id.startsWith('test-server-')) || [];

        for (const server of testServers) {
          await globalThis.fetch(`/api/servers/${server.id}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${globalThis.localStorage.getItem('api_token')}`,
            },
          });
        }
      }

      setMessage({ type: 'success', text: 'Successfully deleted all test data!' });
    } catch (error) {
      console.error('Error deleting test data:', error);
      setMessage({ type: 'error', text: 'Failed to delete test data' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <BugReportIcon sx={{ fontSize: 40, color: 'warning.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Development Tools
        </Typography>
      </Box>

      <Alert severity="warning" sx={{ mb: 3 }}>
        These tools are only available in development mode. Use them to quickly generate test data
        for testing the application.
      </Alert>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Test Teams */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <GroupIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Test Teams
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create teams with random player data for testing tournament brackets and matches.
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(2)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 2 Teams'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(4)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 4 Teams'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(8)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 8 Teams'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(16)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 16 Teams'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Test Servers */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <StorageIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Test Servers
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create server configurations for testing match management and RCON commands.
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(1)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 1 Server'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(3)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 3 Servers'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(5)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 5 Servers'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(10)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 10 Servers'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Danger Zone */}
        <Grid size={{ xs: 12 }}>
          <Card sx={{ borderColor: 'error.main', borderWidth: 2, borderStyle: 'solid' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <DeleteIcon color="error" />
                <Typography variant="h6" fontWeight={600} color="error">
                  Danger Zone
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary" mb={2}>
                Delete all test data (teams and servers with &apos;test-&apos; prefix). This action
                cannot be undone.
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleDeleteAllTestData}
                disabled={loading}
                startIcon={<DeleteIcon />}
              >
                {loading ? <CircularProgress size={24} /> : 'Delete All Test Data'}
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Development;
