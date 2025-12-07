import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  FormControlLabel,
  Switch,
  Divider,
  Stack,
  Paper,
  Chip,
  InputAdornment,
  IconButton,
  CircularProgress,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface BatchServerModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: boolean;
}

type ServerVerificationStatus = 'pending' | 'checking' | 'success' | 'error';

interface ServerVerification {
  index: number;
  status: ServerVerificationStatus;
  error?: string;
}

export default function BatchServerModal({ open, onClose, onSave }: BatchServerModalProps) {
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [baseName, setBaseName] = useState('');
  const [baseId, setBaseId] = useState('');
  const [host, setHost] = useState('');
  const [count, setCount] = useState('3');
  const [ports, setPorts] = useState<string[]>(['27015', '27025', '27035']);
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationStatuses, setVerificationStatuses] = useState<Map<number, ServerVerification>>(new Map());

  const resetForm = () => {
    setBaseName('');
    setBaseId('');
    setHost('');
    setCount('3');
    setPorts(['27015', '27025', '27035']);
    setPassword('');
    setEnabled(true);
    setError('');
    setVerificationStatuses(new Map());
  };

  // Update ports array when count changes
  const handleCountChange = (newCount: string) => {
    setCount(newCount);
    const countNum = parseInt(newCount) || 3;
    const validCount = Math.min(Math.max(countNum, 1), 50);

    // Adjust ports array
    setPorts((prevPorts) => {
      const newPorts = [...prevPorts];
      // Get the base port (first port or default to 27015)
      const basePort = parseInt(newPorts[0]) || 27015;

      // Generate ports incrementing by 10
      while (newPorts.length < validCount) {
        const portIndex = newPorts.length;
        const portValue = basePort + portIndex * 10;
        newPorts.push(String(portValue));
      }
      // Remove excess ports
      return newPorts.slice(0, validCount);
    });
  };

  const handlePortChange = (index: number, value: string) => {
    setPorts((prevPorts) => {
      const newPorts = [...prevPorts];
      newPorts[index] = value;
      return newPorts;
    });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCheckServers = async () => {
    // Validation
    if (!baseName.trim()) {
      setError('Base name is required');
      return;
    }

    if (!baseId.trim()) {
      setError('Base ID is required');
      return;
    }

    if (!host.trim()) {
      setError('Host is required');
      return;
    }

    const serverCount = parseInt(count);
    if (isNaN(serverCount) || serverCount < 1 || serverCount > 50) {
      setError('Number of servers must be between 1 and 50');
      return;
    }

    if (!password.trim()) {
      setError('RCON password is required');
      return;
    }

    // Validate all ports
    for (let i = 0; i < serverCount; i++) {
      const portNum = parseInt(ports[i]);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        setError(`Server #${i + 1} port must be between 1 and 65535`);
        return;
      }
    }

    setVerifying(true);
    setError('');
    const newStatuses = new Map<number, ServerVerification>();

    // Initialize all as checking
    for (let i = 0; i < serverCount; i++) {
      newStatuses.set(i, { index: i, status: 'checking' });
    }
    setVerificationStatuses(newStatuses);

    // Test each server
    const testPromises = Array.from({ length: serverCount }, async (_, i) => {
      const portNum = parseInt(ports[i]);
      const serverName = `${baseName.trim()} #${i + 1}`;

      try {
        const result = await api.post('/api/rcon/test-connection', {
          host: host.trim(),
          port: portNum,
          password: password.trim(),
          name: serverName,
        });

        newStatuses.set(i, {
          index: i,
          status: result.success ? 'success' : 'error',
          error: result.error,
        });
      } catch (err) {
        const error = err as { response?: { data?: { error?: string } }; message?: string };
        newStatuses.set(i, {
          index: i,
          status: 'error',
          error: error.response?.data?.error || error.message || 'Connection failed',
        });
      }
    });

    await Promise.all(testPromises);
    setVerificationStatuses(new Map(newStatuses));
    setVerifying(false);
  };

  const allServersVerified = () => {
    const serverCount = parseInt(count) || 0;
    if (serverCount === 0) return false;

    for (let i = 0; i < serverCount; i++) {
      const status = verificationStatuses.get(i);
      if (!status || status.status !== 'success') {
        return false;
      }
    }
    return true;
  };

  const handleSave = async () => {
    // Validation
    if (!baseName.trim()) {
      showWarning('Base name is required');
      return;
    }

    if (!baseId.trim()) {
      showWarning('Base ID is required');
      return;
    }

    if (!host.trim()) {
      showWarning('Host is required');
      return;
    }

    const serverCount = parseInt(count);
    if (isNaN(serverCount) || serverCount < 1 || serverCount > 50) {
      showWarning('Number of servers must be between 1 and 50');
      return;
    }

    if (!password.trim()) {
      showWarning('RCON password is required');
      return;
    }

    // Validate all ports
    for (let i = 0; i < serverCount; i++) {
      const portNum = parseInt(ports[i]);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        showWarning(`Server #${i + 1} port must be between 1 and 65535`);
        return;
      }
    }

    if (!allServersVerified()) {
      showWarning('Please verify all servers before creating');
      return;
    }

    setSaving(true);

    try {
      const servers: ServerConfig[] = [];

      // Generate server configs
      for (let i = 1; i <= serverCount; i++) {
        const portNum = parseInt(ports[i - 1]);
        const server: ServerConfig = {
          id: `${baseId.trim()}_${i}`,
          name: `${baseName.trim()} #${i}`,
          host: host.trim(),
          port: portNum,
          password: password.trim(),
          enabled,
        };
        servers.push(server);
      }

      // Create all servers
      let successCount = 0;
      const errors: string[] = [];

      for (const server of servers) {
        try {
          await api.post('/api/servers?upsert=true', server);
          successCount++;
        } catch (err) {
          const error = err as Error;
          errors.push(`${server.name}: ${error.message}`);
        }
      }

      if (successCount === serverCount) {
        showSuccess(`Successfully created ${successCount} server(s)`);
        onSave();
        handleClose();
      } else {
        const errorMessage = `Created ${successCount}/${serverCount} servers. Errors:\n${errors.join('\n')}`;
        setError(errorMessage);
        showError(errorMessage);
      }
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || 'Failed to create servers';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const previewServers = () => {
    if (!baseId.trim() || !baseName.trim()) return [];

    const serverCount = parseInt(count) || 3;

    return Array.from({ length: Math.min(serverCount, 10) }, (_, i) => ({
      id: `${baseId.trim()}_${i + 1}`,
      name: `${baseName.trim()} #${i + 1}`,
      port: parseInt(ports[i]) || 0,
    }));
  };

  const preview = previewServers();
  const serverCount = parseInt(count) || 3;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Batch Create Servers</DialogTitle>
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Stack spacing={3}>
          <Alert severity="info">
            Create multiple servers with ports incrementing by 10 (27015, 27025, 27035...).
            Perfect for LAN setups with servers on the same machine.
          </Alert>

          {/* Server Identification Group */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
              Server Identification
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Base ID"
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                placeholder="ntlan"
                helperText="Server IDs will be: base_1, base_2, base_3..."
                required
                fullWidth
              />

              <TextField
                label="Base Name"
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                placeholder="NTLAN"
                helperText="Server names will be: Base #1, Base #2, Base #3..."
                required
                fullWidth
              />
            </Stack>
          </Box>

          <Divider />

          {/* Connection Settings Group */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
              Connection Settings
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Host / IP Address"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  // Reset verification when host changes
                  setVerificationStatuses(new Map());
                }}
                placeholder="192.168.1.100"
                required
                fullWidth
              />

              <TextField
                label="RCON Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // Reset verification when password changes
                  setVerificationStatuses(new Map());
                }}
                placeholder="shared-rcon-password"
                type={showPassword ? 'text' : 'password'}
                required
                fullWidth
                helperText="Same password for all servers"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Stack>
          </Box>

          <Divider />

          {/* Server Configuration Group */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
              Server Configuration
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Number of Servers"
                value={count}
                onChange={(e) => handleCountChange(e.target.value)}
                placeholder="3"
                type="number"
                inputProps={{ min: 1, max: 50 }}
                required
                fullWidth
                helperText="Max: 50"
              />

              <Box>
                <Typography variant="body2" fontWeight={500} gutterBottom>
                  Assign Ports
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {Array.from({ length: serverCount }, (_, i) => {
                    const verification = verificationStatuses.get(i);
                    const status = verification?.status || 'pending';
                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3 }} key={i}>
                        <TextField
                          label={`Server #${i + 1}`}
                          value={ports[i] || ''}
                          onChange={(e) => {
                            handlePortChange(i, e.target.value);
                            // Reset verification when port changes
                            const newStatuses = new Map(verificationStatuses);
                            newStatuses.delete(i);
                            setVerificationStatuses(newStatuses);
                          }}
                          placeholder="27015"
                          type="number"
                          inputProps={{ min: 1, max: 65535 }}
                          required
                          fullWidth
                          size="small"
                          InputProps={{
                            endAdornment: status === 'checking' ? (
                              <CircularProgress size={16} />
                            ) : status === 'success' ? (
                              <CheckCircleIcon color="success" fontSize="small" />
                            ) : status === 'error' ? (
                              <ErrorIcon color="error" fontSize="small" />
                            ) : null,
                          }}
                          helperText={
                            verification?.status === 'error' ? verification.error : undefined
                          }
                          error={verification?.status === 'error'}
                        />
                      </Grid>
                    );
                  })}
                </Grid>
              </Box>
            </Stack>
          </Box>

          <Divider />

          {/* Options Group */}
          <Box>
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Servers Enabled
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    All servers will be created as enabled/disabled
                  </Typography>
                </Box>
              }
            />
          </Box>

          {preview.length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  Preview ({preview.length > 10 ? 'showing first 10' : 'all'})
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Stack spacing={1}>
                    {preview.map((server) => (
                      <Box key={server.id} display="flex" alignItems="center" gap={1}>
                        <Chip label={server.id} size="small" sx={{ minWidth: 100 }} />
                        <Typography variant="body2">
                          {server.name} — {host || 'host'}:{server.port}
                        </Typography>
                      </Box>
                    ))}
                    {parseInt(count) > 10 && (
                      <Typography variant="caption" color="text.secondary">
                        ...and {parseInt(count) - 10} more
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button
          onClick={handleCheckServers}
          variant="outlined"
          disabled={verifying || saving}
          startIcon={verifying ? <CircularProgress size={16} /> : null}
        >
          {verifying ? 'Checking...' : 'Check Servers'}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          sx={{
            ml: 'auto',
            ...(!allServersVerified() && {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
              '&:hover': {
                bgcolor: 'action.disabledBackground',
              },
            }),
          }}
        >
          {saving
            ? 'Creating...'
            : allServersVerified()
            ? `Create ${count} Server${parseInt(count) !== 1 ? 's' : ''}`
            : 'Verify Servers First'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
