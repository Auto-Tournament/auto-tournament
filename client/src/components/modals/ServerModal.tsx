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
  Switch,
  FormControlLabel,
  InputAdornment,
  IconButton,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { ServerStatusResponse } from '../../types/api.types';
import ConfirmDialog from './ConfirmDialog';

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
  servers: Server[]; // All existing servers for duplicate checking
  onClose: () => void;
  onSave: () => void;
}

const slugifyServerName = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

export default function ServerModal({ open, server, servers, onClose, onSave }: ServerModalProps) {
  const { showSuccess, showError } = useSnackbar();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('27015');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!server;

  useEffect(() => {
    if (server) {
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
    setName('');
    setHost('');
    setPort('27015');
    setPassword('');
    setEnabled(true);
    setError('');
    setTestResult(null);
  };

  const handleNameChange = (value: string) => {
    setName(value);
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
      const response = await api.get<ServerStatusResponse>(`/api/servers/${server.id}/status`);
      setTestResult(response.status === 'online' ? 'success' : 'error');
    } catch {
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

    const generatedId = isEditing ? server.id : slugifyServerName(name);
    if (!generatedId) {
      setError('Unable to generate server ID. Please adjust the server name.');
      return;
    }

    if (!isEditing && servers.some((existing) => existing.id === generatedId)) {
      setError(`Server name creates duplicate ID '${generatedId}'. Choose a different name.`);
      return;
    }

    // Check for duplicate host:port combination
    const duplicate = servers.find(
      (s) => s.host === host.trim() && s.port === portNum && s.id !== (isEditing ? server?.id : '') // Exclude current server when editing
    );

    if (duplicate) {
      setError(
        `A server with host:port '${host.trim()}:${portNum}' already exists (ID: ${
          duplicate.id
        }, Name: ${duplicate.name})`
      );
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: generatedId,
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
        showSuccess('Server updated successfully');
      } else {
        await api.post('/api/servers?upsert=true', payload);
        showSuccess('Server created successfully');
      }

      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || 'Failed to save server';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!server) return;
    setConfirmDeleteOpen(false);

    setSaving(true);
    try {
      await api.delete(`/api/servers/${server.id}`);
      showSuccess('Server deleted successfully');
      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || 'Failed to delete server';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="server-modal">
        <DialogTitle>{isEditing ? 'Edit Server' : 'Add Server'}</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Server Name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Match Server #1"
              required
              fullWidth
              inputProps={{ 'data-testid': 'server-name-input' }}
            />

            <TextField
              label="Host / IP Address"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              required
              fullWidth
              inputProps={{ 'data-testid': 'server-host-input' }}
            />

            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="27015"
              type="number"
              required
              fullWidth
              inputProps={{ 'data-testid': 'server-port-input' }}
            />

            <TextField
              label="RCON Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="your-rcon-password"
              type={showPassword ? 'text' : 'password'}
              required
              fullWidth
              helperText="Password for RCON access to the server"
              inputProps={{ 'data-testid': 'server-password-input' }}
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

            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Server Enabled
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Disabled servers won&apos;t be used for matches
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
            <Button
              data-testid="server-delete-button"
              onClick={handleDeleteClick}
              color="error"
              disabled={saving}
              sx={{ mr: 'auto' }}
            >
              Delete Server
            </Button>
          )}
          {isEditing && (
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            data-testid="server-save-button"
            onClick={handleSave}
            variant="contained"
            disabled={saving}
            sx={{ ml: isEditing ? 0 : 'auto' }}
          >
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Server'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Server"
        message={`Are you sure you want to delete "${server?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        confirmColor="error"
      />
    </>
  );
}
