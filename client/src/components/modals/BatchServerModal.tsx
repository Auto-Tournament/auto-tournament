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
} from '@mui/material';
import { api } from '../../utils/api';

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

export default function BatchServerModal({ open, onClose, onSave }: BatchServerModalProps) {
  const [baseName, setBaseName] = useState('');
  const [baseId, setBaseId] = useState('');
  const [host, setHost] = useState('');
  const [startPort, setStartPort] = useState('27015');
  const [count, setCount] = useState('3');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const resetForm = () => {
    setBaseName('');
    setBaseId('');
    setHost('');
    setStartPort('27015');
    setCount('3');
    setPassword('');
    setEnabled(true);
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSave = async () => {
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

    const portNum = parseInt(startPort);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('Start port must be between 1 and 65535');
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

    setSaving(true);
    setError('');

    try {
      const servers: ServerConfig[] = [];
      
      // Generate server configs
      for (let i = 1; i <= serverCount; i++) {
        const server: ServerConfig = {
          id: `${baseId.trim()}_${i}`,
          name: `${baseName.trim()} #${i}`,
          host: host.trim(),
          port: portNum + (i - 1),
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
        onSave();
        handleClose();
      } else {
        setError(
          `Created ${successCount}/${serverCount} servers. Errors:\n${errors.join('\n')}`
        );
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to create servers');
    } finally {
      setSaving(false);
    }
  };

  const previewServers = () => {
    if (!baseId.trim() || !baseName.trim()) return [];

    const serverCount = parseInt(count) || 3;
    const portNum = parseInt(startPort) || 27015;

    return Array.from({ length: Math.min(serverCount, 10) }, (_, i) => ({
      id: `${baseId.trim()}_${i + 1}`,
      name: `${baseName.trim()} #${i + 1}`,
      port: portNum + i,
    }));
  };

  const preview = previewServers();

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Batch Create Servers</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2} mt={1}>
          <Alert severity="info">
            Create multiple servers with sequential ports. Perfect for LAN setups with servers on the
            same machine.
          </Alert>

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

          <TextField
            label="Host / IP Address"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.100"
            required
            fullWidth
          />

          <Box display="flex" gap={2}>
            <TextField
              label="Starting Port"
              value={startPort}
              onChange={(e) => setStartPort(e.target.value)}
              placeholder="27015"
              type="number"
              required
              fullWidth
            />

            <TextField
              label="Number of Servers"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="3"
              type="number"
              inputProps={{ min: 1, max: 50 }}
              required
              fullWidth
              helperText="Max: 50"
            />
          </Box>

          <TextField
            label="RCON Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="shared-rcon-password"
            type={showPassword ? 'text' : 'password'}
            required
            fullWidth
            helperText="Same password for all servers"
          />

          <FormControlLabel
            control={<Switch checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />}
            label="Show password"
          />

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
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Creating...' : `Create ${count} Server${parseInt(count) !== 1 ? 's' : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

