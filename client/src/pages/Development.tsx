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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  BugReport as BugReportIcon,
  Group as GroupIcon,
  Storage as StorageIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  DeleteForever as DeleteForeverIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';

// Set dynamic page title
document.title = 'Development';
import { api } from '../utils/api';

const Development: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

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
        'Virtus.pro',
        'GamerLegion',
        'Eternal Fire',
        'The MongolZ',
        'Monte',
        'paiN Gaming',
        'Movistar Riders',
        'Imperial Esports',
        'Aurora Gaming',
        'MIBR',
        'OG',
        '9INE',
        'Bad News Eagles',
        'SAW',
      ];

      const slugify = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');

      // Real Steam IDs for testing avatars - public profiles that should exist
      // These will cycle through as needed for multiple teams
      const realSteamIds = [
        '76561197960287930', // Gabe Newell (public profile)
        '76561198013825972', // Popular public profile
        '76561198067146383', // Popular public profile
        '76561198021466528', // Popular public profile
        '76561198059949467', // Popular public profile
        '76561198077860982', // Popular public profile
        '76561198041282941', // Popular public profile
        '76561198012563928', // Popular public profile
        '76561198063472351', // Popular public profile
        '76561198084126937', // Popular public profile
      ];

      for (let i = 0; i < count; i++) {
        const teamName = teamNames[i % teamNames.length];
        const suffixIndex = Math.floor(i / teamNames.length);
        const suffix = suffixIndex > 0 ? ` ${suffixIndex + 1}` : '';
        const fullName = `${teamName}${suffix}`;
        const slug = slugify(fullName);

        teams.push({
          id: `test-team-${slug}`,
          name: fullName,
          tag: teamName.replace(/[^A-Za-z0-9]/g, '').substring(0, 3).toUpperCase() || 'TST',
          players: Array.from({ length: 5 }, (_, playerIndex) => ({
            steamId: realSteamIds[(i * 5 + playerIndex) % realSteamIds.length],
            name: `Player ${playerIndex + 1}`,
          })),
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

  const handleWipeDatabase = async () => {
    setConfirmWipeOpen(false);
    setWiping(true);
    setMessage(null);

    try {
      const response: { success: boolean; message: string } = await api.post(
        '/api/tournament/wipe-database'
      );
      setMessage({
        type: 'success',
        text: response.message || 'Database wiped successfully! Redirecting...',
      });

      // Refresh page after 2 seconds
      setTimeout(() => {
        globalThis.location.href = '/';
      }, 2000);
    } catch (error) {
      console.error('Error wiping database:', error);
      setMessage({ type: 'error', text: 'Failed to wipe database' });
    } finally {
      setWiping(false);
    }
  };

  const handleWipeTable = async (table: string) => {
    if (
      !(globalThis as { confirm?: (message: string) => boolean }).confirm?.(
        `Are you sure you want to wipe the ${table} table? This will delete all data in that table.`
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response: { success: boolean; message: string } = await api.post(
        `/api/tournament/wipe-table/${table}`
      );
      setMessage({
        type: 'success',
        text: response.message || `Table ${table} wiped successfully!`,
      });
    } catch (error) {
      console.error(`Error wiping ${table}:`, error);
      setMessage({ type: 'error', text: `Failed to wipe ${table} table` });
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
                <WarningIcon color="error" />
                <Typography variant="h6" fontWeight={600} color="error">
                  Danger Zone
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              {/* Delete Test Data */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <DeleteIcon />
                    <Typography fontWeight={600}>Delete Test Data</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Delete all test data (teams and servers with &apos;test-&apos; prefix). This
                    action cannot be undone.
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleDeleteAllTestData}
                    disabled={loading || wiping}
                    startIcon={<DeleteIcon />}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Delete All Test Data'}
                  </Button>
                </AccordionDetails>
              </Accordion>

              {/* Wipe Specific Tables */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <StorageIcon />
                    <Typography fontWeight={600}>Wipe Specific Tables</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Delete all data from a specific table. Useful for cleaning up without resetting
                    everything.
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('teams')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Teams
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('servers')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Servers
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('tournament')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Tournament
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('matches')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Matches
                      </Button>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              {/* Wipe Entire Database */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <DeleteForeverIcon />
                    <Typography fontWeight={600}>Wipe Entire Database</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Alert severity="error" sx={{ mb: 2 }}>
                    <strong>EXTREMELY DESTRUCTIVE!</strong> This will delete ALL data.
                  </Alert>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Permanently deletes:
                  </Typography>
                  <Box component="ul" sx={{ pl: 3, mb: 2 }}>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        All tournaments & brackets
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        All matches & events
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        All teams & players
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        All server configurations
                      </Typography>
                    </li>
                  </Box>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => setConfirmWipeOpen(true)}
                    disabled={loading || wiping}
                    startIcon={<DeleteForeverIcon />}
                    fullWidth
                  >
                    {wiping ? <CircularProgress size={24} /> : 'Wipe Entire Database'}
                  </Button>
                </AccordionDetails>
              </Accordion>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Wipe Database Confirmation Dialog */}
      <Dialog
        open={confirmWipeOpen}
        onClose={() => !wiping && setConfirmWipeOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="error" />
          Confirm Database Wipe
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>Are you absolutely sure?</strong>
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            This action will <strong>permanently delete</strong>:
          </DialogContentText>
          <Box component="ul" sx={{ mt: 1, color: 'text.secondary' }}>
            <li>All tournament data and brackets</li>
            <li>All match history and events</li>
            <li>All teams and player configurations</li>
            <li>All server configurations</li>
          </Box>
          <Alert severity="error" sx={{ mt: 2 }}>
            <strong>This action cannot be undone!</strong>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmWipeOpen(false)} disabled={wiping} variant="outlined">
            Cancel
          </Button>
          <Button
            onClick={handleWipeDatabase}
            disabled={wiping}
            variant="contained"
            color="error"
            startIcon={<DeleteForeverIcon />}
            autoFocus
          >
            {wiping ? 'Wiping Database...' : 'Yes, Wipe Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Development;
