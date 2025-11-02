import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Stack,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Grid,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsIcon from '@mui/icons-material/Settings';
import MapIcon from '@mui/icons-material/Map';
import GroupsIcon from '@mui/icons-material/Groups';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import TerminalIcon from '@mui/icons-material/Terminal';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../utils/api';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

export default function AdminTools() {
  // State
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('all');
  const [loadingServers, setLoadingServers] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Command parameters
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [restoreRound, setRestoreRound] = useState('');
  const [readyRequired, setReadyRequired] = useState('');
  const [mapName, setMapName] = useState('');
  const [team1Name, setTeam1Name] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [rconCommand, setRconCommand] = useState('');

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoadingServers(true);
      const response: { servers: Server[] } = await api.get('/api/servers');
      const enabledServers = (response.servers || []).filter((s: Server) => s.enabled);
      setServers(enabledServers);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  };

  const executeCommand = async (command: string, params?: Record<string, unknown>) => {
    if (selectedServer === '' || selectedServer === 'none') {
      setError('Please select a server');
      return;
    }

    setExecuting(true);
    setError('');
    setSuccess('');

    try {
      const serverIds = selectedServer === 'all' ? servers.map((s) => s.id) : [selectedServer];

      const response = await api.post('/api/rcon/command', {
        serverIds,
        command,
        ...params,
      });

      if (response.success) {
        const results = response.results || [];
        const successful = results.filter((r: { success: boolean }) => r.success).length;
        const failed = results.length - successful;

        setSuccess(
          `Command executed on ${successful}/${results.length} server(s)${
            failed > 0 ? ` (${failed} failed)` : ''
          }`
        );
      } else {
        setError(response.error || 'Command execution failed');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to execute command');
    } finally {
      setExecuting(false);
    }
  };

  const handleBroadcast = () => {
    if (!broadcastMessage.trim()) {
      setError('Please enter a message to broadcast');
      return;
    }
    executeCommand('css_asay', { message: broadcastMessage });
    setBroadcastMessage('');
  };

  if (loadingServers) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <TerminalIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h4" fontWeight={600}>
          Admin Tools
        </Typography>
      </Box>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Server Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <FormControl sx={{ flex: 1, maxWidth: 400 }}>
              <InputLabel>Target Server</InputLabel>
              <Select
                value={selectedServer}
                label="Target Server"
                onChange={(e) => setSelectedServer(e.target.value)}
              >
                <MenuItem value="all">
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip label="ALL" size="small" color="primary" />
                    <Typography>All Servers ({servers.length})</Typography>
                  </Box>
                </MenuItem>
                <Divider />
                {servers.map((server) => (
                  <MenuItem key={server.id} value={server.id}>
                    {server.name} ({server.host}:{server.port})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadServers}
              disabled={loadingServers}
            >
              Refresh
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Command Categories */}
      <Stack spacing={2}>
        {/* Match Control */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <PlayArrowIcon color="primary" />
              <Typography variant="h6">Match Control</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  color="success"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => executeCommand('css_start')}
                  disabled={executing}
                >
                  Start Match
                </Button>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  color="error"
                  startIcon={<RestartAltIcon />}
                  onClick={() => executeCommand('css_restart')}
                  disabled={executing}
                >
                  Restart Match
                </Button>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  color="warning"
                  startIcon={<PauseIcon />}
                  onClick={() => executeCommand('css_forcepause')}
                  disabled={executing}
                >
                  Force Pause
                </Button>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  color="success"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => executeCommand('css_forceunpause')}
                  disabled={executing}
                >
                  Force Unpause
                </Button>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Match Settings */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <SettingsIcon color="primary" />
              <Typography variant="h6">Match Settings</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_skipveto')}
                    disabled={executing}
                  >
                    Skip Veto
                  </Button>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_roundknife')}
                    disabled={executing}
                  >
                    Toggle Knife Round
                  </Button>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_playout')}
                    disabled={executing}
                  >
                    Toggle Playout
                  </Button>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_whitelist')}
                    disabled={executing}
                  >
                    Toggle Whitelist
                  </Button>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_settings')}
                    disabled={executing}
                  >
                    Show Settings
                  </Button>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => executeCommand('css_reload_admins')}
                    disabled={executing}
                  >
                    Reload Admins
                  </Button>
                </Grid>
              </Grid>

              <Divider />

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Ready Required
                </Typography>
                <Box display="flex" gap={1}>
                  <TextField
                    size="small"
                    type="number"
                    placeholder="0 = all players"
                    value={readyRequired}
                    onChange={(e) => setReadyRequired(e.target.value)}
                    disabled={executing}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => {
                      if (readyRequired) {
                        executeCommand('css_readyrequired', { value: readyRequired });
                        setReadyRequired('');
                      }
                    }}
                    disabled={executing || !readyRequired}
                  >
                    Set
                  </Button>
                </Box>
              </Box>
            </Stack>
          </AccordionDetails>
        </Accordion>

        {/* Backup & Restore */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <HistoryIcon color="primary" />
              <Typography variant="h6">Backup & Restore</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Restore Round Backup
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  size="small"
                  type="number"
                  placeholder="Round number"
                  value={restoreRound}
                  onChange={(e) => setRestoreRound(e.target.value)}
                  disabled={executing}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => {
                    if (restoreRound) {
                      executeCommand('css_restore', { round: restoreRound });
                      setRestoreRound('');
                    }
                  }}
                  disabled={executing || !restoreRound}
                >
                  Restore
                </Button>
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Server Management */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <MapIcon color="primary" />
              <Typography variant="h6">Server Management</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Change Map
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  size="small"
                  placeholder="de_dust2"
                  value={mapName}
                  onChange={(e) => setMapName(e.target.value)}
                  disabled={executing}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  onClick={() => {
                    if (mapName) {
                      executeCommand('css_map', { map: mapName });
                      setMapName('');
                    }
                  }}
                  disabled={executing || !mapName}
                >
                  Change Map
                </Button>
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Team Management */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <GroupsIcon color="primary" />
              <Typography variant="h6">Team Management</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Team 1 Name (CT)
                </Typography>
                <Box display="flex" gap={1}>
                  <TextField
                    size="small"
                    placeholder="Team 1"
                    value={team1Name}
                    onChange={(e) => setTeam1Name(e.target.value)}
                    disabled={executing}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => {
                      if (team1Name) {
                        executeCommand('css_team1', { name: team1Name });
                        setTeam1Name('');
                      }
                    }}
                    disabled={executing || !team1Name}
                  >
                    Set
                  </Button>
                </Box>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Team 2 Name (T)
                </Typography>
                <Box display="flex" gap={1}>
                  <TextField
                    size="small"
                    placeholder="Team 2"
                    value={team2Name}
                    onChange={(e) => setTeam2Name(e.target.value)}
                    disabled={executing}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => {
                      if (team2Name) {
                        executeCommand('css_team2', { name: team2Name });
                        setTeam2Name('');
                      }
                    }}
                    disabled={executing || !team2Name}
                  >
                    Set
                  </Button>
                </Box>
              </Box>
            </Stack>
          </AccordionDetails>
        </Accordion>

        {/* Practice Mode */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <FitnessCenterIcon color="primary" />
              <Typography variant="h6">Practice Mode</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="success"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => executeCommand('css_prac')}
                  disabled={executing}
                >
                  Start Practice Mode
                </Button>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="error"
                  startIcon={<RestartAltIcon />}
                  onClick={() => executeCommand('css_exitprac')}
                  disabled={executing}
                >
                  Exit Practice Mode
                </Button>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Admin Communication */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <CampaignIcon color="primary" />
              <Typography variant="h6">Admin Communication</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Broadcast Admin Message
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Enter message to broadcast..."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  disabled={executing}
                  multiline
                  maxRows={3}
                />
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={handleBroadcast}
                  disabled={executing || !broadcastMessage.trim()}
                >
                  Send
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Uses css_asay command (Admin Say in All Chat)
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Advanced RCON */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" gap={2}>
              <TerminalIcon color="primary" />
              <Typography variant="h6">Advanced RCON</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Warning:</strong> Advanced RCON allows direct command execution. Use with
                  caution. Incorrect commands may crash the server.
                </Typography>
              </Alert>
              <Typography variant="subtitle2" gutterBottom>
                Execute Custom RCON Command
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Enter RCON command (e.g., mp_warmup_end)"
                  value={rconCommand}
                  onChange={(e) => setRconCommand(e.target.value)}
                  disabled={executing}
                />
                <Button
                  variant="contained"
                  color="error"
                  onClick={() => {
                    if (rconCommand) {
                      executeCommand(rconCommand);
                      setRconCommand('');
                    }
                  }}
                  disabled={executing || !rconCommand}
                >
                  Execute
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                No need to prefix with css_ - it will be added automatically for MatchZy commands
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Box>
  );
}
