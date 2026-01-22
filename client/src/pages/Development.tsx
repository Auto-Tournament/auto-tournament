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
import { api } from '../utils/api';
import { useSnackbar } from '../contexts/SnackbarContext';
import { generateTeamName } from '../generation/teamName';
import { generatePlayerProfile } from '../generation/playerProfile';
import { useTranslation } from 'react-i18next';

const Development: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const { showSuccess, showError } = useSnackbar();
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [customTeamCount, setCustomTeamCount] = useState(8);
  const [customPlayerCount, setCustomPlayerCount] = useState(60);
  const [customServerCount, setCustomServerCount] = useState(3);
  const [resettingSimulation, setResettingSimulation] = useState(false);
  const { t } = useTranslation();

  // Set dynamic page title
  document.title = t('layout.pageTitle.devTools');

  const handleCreateTestTeams = async (count: number) => {
    setLoading(true);

    try {
      const teams: Array<{
        id: string;
        name: string;
        tag: string;
        players: Array<{ steamId: string; name: string; avatar?: string }>;
      }> = [];

      const slugify = (value: string) =>
        value
          .toLowerCase()
          // Keep all letters and numbers from any language while normalizing separators.
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/(^-|-$)/g, '');

      // Generate unique Steam IDs per player so each team gets unique players
      const baseTimestamp = Date.now();

      for (let i = 0; i < count; i++) {
        const fullName = generateTeamName();
        const slug = slugify(fullName);

        teams.push({
          id: `test-team-${slug}`,
          name: fullName,
          tag:
            fullName
              // Use all Unicode letters/digits and fall back if empty.
              .replace(/[^\p{L}\p{N}]/gu, '')
              .substring(0, 3)
              .toUpperCase() || 'TST',
          players: Array.from({ length: 5 }, (_, playerIndex) => {
            const globalIndex = i * 5 + playerIndex;
            const uniquePart = String(baseTimestamp + globalIndex)
              .padStart(10, '0')
              .slice(-10);
            const steamId = `7656119${uniquePart}`;

            const profile = generatePlayerProfile();

            return {
              steamId,
              name: profile.fullName,
            };
          }),
        });
      }

      const response = await globalThis.fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(teams),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || t('devToolsPage.testTeams.errors.create'));
      }

      const result = await response.json();
      if (result.failed && result.failed.length > 0) {
        showError(
          t('devToolsPage.testTeams.errors.partial', {
            created: result.successful?.length || 0,
            failed: result.failed.length,
          })
        );
      } else {
        showSuccess(
          t('devToolsPage.testTeams.success', {
            count: result.successful?.length || count,
          })
        );
      }
    } catch (error) {
      console.error('Error creating test teams:', error);
      showError(t('devToolsPage.testTeams.errors.create'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTestServers = async (count: number) => {
    setLoading(true);

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
        },
        body: JSON.stringify(servers),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || t('devToolsPage.testServers.errors.create'));
      }

      const result = await response.json();
      if (result.failed && result.failed.length > 0) {
        showError(
          t('devToolsPage.testServers.errors.partial', {
            created: result.successful?.length || 0,
            failed: result.failed.length,
          })
        );
      } else {
        showSuccess(
          t('devToolsPage.testServers.success', {
            count: result.successful?.length || count,
          })
        );
      }
    } catch (error) {
      console.error('Error creating test servers:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('devToolsPage.testServers.errors.create');
      showError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTestPlayers = async (count: number) => {
    setLoading(true);

    try {
      const players: Array<{
        id: string; // Steam ID
        name: string;
      }> = [];

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

        const profile = generatePlayerProfile();
        const name = profile.fullName;

        // Let the backend apply its default Skill Rating (baseline ~1500)
        // by omitting any explicit ELO on creation.
        players.push({
          id: steamId,
          name,
        });
      }

      const response = await api.post('/api/players/bulk-import', players);

      if (response.success) {
        const created = response.created || 0;
        const updated = response.updated || 0;
        const errors = response.errors || [];

        if (errors.length > 0) {
          showError(
            t('devToolsPage.testPlayers.errors.partial', {
              created,
              updated,
              failed: errors.length,
            })
          );
        } else {
          showSuccess(
            t('devToolsPage.testPlayers.success', {
              created,
              updated,
            })
          );
        }
      } else {
        throw new Error(response.error || t('devToolsPage.testPlayers.errors.create'));
      }
    } catch (error) {
      console.error('Error creating test players:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('devToolsPage.testPlayers.errors.create');
      showError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllTestData = async () => {
    if (
      !(globalThis as { confirm?: (message: string) => boolean }).confirm?.(
        t('devToolsPage.deleteTestData.confirmPrompt')
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      // Delete all teams that start with 'test-team-'
      const teamsResponse = await globalThis.fetch('/api/teams');

      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json();
        const testTeams =
          teamsData.teams?.filter((t: { id: string }) => t.id.startsWith('test-team-')) || [];

        for (const team of testTeams) {
          await globalThis.fetch(`/api/teams/${team.id}`, {
            method: 'DELETE',
          });
        }
      }

      // Delete all servers that start with 'test-server-'
      const serversResponse = await globalThis.fetch('/api/servers');

      if (serversResponse.ok) {
        const serversData = await serversResponse.json();
        const testServers =
          serversData.servers?.filter((s: { id: string }) => s.id.startsWith('test-server-')) || [];

        for (const server of testServers) {
          await globalThis.fetch(`/api/servers/${server.id}`, {
            method: 'DELETE',
          });
        }
      }

      showSuccess(t('devToolsPage.deleteTestData.success'));
    } catch (error) {
      console.error('Error deleting test data:', error);
      showError(t('devToolsPage.deleteTestData.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleWipeDatabase = async () => {
    setConfirmWipeOpen(false);
    setWiping(true);

    try {
      const response: { success: boolean; message: string } = await api.post(
        '/api/tournament/wipe-database'
      );
      showSuccess(
        response.message || t('devToolsPage.wipeDatabase.successRedirect')
      );

      // Refresh page after 2 seconds
      setTimeout(() => {
        globalThis.location.href = '/';
      }, 2000);
    } catch (error) {
      console.error('Error wiping database:', error);
      showError(t('devToolsPage.wipeDatabase.error'));
    } finally {
      setWiping(false);
    }
  };

  const handleWipeTable = async (table: string) => {
    if (
      !(globalThis as { confirm?: (message: string) => boolean }).confirm?.(
        t('devToolsPage.wipeTable.confirmPrompt', { table })
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      const response: { success: boolean; message: string } = await api.post(
        `/api/tournament/wipe-table/${table}`
      );
      showSuccess(
        response.message ||
          t('devToolsPage.wipeTable.success', { table })
      );
    } catch (error) {
      console.error(`Error wiping ${table}:`, error);
      showError(t('devToolsPage.wipeTable.error', { table }));
    } finally {
      setLoading(false);
    }
  };

  const handleResetSimulationState = async () => {
    setResettingSimulation(true);
    try {
      const response: { success: boolean; message?: string; error?: string } = await api.post(
        '/api/tournament/dev/reset-simulation-state'
      );
      if (response.success) {
        showSuccess(
          response.message || t('devToolsPage.simulation.reset.success')
        );
      } else {
        showError(
          response.error || t('devToolsPage.simulation.reset.error')
        );
      }
    } catch (error) {
      console.error('Error resetting simulation state:', error);
      showError(t('devToolsPage.simulation.reset.error'));
    } finally {
      setResettingSimulation(false);
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Alert severity="warning" sx={{ mb: 3 }}>
        {t('devToolsPage.alert')}
      </Alert>

      <Grid container spacing={3}>
        {/* Test Data Creation */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h5" fontWeight={600} mb={2}>
            {t('devToolsPage.sections.testData.title')}
          </Typography>
        </Grid>

        {/* Test Teams */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <GroupIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  {t('devToolsPage.testTeams.title')}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                {t('devToolsPage.testTeams.description')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(2)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testTeams.buttons.createFixed', { count: 2 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(4)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testTeams.buttons.createFixed', { count: 4 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(8)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testTeams.buttons.createFixed', { count: 8 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestTeams(16)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testTeams.buttons.createFixed', { count: 16 })
                  )}
                </Button>
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label={t('devToolsPage.testTeams.customLabel')}
                    size="small"
                    value={customTeamCount}
                    onChange={(e) =>
                      setCustomTeamCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    fullWidth
                    slotProps={{
                      htmlInput: { min: 1 },
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => customTeamCount > 0 && handleCreateTestTeams(customTeamCount)}
                    disabled={loading || customTeamCount <= 0}
                  >
                    {loading ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.testTeams.buttons.createCustom')
                    )}
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
                  {t('devToolsPage.testPlayers.title')}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                {t('devToolsPage.testPlayers.description')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(10)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testPlayers.buttons.createFixed', { count: 10 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(20)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testPlayers.buttons.createFixed', { count: 20 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(50)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testPlayers.buttons.createFixed', { count: 50 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestPlayers(100)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testPlayers.buttons.createFixed', { count: 100 })
                  )}
                </Button>
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label={t('devToolsPage.testPlayers.customLabel')}
                    size="small"
                    value={customPlayerCount}
                    onChange={(e) =>
                      setCustomPlayerCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    fullWidth
                    slotProps={{
                      htmlInput: { min: 1 },
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() =>
                      customPlayerCount > 0 && handleCreateTestPlayers(customPlayerCount)
                    }
                    disabled={loading || customPlayerCount <= 0}
                  >
                    {loading ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.testPlayers.buttons.createCustom')
                    )}
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
                  {t('devToolsPage.testServers.title')}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mb={3}>
                {t('devToolsPage.testServers.description')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(1)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testServers.buttons.createFixed', { count: 1 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(3)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testServers.buttons.createFixed', { count: 3 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(5)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testServers.buttons.createFixed', { count: 5 })
                  )}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleCreateTestServers(10)}
                  disabled={loading}
                  fullWidth
                >
                  {loading ? (
                    <CircularProgress size={24} />
                  ) : (
                    t('devToolsPage.testServers.buttons.createFixed', { count: 10 })
                  )}
                </Button>
                <Box display="flex" gap={1}>
                  <TextField
                    type="number"
                    label={t('devToolsPage.testServers.customLabel')}
                    size="small"
                    value={customServerCount}
                    onChange={(e) =>
                      setCustomServerCount(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={loading}
                    fullWidth
                    slotProps={{
                      htmlInput: { min: 1 },
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() =>
                      customServerCount > 0 && handleCreateTestServers(customServerCount)
                    }
                    disabled={loading || customServerCount <= 0}
                  >
                    {loading ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.testServers.buttons.createCustom')
                    )}
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
                  {t('devToolsPage.dangerZone.title')}
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              {/* Delete Test Data */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <DeleteIcon />
                    <Typography fontWeight={600}>
                      {t('devToolsPage.deleteTestData.title')}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('devToolsPage.deleteTestData.description')}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleDeleteAllTestData}
                    disabled={loading || wiping}
                    startIcon={<DeleteIcon />}
                  >
                    {loading ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.deleteTestData.button')
                    )}
                  </Button>
                </AccordionDetails>
              </Accordion>

              {/* Wipe Specific Tables */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <StorageIcon />
                    <Typography fontWeight={600}>
                      {t('devToolsPage.wipeTable.title')}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('devToolsPage.wipeTable.description')}
                  </Typography>

                  {/* Core Tables */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.wipeTable.core.title')}
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
                        {t('devToolsPage.wipeTable.core.teams')}
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
                        {t('devToolsPage.wipeTable.core.servers')}
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
                        {t('devToolsPage.wipeTable.core.tournament')}
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
                        {t('devToolsPage.wipeTable.core.matches')}
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Players & Shuffle */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.wipeTable.players.title')}
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
                        {t('devToolsPage.wipeTable.players.players')}
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
                        {t('devToolsPage.wipeTable.players.ratingHistory')}
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
                        {t('devToolsPage.wipeTable.players.matchStats')}
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
                        {t('devToolsPage.wipeTable.players.shufflePlayers')}
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Maps & Templates */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.wipeTable.maps.title')}
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
                        {t('devToolsPage.wipeTable.maps.maps')}
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
                        {t('devToolsPage.wipeTable.maps.mapPools')}
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
                        {t('devToolsPage.wipeTable.maps.tournamentTemplates')}
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
                        {t('devToolsPage.wipeTable.maps.eloTemplates')}
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Match Events */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.wipeTable.matchEvents.title')}
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
                        {t('devToolsPage.wipeTable.matchEvents.events')}
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
                        {t('devToolsPage.wipeTable.matchEvents.mapResults')}
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Simulation State */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.simulation.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('devToolsPage.simulation.description')}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={handleResetSimulationState}
                    disabled={loading || wiping || resettingSimulation}
                    fullWidth
                    size="small"
                  >
                    {resettingSimulation ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.simulation.button')
                    )}
                  </Button>

                  {/* Settings */}
                  <Typography variant="subtitle2" fontWeight={600} mt={2} mb={1}>
                    {t('devToolsPage.wipeTable.settings.title')}
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
                        {t('devToolsPage.wipeTable.settings.appSettings')}
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
                    <Typography fontWeight={600}>
                      {t('devToolsPage.wipeDatabase.title')}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Alert severity="error" sx={{ mb: 2 }}>
                    <strong>{t('devToolsPage.wipeDatabase.warningTitle')}</strong>{' '}
                    {t('devToolsPage.wipeDatabase.warningBody')}
                  </Alert>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('devToolsPage.wipeDatabase.permanentlyDeletes')}
                  </Typography>
                  <Box component="ul" sx={{ pl: 3, mb: 2 }}>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        {t('devToolsPage.wipeDatabase.items.tournaments')}
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        {t('devToolsPage.wipeDatabase.items.matches')}
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        {t('devToolsPage.wipeDatabase.items.teams')}
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" color="text.secondary">
                        {t('devToolsPage.wipeDatabase.items.servers')}
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
                    {wiping ? (
                      <CircularProgress size={24} />
                    ) : (
                      t('devToolsPage.wipeDatabase.button')
                    )}
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
          {t('devToolsPage.wipeDatabase.dialog.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>{t('devToolsPage.wipeDatabase.dialog.areYouSure')}</strong>
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            {t('devToolsPage.wipeDatabase.dialog.actionWill')}{' '}
            <strong>{t('devToolsPage.wipeDatabase.dialog.permanentlyDelete')}</strong>:
          </DialogContentText>
          <Box component="ul" sx={{ mt: 1, color: 'text.secondary' }}>
            <li>{t('devToolsPage.wipeDatabase.dialog.items.tournaments')}</li>
            <li>{t('devToolsPage.wipeDatabase.dialog.items.matches')}</li>
            <li>{t('devToolsPage.wipeDatabase.dialog.items.teams')}</li>
            <li>{t('devToolsPage.wipeDatabase.dialog.items.servers')}</li>
          </Box>
          <Alert severity="error" sx={{ mt: 2 }}>
            <strong>{t('devToolsPage.wipeDatabase.dialog.cannotUndo')}</strong>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmWipeOpen(false)} disabled={wiping} variant="outlined">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleWipeDatabase}
            disabled={wiping}
            variant="contained"
            color="error"
            startIcon={<DeleteForeverIcon />}
            autoFocus
          >
            {wiping
              ? t('devToolsPage.wipeDatabase.dialog.wiping')
              : t('devToolsPage.wipeDatabase.dialog.yesWipe')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Development;
