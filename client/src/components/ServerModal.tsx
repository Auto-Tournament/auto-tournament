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
  Switch,
  FormControlLabel,
} from '@mui/material';
import { api } from '../utils/api';

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: boolean;
}

interface ServerModalProps {
  open: boolean;
  server: Server | null;
  onClose: () => void;
  onSave: () => void;
}

export default function ServerModal({ open, server, onClose, onSave }: ServerModalProps) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('27015');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const isEditing = !!server;

  useEffect(() => {
    if (server) {
      setId(server.id);
      setName(server.name);
      setHost(server.host);
      setPort(server.port.toString());
      setPassword(server.password);
      setEnabled(server.enabled);
    } else {
      resetForm();
    }
  }, [server, open]);

  const resetForm = () => {
    setId('');
    setName('');
    setHost('');
    setPort('27015');
    setPassword('');
    setEnabled(true);
    setError('');
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!server?.id) {
      setError('Save the server first before testing connection');
      return;
    }

    setTesting(true);
    setTestResult(null);
    setError('');

    try {
      const response = await api.get(`/api/servers/${server.id}/status`);
      setTestResult(response.status === 'online' ? 'success' : 'error');
    } catch (err) {
      setTestResult('error');
      setError('Failed to test connection');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (!isEditing && !id.trim()) {
      setError('Server ID is required');
      return;
    }

    if (!host.trim()) {
      setError('Host is required');
      return;
    }

    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be a valid number between 1 and 65535');
      return;
    }

    if (!password.trim()) {
      setError('RCON password is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: id.trim(),
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        password: password.trim(),
        enabled,
      };

      if (isEditing) {
        await api.put(`/api/servers/${server.id}`, {
          name: payload.name,
          host: payload.host,
          port: payload.port,
          password: payload.password,
          enabled: payload.enabled,
        });
      } else {
        await api.post('/api/servers?upsert=true', payload);
      }

      onSave();
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save server');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!server) return;
    if (!confirm(`Are you sure you want to delete server "${server.name}"?`)) return;

    setSaving(true);
    try {
      await api.delete(`/api/servers/${server.id}`);
      onSave();
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to delete server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? 'Edit Server' : 'Create New Server'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label="Server ID"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={isEditing}
            placeholder="server1"
            helperText={isEditing ? 'ID cannot be changed' : 'Unique identifier for this server'}
            fullWidth
          />

          <TextField
            label="Server Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Match Server #1"
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

          <TextField
            label="Port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="27015"
            type="number"
            required
            fullWidth
          />

          <TextField
            label="RCON Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="your-rcon-password"
            type="password"
            required
            fullWidth
            helperText="Password for RCON access to the server"
          />

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label={
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  Server Enabled
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Disabled servers won't be used for matches
                </Typography>
              </Box>
            }
          />

          {isEditing && (
            <Box>
              <Button
                variant="outlined"
                onClick={handleTestConnection}
                disabled={testing}
                fullWidth
                color={
                  testResult === 'success'
                    ? 'success'
                    : testResult === 'error'
                    ? 'error'
                    : 'primary'
                }
              >
                {testing
                  ? 'Testing...'
                  : testResult === 'success'
                  ? '✓ Connection Successful'
                  : testResult === 'error'
                  ? '✗ Connection Failed'
                  : 'Test RCON Connection'}
              </Button>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        {isEditing && (
          <Button onClick={handleDelete} color="error" disabled={saving} sx={{ mr: 'auto' }}>
            Delete Server
          </Button>
        )}
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Server'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
