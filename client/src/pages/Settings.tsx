import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  Alert,
  LinearProgress,
  InputAdornment,
  IconButton,
  Tooltip,
  Divider,
  CircularProgress,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';

const STEAM_API_DOC_URL = 'https://steamcommunity.com/dev/apikey';

export default function Settings() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [steamApiKey, setSteamApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSteamKey, setShowSteamKey] = useState(false);
  const [syncingMaps, setSyncingMaps] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response: SettingsResponse = await api.get('/api/settings');
      setWebhookUrl(response.settings.webhookUrl ?? '');
      setSteamApiKey(response.settings.steamApiKey ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Settings';
    void fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        webhookUrl: webhookUrl.trim() === '' ? null : webhookUrl.trim(),
        steamApiKey: steamApiKey.trim() === '' ? null : steamApiKey.trim(),
      };

      const response: SettingsResponse = await api.put('/api/settings', payload);
      setWebhookUrl(response.settings.webhookUrl ?? '');
      setSteamApiKey(response.settings.steamApiKey ?? '');
      setSuccess('Settings saved successfully');
      window.dispatchEvent(
        new CustomEvent<SettingsResponse['settings']>('matchzy:settingsUpdated', {
          detail: response.settings,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncMaps = async () => {
    setSyncingMaps(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await api.post<{
        success: boolean;
        message: string;
        stats: { total: number; added: number; skipped: number; errors: number };
        errors?: string[];
      }>('/api/maps/sync');

      if (response.success) {
        setSuccess(
          `Map sync completed! ${response.stats.added} new map(s) added, ${response.stats.skipped} already existed.`
        );
        if (response.errors && response.errors.length > 0) {
          setError(`Some maps failed to sync: ${response.errors.join(', ')}`);
        }
      } else {
        setError('Failed to sync maps');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync maps';
      setError(message);
    } finally {
      setSyncingMaps(false);
    }
  };


  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <SettingsIcon sx={{ fontSize: 40, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure webhook endpoints and integrations used across tournaments.
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <Tooltip title="Reload settings" arrow>
            <span>
              <IconButton onClick={fetchSettings} disabled={loading || saving}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <LinearProgress />
        </Paper>
      )}

      {!loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Stack spacing={3}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" onClose={() => setSuccess(null)}>
                {success}
              </Alert>
            )}

            <Box>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Webhook URL
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                This URL is used when configuring MatchZy webhooks and demo uploads. It should be
                reachable from your CS2 servers.
              </Typography>
              <TextField
                label="Webhook Base URL"
                placeholder="https://your-domain.com"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                fullWidth
                helperText="Matches and servers will call this URL for webhook events and demo uploads"
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Steam API Key
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Used to resolve vanity URLs and fetch player profiles. Leave blank to disable Steam
                lookups.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems="flex-center" spacing={1}>
                <TextField
                  label="Steam Web API Key"
                  placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  value={steamApiKey}
                  onChange={(event) => setSteamApiKey(event.target.value)}
                  type={showSteamKey ? 'text' : 'password'}
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowSteamKey((prev) => !prev)} edge="end">
                          {showSteamKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <IconButton
                  href={STEAM_API_DOC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="primary"
                  sx={{ width: '56px' }}
                >
                  <OpenInNewIcon />
                </IconButton>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Map Management
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Sync CS2 maps from the GitHub repository. Only new maps will be added; existing maps
                will be skipped.
              </Typography>
              <Button
                variant="outlined"
                startIcon={syncingMaps ? <CircularProgress size={16} /> : <SyncIcon />}
                onClick={handleSyncMaps}
                disabled={syncingMaps || loading}
              >
                {syncingMaps ? 'Syncing Maps...' : 'Sync CS2 Maps'}
              </Button>
            </Box>

            <Box display="flex" gap={2}>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
              <Button onClick={fetchSettings} disabled={loading || saving}>
                Reset
              </Button>
            </Box>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
