import React, { useState, useEffect } from 'react';
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
  Autocomplete,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ErrorIcon from '@mui/icons-material/Error';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../utils/api';
import type { Server } from '../../types';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useTranslation } from 'react-i18next';

interface BatchServerModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  existingServers?: Server[];
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
  serverCanReachApi?: boolean; // Whether server can reach API (Server -> API)
}

const formatVerificationError = (error?: string): string | undefined => {
  if (!error) return undefined;

  // If backend returned a JSON blob (e.g. full RCON response), try to extract the useful bit
  try {
    const parsed: unknown = JSON.parse(error);
    if (parsed && typeof parsed === 'object') {
      // Prefer a concise message if available
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof (parsed as { error?: string }).error === 'string'
      ) {
        return (parsed as { error?: string }).error;
      }
      // Fall back to pretty-printed JSON
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Not JSON, fall through to raw string
  }

  return error;
};

const getDefaultPorts = (baseId: string, existingServers: Server[] | undefined, count: number): string[] => {
  const trimmedBaseId = baseId.trim();

  // Count how many servers already exist with this base ID (id like "base_1", "base_2", ...).
  // We then offset the starting port by that count so new servers continue the same 10-port pattern.
  let existingCountForBaseId = 0;
  if (trimmedBaseId && existingServers && existingServers.length > 0) {
    const idPrefix = `${trimmedBaseId}_`;
    existingCountForBaseId = existingServers.filter((s) => s.id.startsWith(idPrefix)).length;
  }

  const basePort = 27015 + existingCountForBaseId * 10;
  const validCount = Math.min(Math.max(count, 1), 50);

  return Array.from({ length: validCount }, (_, idx) => String(basePort + idx * 10));
};

export default function BatchServerModal({
  open,
  onClose,
  onSave,
  existingServers,
}: BatchServerModalProps) {
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [baseName, setBaseName] = useState('');
  const [baseId, setBaseId] = useState('');
  const [host, setHost] = useState('');
  const [count, setCount] = useState('3');
  const [ports, setPorts] = useState<string[]>(() =>
    getDefaultPorts('', existingServers, parseInt('3', 10))
  );
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationStatuses, setVerificationStatuses] = useState<Map<number, ServerVerification>>(
    new Map()
  );
  const { t } = useTranslation();

  const resetForm = () => {
    setBaseName('');
    setBaseId('');
    setHost('');
    setCount('3');
    setPorts(getDefaultPorts('', existingServers, 3));
    setPassword('');
    setEnabled(true);
    setError('');
    setVerificationStatuses(new Map());
  };

  // Update ports array when count changes
  const handleCountChange = (newCount: string) => {
    setCount(newCount);
    const countNum = parseInt(newCount) || 3;
    setPorts(getDefaultPorts(baseId, existingServers, countNum));
  };

  const handlePortChange = (index: number, value: string) => {
    setPorts((prevPorts) => {
      const newPorts = [...prevPorts];
      newPorts[index] = value;
      return newPorts;
    });
  };

  const handleBaseIdChange = (value: string) => {
    setBaseId(value);
    const countNum = parseInt(count) || 3;
    setPorts(getDefaultPorts(value, existingServers, countNum));
  };

  // Update ports when host changes - increment based on existing servers with that IP
  useEffect(() => {
    const trimmedHost = host.trim();
    const countNum = parseInt(count) || 3;
    
    if (!trimmedHost || !existingServers || existingServers.length === 0) {
      // If no host or no existing servers, use default ports based on baseId
      setPorts(getDefaultPorts(baseId, existingServers, countNum));
      return;
    }

    // Count how many existing servers have this IP
    const serversWithHost = existingServers.filter((s) => s.host === trimmedHost);
    const existingCountForHost = serversWithHost.length;

    // Start from base port (27015) + increment by 10 for each existing server
    // This ensures new servers continue the pattern after existing ones
    const basePort = 27015 + existingCountForHost * 10;
    const newPorts = Array.from({ length: countNum }, (_, idx) => String(basePort + idx * 10));
    
    setPorts(newPorts);
  }, [host, count, baseId, existingServers]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCheckServers = async () => {
    // Validation
    if (!baseName.trim()) {
      setError(t('batchServerModal.errors.baseNameRequired'));
      return;
    }

    if (!baseId.trim()) {
      setError(t('batchServerModal.errors.baseIdRequired'));
      return;
    }

    if (!host.trim()) {
      setError(t('batchServerModal.errors.hostRequired'));
      return;
    }

    const serverCount = parseInt(count);
    if (isNaN(serverCount) || serverCount < 1 || serverCount > 50) {
      setError(t('batchServerModal.errors.countRange'));
      return;
    }

    if (!password.trim()) {
      setError(t('batchServerModal.errors.passwordRequired'));
      return;
    }

    // Validate all ports
    for (let i = 0; i < serverCount; i++) {
      const portNum = parseInt(ports[i]);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        setError(
          t('batchServerModal.errors.portRange', {
            index: i + 1,
          })
        );
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
        const result = await api.post<{ success: boolean; error?: string; serverCanReachApi?: boolean }>(
          '/api/rcon/test-connection',
          {
            host: host.trim(),
            port: portNum,
            password: password.trim(),
            name: serverName,
          }
        );

        newStatuses.set(i, {
          index: i,
          status: result.success ? 'success' : 'error',
          error: result.error,
          serverCanReachApi: result.serverCanReachApi,
        });
      } catch (err) {
        const error = err as { response?: { data?: { error?: string } }; message?: string };
        newStatuses.set(i, {
          index: i,
          status: 'error',
          error:
            error.response?.data?.error ||
            error.message ||
            t('batchServerModal.errors.connectionFailed'),
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
      showWarning(t('batchServerModal.errors.baseNameRequired'));
      return;
    }

    if (!baseId.trim()) {
      showWarning(t('batchServerModal.errors.baseIdRequired'));
      return;
    }

    if (!host.trim()) {
      showWarning(t('batchServerModal.errors.hostRequired'));
      return;
    }

    const serverCount = parseInt(count);
    if (isNaN(serverCount) || serverCount < 1 || serverCount > 50) {
      showWarning(t('batchServerModal.errors.countRange'));
      return;
    }

    if (!password.trim()) {
      showWarning(t('batchServerModal.errors.passwordRequired'));
      return;
    }

    // Validate all ports
    for (let i = 0; i < serverCount; i++) {
      const portNum = parseInt(ports[i]);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        showWarning(
          t('batchServerModal.errors.portRange', {
            index: i + 1,
          })
        );
        return;
      }
    }

    // Connectivity verification is recommended but not mandatory.
    // If some servers failed verification, warn the admin but allow pre-saving
    // so servers can be configured ahead of time (e.g. before LAN setup is online).
    if (!allServersVerified()) {
      showWarning(
        t('batchServerModal.warnings.notAllVerified')
      );
    }

    setSaving(true);

    try {
      const servers: ServerConfig[] = [];

      // Determine starting index based on existing servers with the same base ID
      const trimmedBaseId = baseId.trim();
      const trimmedBaseName = baseName.trim();
      const idPrefix = `${trimmedBaseId}_`;

      let existingMaxIndex = 0;
      if (existingServers && existingServers.length > 0 && trimmedBaseId) {
        for (const existing of existingServers) {
          if (existing.id.startsWith(idPrefix)) {
            const suffix = existing.id.slice(idPrefix.length);
            const index = parseInt(suffix, 10);
            if (!Number.isNaN(index) && index > existingMaxIndex) {
              existingMaxIndex = index;
            }
          }
        }
      }

      // Check for existing servers with the same IP/host
      const trimmedHost = host.trim();
      const existingServersByHost = existingServers?.filter((s) => s.host === trimmedHost) || [];

      // Generate server configs
      for (let i = 1; i <= serverCount; i++) {
        const index = existingMaxIndex + i;
        const portNum = parseInt(ports[i - 1]);
        
        // Check if a server with this IP and port already exists (check ALL servers, not just those with matching ID prefix)
        const existingServerWithPort = existingServersByHost.find((s) => s.port === portNum);
        
        // If a server with this IP:port exists, use its ID to update it
        // Otherwise, generate a new ID based on the base ID pattern
        let serverId: string;
        let serverName: string;
        
        if (existingServerWithPort) {
          // Server already exists with this IP:port - use its ID and name to update it
          serverId = existingServerWithPort.id;
          serverName = existingServerWithPort.name;
        } else {
          // No existing server with this IP:port - generate new ID and name
          serverId = `${trimmedBaseId}_${index}`;
          serverName = `${trimmedBaseName} #${index}`;
        }
        
        const server: ServerConfig = {
          id: serverId,
          name: serverName,
          host: trimmedHost,
          port: portNum,
          password: password.trim(),
          enabled,
        };
        servers.push(server);
      }

      // Create/update all servers
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
        showSuccess(
          t('batchServerModal.success.createdAll', {
            count: successCount,
          })
        );
        onSave();
        handleClose();
      } else {
        const errorMessage = t('batchServerModal.errors.partialCreate', {
          created: successCount,
          total: serverCount,
          details: errors.join('\n'),
        });
        setError(errorMessage);
        showError(errorMessage);
      }
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('batchServerModal.errors.createFailed');
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
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
        handleClose();
      }}
      maxWidth="md"
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {t('batchServerModal.title')}
        </Typography>
        <IconButton
          onClick={handleClose}
          size="small"
          aria-label="close"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
        <Stack spacing={3}>
          <Alert severity="info">
            {t('batchServerModal.info')}
          </Alert>

          {/* Server Identification Group */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
              {t('batchServerModal.sections.identification.title')}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label={t('batchServerModal.baseId.label')}
                value={baseId}
                onChange={(e) => handleBaseIdChange(e.target.value)}
                placeholder={t('batchServerModal.baseId.placeholder')}
                helperText={t('batchServerModal.baseId.helper')}
                required
                fullWidth
              />

              <TextField
                label={t('batchServerModal.baseName.label')}
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                placeholder={t('batchServerModal.baseName.placeholder')}
                helperText={t('batchServerModal.baseName.helper')}
                required
                fullWidth
              />
            </Stack>
          </Box>

          <Divider />

          {/* Connection Settings Group */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
              {t('batchServerModal.sections.connection.title')}
            </Typography>
            <Stack spacing={2}>
              <Autocomplete
                freeSolo
                options={Array.from(new Set((existingServers || []).map((s) => s.host))).sort()}
                value={host}
                onInputChange={(_, newValue) => {
                  setHost(newValue);
                  // Reset verification when host changes
                  setVerificationStatuses(new Map());
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('batchServerModal.host.label')}
                    placeholder={t('batchServerModal.host.placeholder')}
                    required
                  />
                )}
              />

              <TextField
                label={t('batchServerModal.rconPassword.label')}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // Reset verification when password changes
                  setVerificationStatuses(new Map());
                }}
                placeholder={t('batchServerModal.rconPassword.placeholder')}
                type={showPassword ? 'text' : 'password'}
                required
                fullWidth
                helperText={t('batchServerModal.rconPassword.helper')}
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
              {t('batchServerModal.sections.configuration.title')}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label={t('batchServerModal.numServers.label')}
                value={count}
                onChange={(e) => handleCountChange(e.target.value)}
                placeholder={t('batchServerModal.numServers.placeholder')}
                type="number"
                required
                fullWidth
                helperText={t('batchServerModal.numServers.helper')}
                slotProps={{
                  htmlInput: { min: 1, max: 50 },
                }}
              />

              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight={500} gutterBottom>
                    {t('batchServerModal.assignPorts.label')}
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <ArrowUpwardIcon fontSize="small" color="primary" />
                    <Typography variant="caption" color="text.secondary">
                      {t('batchServerModal.assignPorts.helper')}
                    </Typography>
                  </Box>
                </Box>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {Array.from({ length: serverCount }, (_, i) => {
                    const verification = verificationStatuses.get(i);
                    const status = verification?.status || 'pending';
                    return (
                      <Grid size={{ xs: 6, sm: 4, md: 3 }} key={i}>
                        <TextField
                          label={t('batchServerModal.serverPortLabel', { index: i + 1 })}
                          value={ports[i] || ''}
                          onChange={(e) => {
                            handlePortChange(i, e.target.value);
                            // Reset verification when port changes
                            const newStatuses = new Map(verificationStatuses);
                            newStatuses.delete(i);
                            setVerificationStatuses(newStatuses);
                          }}
                          placeholder={t('batchServerModal.portPlaceholder')}
                          type="number"
                          required
                          fullWidth
                          size="small"
                          FormHelperTextProps={{
                            sx: {
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              mt: 0.25,
                            },
                          }}
                          slotProps={{
                            htmlInput: { min: 1, max: 65535 },
                          }}
                          InputProps={{
                            endAdornment:
                              status === 'checking' ? (
                                <CircularProgress size={16} />
                              ) : status === 'success' ? (
                                <Box display="flex" alignItems="center" gap={0.5}>
                                  <ArrowUpwardIcon color="success" fontSize="small" />
                                  {verification?.serverCanReachApi === true && (
                                    <ArrowDownwardIcon color="success" fontSize="small" />
                                  )}
                                  {verification?.serverCanReachApi === false && (
                                    <ArrowDownwardIcon color="error" fontSize="small" />
                                  )}
                                </Box>
                              ) : status === 'error' ? (
                                <ErrorIcon color="error" fontSize="small" />
                              ) : null,
                          }}
                          helperText={
                            verification?.status === 'error'
                              ? formatVerificationError(verification.error)
                              : verification?.status === 'success' && verification.serverCanReachApi === false
                              ? 'API → Server: OK • Server → API: Failed (check firewall/webhook config)'
                              : verification?.status === 'success' && verification.serverCanReachApi === true
                              ? 'API → Server: OK • Server → API: OK'
                              : undefined
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
                    {t('batchServerModal.enabled.label')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('batchServerModal.enabled.helper')}
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
                  {t('batchServerModal.preview.title', {
                    visible: preview.length,
                    total: parseInt(count) > 10 ? parseInt(count) : preview.length,
                    showingFirst10: parseInt(count) > 10,
                  })}
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
                        {t('batchServerModal.preview.more', {
                          count: parseInt(count) - 10,
                        })}
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
          {verifying
            ? t('batchServerModal.checkServersButton.checking')
            : t('batchServerModal.checkServersButton.default')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          sx={{
            ml: 'auto',
          }}
        >
          {saving
            ? t('batchServerModal.createServersButton.creating')
            : t('batchServerModal.createServersButton.default', {
                count: parseInt(count) || 0,
              })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
