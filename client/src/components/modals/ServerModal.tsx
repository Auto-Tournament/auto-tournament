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
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { Server as ApiServer, ServerStatusResponse } from '../../types/api.types';
import ConfirmDialog from './ConfirmDialog';
import { useTranslation } from 'react-i18next';

interface ServerModalProps {
  open: boolean;
  server: ApiServer | null;
  servers: ApiServer[]; // All existing servers for duplicate checking
  onClose: () => void;
  onSave: () => void;
}

const slugifyServerName = (name: string): string => {
  const base = name
    .toLowerCase()
    .trim()
    // Keep all letters and numbers from any language, plus spaces/underscores/hyphens.
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return base || `server_${Date.now().toString(36)}`;
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
  const [apiToServerOk, setApiToServerOk] = useState<boolean | null>(null);
  const [serverToApiOk, setServerToApiOk] = useState<boolean | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!server;
  const { t } = useTranslation();

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
    setApiToServerOk(null);
    setServerToApiOk(null);
  };

  const handleNameChange = (value: string) => {
    setName(value);
  };

  const handleTestConnection = async () => {
    if (!server?.id) {
      setError(t('serverModal.errors.testConnectionSaveFirst'));
      return;
    }

    setTesting(true);
    setApiToServerOk(null);
    setServerToApiOk(null);
    setError('');

    try {
      const response = await api.get<ServerStatusResponse>(`/api/servers/${server.id}/status`);
      const canReach = response.status === 'online';
      const serverBack = response.serverCanReachApi === true;

      setApiToServerOk(canReach);
      setServerToApiOk(serverBack);

      if (canReach && serverBack) {
        showSuccess(t('serverModal.success.connectivityOk'));
      } else if (canReach && !serverBack) {
        showError(t('serverModal.errors.rconReachableApiUnreachable'));
      } else {
        showError(t('serverModal.errors.serverOffline'));
      }
    } catch {
      setError(t('serverModal.errors.testConnectionFailed'));
      setApiToServerOk(false);
      setServerToApiOk(false);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('serverModal.errors.nameRequired'));
      return;
    }

    if (!host.trim()) {
      setError(t('serverModal.errors.hostRequired'));
      return;
    }

    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError(t('serverModal.errors.portInvalid'));
      return;
    }

    if (!password.trim()) {
      setError(t('serverModal.errors.rconRequired'));
      return;
    }

    const generatedId = isEditing ? server.id : slugifyServerName(name);
    if (!generatedId) {
      setError(t('serverModal.errors.idGenerationFailed'));
      return;
    }

    if (!isEditing && servers.some((existing) => existing.id === generatedId)) {
      setError(t('serverModal.errors.duplicateId', { id: generatedId }));
      return;
    }

    // Check for duplicate host:port combination
    const duplicate = servers.find(
      (s) => s.host === host.trim() && s.port === portNum && s.id !== (isEditing ? server?.id : '') // Exclude current server when editing
    );

    if (duplicate) {
      setError(
        t('serverModal.errors.duplicateHostPort', {
          host: host.trim(),
          port: portNum,
          id: duplicate.id,
          name: duplicate.name,
        })
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
        showSuccess(t('serverModal.success.serverUpdated'));
      } else {
        await api.post('/api/servers?upsert=true', payload);
        showSuccess(t('serverModal.success.serverCreated'));
      }

      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('serverModal.errors.saveFailed');
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
      showSuccess(t('serverModal.success.serverDeleted'));
      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('serverModal.errors.deleteFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Prevent accidental closes via backdrop or ESC; require explicit Cancel/X.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        data-testid="server-modal"
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
            {isEditing ? t('serverModal.titleEdit') : t('serverModal.titleCreate')}
          </Typography>
          <IconButton onClick={onClose} size="small" aria-label="close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('serverModal.serverNameLabel')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('serverModal.serverNamePlaceholder')}
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-name-input' },
              }}
            />

            <TextField
              label={t('serverModal.hostLabel')}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t('serverModal.hostPlaceholder')}
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-host-input' },
              }}
            />

            <TextField
              label={t('serverModal.portLabel')}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={t('serverModal.portPlaceholder')}
              type="number"
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-port-input' },
              }}
            />

            <TextField
              label={t('serverModal.rconPasswordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('serverModal.rconPasswordPlaceholder')}
              type={showPassword ? 'text' : 'password'}
              required
              fullWidth
              helperText={t('serverModal.rconPasswordHelper')}
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
                    {t('serverModal.enabledLabel')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('serverModal.enabledHelper')}
                  </Typography>
                </Box>
              }
            />

            <Box mt={1}>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {t('serverModal.overridesTitle')}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {t('serverModal.overridesDescription')}
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <TextField
                  label={t('serverModal.chatPrefixLabel')}
                  value={chatPrefix}
                  onChange={(e) => setChatPrefix(e.target.value)}
                  placeholder={t('serverModal.chatPrefixPlaceholder')}
                  fullWidth
                  helperText={t('serverModal.chatPrefixHelper')}
                />
                <TextField
                  label={t('serverModal.adminChatPrefixLabel')}
                  value={adminChatPrefix}
                  onChange={(e) => setAdminChatPrefix(e.target.value)}
                  placeholder={t('serverModal.adminChatPrefixPlaceholder')}
                  fullWidth
                  helperText={t('serverModal.adminChatPrefixHelper')}
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
                        {t('serverModal.knifeOverrideLabel')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('serverModal.knifeOverrideHelper')}
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
                    apiToServerOk && serverToApiOk
                      ? 'success'
                      : apiToServerOk === false || serverToApiOk === false
                      ? 'error'
                      : 'primary'
                  }
                >
                  {testing
                    ? t('serverModal.testingConnectivity')
                    : t('serverModal.testConnectivity')}
                </Button>
                {apiToServerOk !== null && serverToApiOk !== null && !testing && (
                  <Box mt={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <ArrowUpwardIcon
                        fontSize="small"
                        sx={{
                          color: apiToServerOk ? 'success.main' : 'error.main',
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {t('serverModal.connectivity.apiToServer')}{' '}
                        <strong style={{ color: apiToServerOk ? '#2e7d32' : '#d32f2f' }}>
                          {apiToServerOk
                            ? t('serverModal.connectivity.reachable')
                            : t('serverModal.connectivity.unreachable')}
                        </strong>
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                      <ArrowDownwardIcon
                        fontSize="small"
                        sx={{
                          color: serverToApiOk ? 'success.main' : 'error.main',
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {t('serverModal.connectivity.serverToApi')}{' '}
                        <strong style={{ color: serverToApiOk ? '#2e7d32' : '#d32f2f' }}>
                          {serverToApiOk
                            ? t('serverModal.connectivity.reachable')
                            : t('serverModal.connectivity.unreachable')}
                        </strong>
                      </Typography>
                    </Box>
                  </Box>
                )}
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
              {t('serverModal.buttons.deleteServer')}
            </Button>
          )}
          {isEditing && (
            <Button onClick={onClose} disabled={saving}>
              {t('serverModal.buttons.cancel')}
            </Button>
          )}
          <Button
            data-testid="server-save-button"
            onClick={handleSave}
            variant="contained"
            disabled={saving}
            sx={{ ml: isEditing ? 0 : 'auto' }}
          >
            {saving
              ? t('serverModal.buttons.saving')
              : isEditing
              ? t('serverModal.buttons.saveChanges')
              : t('serverModal.buttons.addServer')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('serverModal.confirmDelete.title')}
        message={t('serverModal.confirmDelete.message', { name: server?.name })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        confirmColor="error"
      />
    </>
  );
}
