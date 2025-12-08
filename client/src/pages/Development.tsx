import React, { useState } from 'react';
import {
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
  TextField,
} from '@mui/material';
import {
  Group as GroupIcon,
  Storage as StorageIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  DeleteForever as DeleteForeverIcon,
  Warning as WarningIcon,
  Person as PersonIcon,
} from '@mui/icons-material';

// Set dynamic page title
document.title = 'Development';
import { api } from '../utils/api';

const Development: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [customTeamCount, setCustomTeamCount] = useState(8);
  const [customPlayerCount, setCustomPlayerCount] = useState(60);
  const [customServerCount, setCustomServerCount] = useState(3);

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

      // Generate unique Steam IDs per player so each team gets unique players
      const baseTimestamp = Date.now();

      for (let i = 0; i < count; i++) {
        const teamName = teamNames[i % teamNames.length];
        const suffixIndex = Math.floor(i / teamNames.length);
        const suffix = suffixIndex > 0 ? ` ${suffixIndex + 1}` : '';
        const fullName = `${teamName}${suffix}`;
        const slug = slugify(fullName);

        teams.push({
          id: `test-team-${slug}`,
          name: fullName,
          tag:
            teamName
              .replace(/[^A-Za-z0-9]/g, '')
              .substring(0, 3)
              .toUpperCase() || 'TST',
          players: Array.from({ length: 5 }, (_, playerIndex) => {
            const globalIndex = i * 5 + playerIndex;
            const uniquePart = String(baseTimestamp + globalIndex)
              .padStart(10, '0')
              .slice(-10);
            const steamId = `7656119${uniquePart}`;
            return {
              steamId,
              name: `Player ${globalIndex + 1}`,
            };
          }),
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create test teams');
      }

      const result = await response.json();
      if (result.failed && result.failed.length > 0) {
        setMessage({
          type: 'error',
          text: `Created ${result.successful?.length || 0} team(s), but ${
            result.failed.length
          } failed. Check console for details.`,
        });
      } else {
        setMessage({
          type: 'success',
          text: `Successfully created ${result.successful?.length || count} test team(s)!`,
        });
      }
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

      // Use a single timestamp to ensure all servers in this batch have unique IDs
      // Use IP 0.0.0.0 for fake servers that always show as online (for screenshots/testing)
      const baseTimestamp = Date.now();
      for (let i = 0; i < count; i++) {
        servers.push({
          id: `test-server-${baseTimestamp}-${i}`,
          name: `Test Server #${i + 1}`,
          host: '0.0.0.0', // IP 0.0.0.0 = always online (fake server for testing/screenshots)
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create test servers');
      }

      const result = await response.json();
      if (result.failed && result.failed.length > 0) {
        setMessage({
          type: 'error',
          text: `Created ${result.successful?.length || 0} server(s), but ${
            result.failed.length
          } failed. Check console for details.`,
        });
      } else {
        setMessage({
          type: 'success',
          text: `Successfully created ${result.successful?.length || count} test server(s)!`,
        });
      }
    } catch (error) {
      console.error('Error creating test servers:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create test servers';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTestPlayers = async (count: number) => {
    setLoading(true);
    setMessage(null);

    try {
      const players: Array<{
        id: string; // Steam ID
        name: string;
        elo?: number;
      }> = [];

      // Extensive list of first and last names for more realistic dev data
      const firstNames = [
        'Liam',
        'Noah',
        'Oliver',
        'Elijah',
        'James',
        'William',
        'Benjamin',
        'Lucas',
        'Henry',
        'Alexander',
        'Mason',
        'Michael',
        'Ethan',
        'Daniel',
        'Jacob',
        'Logan',
        'Jackson',
        'Levi',
        'Sebastian',
        'Mateo',
        'Jack',
        'Owen',
        'Theodore',
        'Aiden',
        'Samuel',
        'Joseph',
        'John',
        'David',
        'Wyatt',
        'Matthew',
        'Luke',
        'Asher',
        'Carter',
        'Julian',
        'Grayson',
        'Leo',
        'Jayden',
        'Gabriel',
        'Isaac',
        'Lincoln',
        'Anthony',
        'Hudson',
        'Dylan',
        'Ezra',
        'Thomas',
        'Charles',
        'Christopher',
        'Jaxon',
        'Mila',
        'Olivia',
        'Emma',
        'Ava',
        'Sophia',
        'Isabella',
        'Charlotte',
        'Amelia',
        'Mia',
        'Harper',
        'Evelyn',
        'Abigail',
        'Emily',
        'Ella',
        'Elizabeth',
        'Camila',
        'Luna',
        'Sofia',
        'Avery',
        'Scarlett',
        'Eleanor',
        'Madison',
        'Layla',
        'Penelope',
        'Aria',
        'Chloe',
        'Grace',
        'Nora',
        'Riley',
        'Zoey',
        'Hannah',
        'Lily',
        'Addison',
        'Violet',
        'Stella',
        'Aurora',
        'Natalie',
        'Zoe',
      ];

      const lastNames = [
        'Smith',
        'Johnson',
        'Williams',
        'Brown',
        'Jones',
        'Garcia',
        'Miller',
        'Davis',
        'Rodriguez',
        'Martinez',
        'Hernandez',
        'Lopez',
        'Gonzalez',
        'Wilson',
        'Anderson',
        'Thomas',
        'Taylor',
        'Moore',
        'Jackson',
        'Martin',
        'Lee',
        'Perez',
        'Thompson',
        'White',
        'Harris',
        'Sanchez',
        'Clark',
        'Ramirez',
        'Lewis',
        'Robinson',
        'Walker',
        'Young',
        'Allen',
        'King',
        'Wright',
        'Scott',
        'Torres',
        'Nguyen',
        'Hill',
        'Flores',
        'Green',
        'Adams',
        'Nelson',
        'Baker',
        'Hall',
        'Rivera',
        'Campbell',
        'Mitchell',
        'Carter',
        'Roberts',
        'Gomez',
        'Phillips',
        'Evans',
        'Turner',
        'Diaz',
        'Parker',
        'Cruz',
        'Edwards',
        'Collins',
        'Reyes',
        'Stewart',
        'Morris',
        'Morales',
        'Murphy',
        'Cook',
        'Rogers',
        'Gutierrez',
        'Ortiz',
        'Morgan',
        'Cooper',
        'Peterson',
        'Bailey',
        'Reed',
        'Kelly',
        'Howard',
        'Ramos',
        'Kim',
        'Cox',
        'Ward',
        'Richardson',
        'Watson',
        'Brooks',
        'Chavez',
        'Wood',
        'James',
        'Bennett',
        'Gray',
        'Mendoza',
        'Ruiz',
        'Hughes',
        'Price',
        'Alvarez',
        'Castillo',
        'Sanders',
        'Patel',
        'Myers',
        'Long',
        'Ross',
        'Foster',
        'Jimenez',
        'Powell',
        'Jenkins',
        'Perry',
        'Russell',
      ];

      // Generate unique Steam IDs
      // Steam IDs are 17 digits, starting with 7656119 (Steam ID format)
      // We'll use a base timestamp and add the index to ensure uniqueness
      const baseTimestamp = Date.now();

      for (let i = 0; i < count; i++) {
        // Generate unique Steam ID: 7656119 + 10 digits (using timestamp + index)
        // This ensures each player gets a unique Steam ID
        const uniquePart = String(baseTimestamp + i)
          .padStart(10, '0')
          .slice(-10);
        const steamId = `7656119${uniquePart}`;

        // Generate a reasonably unique full name from the first/last name pools
        const firstIndex = i % firstNames.length;
        const lastIndex =
          Math.floor(i / firstNames.length) % lastNames.length;
        const firstName = firstNames[firstIndex];
        const lastName = lastNames[lastIndex];
        const name = `${firstName} ${lastName}`;

        // Vary ELO between 2500-3500 for testing
        const elo = 2500 + (i % 10) * 100;

        players.push({
          id: steamId,
          name,
          elo,
        });
      }

      const response = await api.post('/api/players/bulk-import', players);

      if (response.success) {
        const created = response.created || 0;
        const updated = response.updated || 0;
        const errors = response.errors || [];

        if (errors.length > 0) {
          setMessage({
            type: 'error',
            text: `Created ${created} player(s), updated ${updated}, but ${errors.length} failed. Check console for details.`,
          });
        } else {
          setMessage({
            type: 'success',
            text: `Successfully created ${created} player(s)${
              updated > 0 ? ` and updated ${updated}` : ''
            }!`,
          });
        }
      } else {
        throw new Error(response.error || 'Failed to create test players');
      }
    } catch (error) {
      console.error('Error creating test players:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create test players';
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
    <Box sx={{ width: '100%', height: '100%' }}>
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
        {/* Test Data Creation */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h5" fontWeight={600} mb={2}>
            Create Test Data
          </Typography>
        </Grid>

        {/* Test Teams */}
        <Grid size={{ xs: 12, md: 4 }}>
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
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label="Custom team count"
                    size="small"
                    value={customTeamCount}
                    onChange={(e) =>
                      setCustomTeamCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    inputProps={{ min: 1 }}
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    onClick={() => customTeamCount > 0 && handleCreateTestTeams(customTeamCount)}
                    disabled={loading || customTeamCount <= 0}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Create Teams'}
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Test Players */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <PersonIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Test Players
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create players with ELO ratings for testing shuffle tournaments and player
                management.
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(10)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 10 Players'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(20)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 20 Players'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(50)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 50 Players'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(100)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? <CircularProgress size={24} /> : 'Create 100 Players'}
                </Button>
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label="Custom player count"
                    size="small"
                    value={customPlayerCount}
                    onChange={(e) =>
                      setCustomPlayerCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    inputProps={{ min: 1 }}
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    onClick={() =>
                      customPlayerCount > 0 && handleCreateTestPlayers(customPlayerCount)
                    }
                    disabled={loading || customPlayerCount <= 0}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Create Players'}
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Test Servers */}
        <Grid size={{ xs: 12, md: 4 }}>
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
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label="Custom server count"
                    size="small"
                    value={customServerCount}
                    onChange={(e) =>
                      setCustomServerCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    inputProps={{ min: 1 }}
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    onClick={() =>
                      customServerCount > 0 && handleCreateTestServers(customServerCount)
                    }
                    disabled={loading || customServerCount <= 0}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Create Servers'}
                  </Button>
                </Box>
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
                    everything. Tables are organized by category.
                  </Typography>

                  {/* Core Tables */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    Core Tables
                  </Typography>
                  <Grid container spacing={1} mb={2}>
                    <Grid size={{ xs: 6, sm: 4 }}>
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
                    <Grid size={{ xs: 6, sm: 4 }}>
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
                    <Grid size={{ xs: 6, sm: 4 }}>
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
                    <Grid size={{ xs: 6, sm: 4 }}>
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

                  {/* Players & Shuffle */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    Players & Shuffle Tournaments
                  </Typography>
                  <Grid container spacing={1} mb={2}>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('players')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Players
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('player_rating_history')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Rating History
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('player_match_stats')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Match Stats
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('shuffle_tournament_players')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Shuffle Players
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Maps & Templates */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    Maps & Templates
                  </Typography>
                  <Grid container spacing={1} mb={2}>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('maps')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Maps
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('map_pools')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Map Pools
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('tournament_templates')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Tourn. Templates
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('elo_calculation_templates')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe ELO Templates
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Match Events */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    Match Events & Results
                  </Typography>
                  <Grid container spacing={1} mb={2}>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('match_events')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Match Events
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('match_map_results')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe Map Results
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Settings */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    Settings
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => handleWipeTable('app_settings')}
                        disabled={loading || wiping}
                        fullWidth
                        size="small"
                      >
                        Wipe App Settings
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
    </Box>
  );
};

export default Development;
