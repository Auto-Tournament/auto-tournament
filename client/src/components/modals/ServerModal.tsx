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
import type { Server as ApiServer, ServerStatusResponse } from '../../types/api.types';
import ConfirmDialog from './ConfirmDialog';

interface ServerModalProps {
  open: boolean;
  server: ApiServer | null;
  servers: ApiServer[]; // All existing servers for duplicate checking
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
  const [chatPrefix, setChatPrefix] = useState<string>('');
  const [adminChatPrefix, setAdminChatPrefix] = useState<string>('');
  const [knifeEnabledDefault, setKnifeEnabledDefault] = useState<boolean | null>(null);
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
      setChatPrefix(server.matchzyConfig?.chatPrefix ?? '');
      setAdminChatPrefix(server.matchzyConfig?.adminChatPrefix ?? '');
      setKnifeEnabledDefault(
        server.matchzyConfig?.knifeEnabledDefault ?? null
      );
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
    setChatPrefix('');
    setAdminChatPrefix('');
    setKnifeEnabledDefault(null);
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
        matchzyConfig: {
          chatPrefix: chatPrefix.trim() || null,
          adminChatPrefix: adminChatPrefix.trim() || null,
          knifeEnabledDefault,
        },
      };

      if (isEditing) {
        await api.put(`/api/servers/${server.id}`, {
          name: payload.name,
          host: payload.host,
          port: payload.port,
          password: payload.password,
          enabled: payload.enabled,
          matchzyConfig: payload.matchzyConfig,
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
              slotProps={{
                htmlInput: { 'data-testid': 'server-name-input' },
              }}
            />

            <TextField
              label="Host / IP Address"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-host-input' },
              }}
            />

            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="27015"
              type="number"
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-port-input' },
              }}
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
              slotProps={{
                htmlInput: { 'data-testid': 'server-password-input' },
              }}
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

            <Box mt={1}>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                MatchZy Overrides (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                These settings override the global MatchZy defaults for this server only. Leave blank
                to use global values from Settings.
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <TextField
                  label="Chat Prefix Override"
                  value={chatPrefix}
                  onChange={(e) => setChatPrefix(e.target.value)}
                  placeholder="[MatchZy]"
                  fullWidth
                  helperText="Overrides matchzy_chat_prefix on this server (optional)"
                />
                <TextField
                  label="Admin Chat Prefix Override"
                  value={adminChatPrefix}
                  onChange={(e) => setAdminChatPrefix(e.target.value)}
                  placeholder="[ADMIN]"
                  fullWidth
                  helperText="Overrides matchzy_admin_chat_prefix on this server (optional)"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={knifeEnabledDefault === true}
                      indeterminate={knifeEnabledDefault === null}
                      onChange={(e) =>
                        setKnifeEnabledDefault(
                          e.target.checked ? true : knifeEnabledDefault === null ? false : null
                        )
                      }
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        Knife Round Enabled by Default (override)
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        When set, overrides matchzy_knife_enabled_default for this server. Leave in
                        indeterminate state to use global default.
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            </Box>

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
