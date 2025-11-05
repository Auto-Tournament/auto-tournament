import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Alert,
  Chip,
  CircularProgress,
  Grid,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../utils/api';
import { ADMIN_COMMAND_CATEGORIES, type AdminCommand } from '../constants/adminCommands';
import { useAdminCommands } from '../hooks/useAdminCommands';
import { ServerEventsMonitor } from '../components/admin/ServerEventsMonitor';
import { LogViewer } from '../components/admin/LogViewer';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

const AdminTools: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('all');
  const [loadingServers, setLoadingServers] = useState(true);
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({});

  const { executing, results, error, success, executeCommand, clearMessages } = useAdminCommands();

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    setLoadingServers(true);
    try {
      const response: { servers: Server[] } = await api.get('/api/servers');
      const enabledServers = (response.servers || []).filter((s: Server) => s.enabled);
      setServers(enabledServers);
    } catch (err) {
      console.error('Failed to load servers:', err);
    } finally {
      setLoadingServers(false);
    }
  };

  const handleExecuteCommand = async (command: AdminCommand) => {
    clearMessages();

    // Get the command value (input from user if required)
    const value = command.requiresInput ? commandInputs[command.id] : undefined;

    // Validate input if required
    if (command.requiresInput && !value) {
      return;
    }

    // Determine which servers to execute on
    const serverIds = selectedServerId === 'all' ? servers.map((s) => s.id) : [selectedServerId];

    if (serverIds.length === 0) {
      return;
    }

    await executeCommand(serverIds, command.command, value);

    // Clear input after execution
    if (command.requiresInput) {
      setCommandInputs((prev) => ({ ...prev, [command.id]: '' }));
    }
  };

  const handleInputChange = (commandId: string, value: string) => {
    setCommandInputs((prev) => ({ ...prev, [commandId]: value }));
  };

  if (loadingServers) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight={600}>
          Admin Tools
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadServers}
          disabled={loadingServers}
        >
          Refresh Servers
        </Button>
      </Box>

      <Typography variant="h5" fontWeight={600} mb={3}>
        RCON Commands
      </Typography>

      {/* Server Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, md: 8 }}>
              <FormControl fullWidth>
                <InputLabel>Target Server(s)</InputLabel>
                <Select
                  value={selectedServerId}
                  label="Target Server(s)"
                  onChange={(e) => setSelectedServerId(e.target.value)}
                >
                  <MenuItem value="all">
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip label="All Servers" size="small" color="primary" />
                      <Typography>Execute on all {servers.length} server(s)</Typography>
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
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Button
                fullWidth
                variant="contained"
                color="info"
                onClick={() =>
                  executeCommand(
                    selectedServerId === 'all' ? servers.map((s) => s.id) : [selectedServerId],
                    'status'
                  )
                }
                disabled={executing || servers.length === 0}
                startIcon={executing ? <CircularProgress size={16} /> : <PlayArrowIcon />}
              >
                Send Status
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Feedback Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={clearMessages}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearMessages}>
          {error}
        </Alert>
      )}

      {/* Execution Results */}
      {results.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Execution Results
            </Typography>
            <Grid container spacing={2}>
              {results.map((result) => (
                <Grid size={{ xs: 12 }} key={result.serverId}>
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: result.success ? 'success.main' : 'error.main',
                      bgcolor: result.success ? 'success.light' : 'error.light',
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="body2" fontWeight={600}>
                        {result.serverName}
                      </Typography>
                      <Chip
                        label={result.success ? '✓ Success' : '✗ Failed'}
                        size="small"
                        color={result.success ? 'success' : 'error'}
                        sx={{ fontWeight: 600 }}
                      />
                    </Box>
                    {result.response && (
                      <Box
                        sx={{
                          mt: 1,
                          p: 1.5,
                          borderRadius: 1,
                          bgcolor: 'background.paper',
                          border: '1px solid',
                          borderColor: 'divider',
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: '300px',
                          overflowY: 'auto',
                        }}
                      >
                        {result.response}
                      </Box>
                    )}
                    {result.error && (
                      <Typography variant="caption" color="error.main" display="block" mt={1}>
                        Error: {result.error}
                      </Typography>
                    )}
                  </Box>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Command Categories */}
      {ADMIN_COMMAND_CATEGORIES.map((category) => (
        <Accordion key={category.id} defaultExpanded={category.id === 'match-control'}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">{category.title}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              {category.commands.map((command) => (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={command.id}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                        {command.label}
                      </Typography>
                      {command.description && (
                        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                          {command.description}
                        </Typography>
                      )}

                      {command.requiresInput && (
                        <TextField
                          fullWidth
                          size="small"
                          label={command.inputLabel}
                          type={command.inputType || 'text'}
                          value={commandInputs[command.id] || ''}
                          onChange={(e) => handleInputChange(command.id, e.target.value)}
                          sx={{ mb: 1 }}
                        />
                      )}

                      <Button
                        fullWidth
                        variant="contained"
                        color={command.color || 'primary'}
                        size="small"
                        startIcon={executing ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                        onClick={() => handleExecuteCommand(command)}
                        disabled={
                          executing ||
                          servers.length === 0 ||
                          (command.requiresInput && !commandInputs[command.id])
                        }
                      >
                        Execute
                      </Button>

                      {command.id === 'custom-rcon' && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          <Typography variant="caption">
                            <strong>Warning:</strong> Use with caution!
                          </Typography>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </AccordionDetails>
        </Accordion>
      ))}

      {servers.length === 0 && (
        <Alert severity="info">
          No enabled servers found. Please add and enable servers in the Servers page.
        </Alert>
      )}

      <Divider sx={{ my: 4 }} />

      {/* Monitoring & Logs Section - Collapsed by default */}
      <Typography variant="h5" fontWeight={600} mb={3}>
        Monitoring & Logs
      </Typography>

      {/* Server Events Monitor */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Server Events Monitor</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ServerEventsMonitor />
        </AccordionDetails>
      </Accordion>

      {/* Application Logs */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Application Logs</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <LogViewer />
        </AccordionDetails>
      </Accordion>
    </Container>
  );
};

export default AdminTools;
