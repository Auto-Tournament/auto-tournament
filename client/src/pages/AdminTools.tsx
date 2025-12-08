import React, { useState } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import {
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
  Snackbar,
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

// Set dynamic page title
document.title = 'Admin Tools';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

const AdminTools: React.FC = () => {
  const { setHeaderActions } = usePageHeader();
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('all');
  const [loadingServers, setLoadingServers] = useState(true);
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({});

  const { executing, results, error, success, executeCommand, clearMessages } = useAdminCommands();

  // Curate which commands are shown as "quick actions" vs tucked away in advanced tools.
  // This keeps the page comprehensive but avoids overwhelming admins with every niche option up front.
  const ESSENTIAL_COMMAND_IDS = new Set<string>([
    'match-end', // css_restart
    'force-pause',
    'force-unpause',
    'broadcast',
    'start-practice',
    'exit-practice',
  ]);

  // Commands that are effectively duplicates or legacy variants we don't need to show twice
  // (e.g. another css_restart UI entry).
  const HIDDEN_COMMAND_IDS = new Set<string>(['clean-servers']);

  const loadServers = React.useCallback(async () => {
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
  }, []);

  React.useEffect(() => {
    loadServers();
  }, [loadServers]);

  React.useEffect(() => {
    setHeaderActions(
      <Button
        variant="outlined"
        startIcon={<RefreshIcon />}
        onClick={loadServers}
        disabled={loadingServers}
      >
        Refresh Servers
      </Button>
    );

    return () => {
      setHeaderActions(null);
    };
  }, [setHeaderActions, loadingServers, loadServers]);

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

  // Flatten all commands so we can build "Quick Actions" and "Advanced" sections
  const allCommands: AdminCommand[] = ADMIN_COMMAND_CATEGORIES.flatMap((category) => category.commands);

  const quickCommands: AdminCommand[] = allCommands.filter(
    (command) => ESSENTIAL_COMMAND_IDS.has(command.id) && !HIDDEN_COMMAND_IDS.has(command.id)
  );

  const advancedCategories = ADMIN_COMMAND_CATEGORIES
    .map((category) => ({
      ...category,
      commands: category.commands.filter(
        (command) =>
          !ESSENTIAL_COMMAND_IDS.has(command.id) && !HIDDEN_COMMAND_IDS.has(command.id)
      ),
    }))
    .filter((category) => category.commands.length > 0);

  const renderCommandCard = (command: AdminCommand) => (
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
  );

  if (loadingServers) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Typography variant="h5" fontWeight={600} mb={1.5}>
        Admin Tools
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Run common match and server actions across your CS2 servers. Quick actions are shown first,
        with more advanced tools available below.
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

      {/* Quick Actions */}
      {quickCommands.length > 0 && (
        <>
          <Typography variant="h6" fontWeight={600} mb={2}>
            Quick Actions
          </Typography>
          <Grid container spacing={2} mb={3}>
            {quickCommands.map((command) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={command.id}>
                {renderCommandCard(command)}
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {/* Advanced Command Categories */}
      {advancedCategories.length > 0 && (
        <>
          <Typography variant="h6" fontWeight={600} mt={1} mb={2}>
            Advanced Tools
          </Typography>
          {advancedCategories.map((category) => (
            <Accordion key={category.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {category.title}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  {category.commands.map((command) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={command.id}>
                      {renderCommandCard(command)}
                    </Grid>
                  ))}
                </Grid>
              </AccordionDetails>
            </Accordion>
          ))}
        </>
      )}

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

      <Snackbar
        open={!!success}
        autoHideDuration={4000}
        onClose={clearMessages}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={clearMessages} variant="filled">
          {success}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={clearMessages}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={clearMessages} variant="filled">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AdminTools;
