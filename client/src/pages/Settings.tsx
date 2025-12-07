import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  LinearProgress,
  InputAdornment,
  IconButton,
  Divider,
  CircularProgress,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SyncIcon from '@mui/icons-material/Sync';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';

const STEAM_API_DOC_URL = 'https://steamcommunity.com/dev/apikey';

export default function Settings() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [steamApiKey, setSteamApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSteamKey, setShowSteamKey] = useState(false);
  const [syncingMaps, setSyncingMaps] = useState(false);
  const [initialWebhookUrl, setInitialWebhookUrl] = useState('');
  const [initialSteamApiKey, setInitialSteamApiKey] = useState('');
  const [defaultPlayerElo, setDefaultPlayerElo] = useState<number | ''>('');
  const [initialDefaultPlayerElo, setInitialDefaultPlayerElo] = useState<number | ''>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);

    try {
      const response: SettingsResponse = await api.get('/api/settings');
      const webhook = response.settings.webhookUrl ?? '';
      const steamKey = response.settings.steamApiKey ?? '';
      const defaultElo = response.settings.defaultPlayerElo ?? 3000;
      setWebhookUrl(webhook);
      setSteamApiKey(steamKey);
      setInitialWebhookUrl(webhook);
      setInitialSteamApiKey(steamKey);
      setDefaultPlayerElo(defaultElo);
      setInitialDefaultPlayerElo(defaultElo);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings';
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    document.title = 'Settings';
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    // No header actions needed for settings page
    setHeaderActions(null);

    return () => {
      setHeaderActions(null);
    };
  }, [setHeaderActions]);

  const handleSave = useCallback(async (showSuccessMessage = true) => {
    setSaving(true);

    // Cancel any pending auto-save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    try {
      const payload = {
        webhookUrl: webhookUrl.trim() === '' ? null : webhookUrl.trim(),
        steamApiKey: steamApiKey.trim() === '' ? null : steamApiKey.trim(),
        defaultPlayerElo:
          defaultPlayerElo === '' ? null : Number.isFinite(defaultPlayerElo) ? defaultPlayerElo : null,
      };

      const response: SettingsResponse = await api.put('/api/settings', payload);
      const newWebhook = response.settings.webhookUrl ?? '';
      const newSteamKey = response.settings.steamApiKey ?? '';
      const newDefaultElo = response.settings.defaultPlayerElo ?? 3000;
      setWebhookUrl(newWebhook);
      setSteamApiKey(newSteamKey);
      setInitialWebhookUrl(newWebhook);
      setInitialSteamApiKey(newSteamKey);
      setDefaultPlayerElo(newDefaultElo);
      setInitialDefaultPlayerElo(newDefaultElo);
      
      if (showSuccessMessage) {
        showSuccess('Settings saved');
      }
      
      window.dispatchEvent(
        new CustomEvent<SettingsResponse['settings']>('matchzy:settingsUpdated', {
          detail: response.settings,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      showError(message);
    } finally {
      setSaving(false);
    }
  }, [webhookUrl, steamApiKey, showSuccess, showError]);

  const handleFieldBlur = () => {
    // Save immediately when field loses focus (if values changed)
    if (
      webhookUrl !== initialWebhookUrl ||
      steamApiKey !== initialSteamApiKey ||
      defaultPlayerElo !== initialDefaultPlayerElo
    ) {
      void handleSave(true); // Show success message
    }
  };

  const handleFieldKeyDown = (event: React.KeyboardEvent) => {
    // Save on Enter key
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSave(true); // Show success message
    }
  };

  // Auto-save when values change
  useEffect(() => {
    // Don't auto-save on initial load
    if (loading) return;
    
    // Don't auto-save if values haven't changed
    if (
      webhookUrl === initialWebhookUrl &&
      steamApiKey === initialSteamApiKey &&
      defaultPlayerElo === initialDefaultPlayerElo
    )
      return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      void handleSave(true); // Auto-save with success message
    }, 1000); // 1 second debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    webhookUrl,
    steamApiKey,
    defaultPlayerElo,
    initialWebhookUrl,
    initialSteamApiKey,
    initialDefaultPlayerElo,
    loading,
    handleSave,
  ]);

  const handleSyncMaps = async () => {
    setSyncingMaps(true);

    try {
      const response = await api.post<{
        success: boolean;
        message?: string;
        stats?: { total: number; added: number; skipped: number; errors: number };
        errors?: string[];
        error?: string;
        errorType?: 'rate_limit' | 'github_error' | 'unknown';
      }>('/api/maps/sync');

      if (response.success) {
        showSuccess(
          `Map sync completed! ${response.stats?.added || 0} new map(s) added, ${response.stats?.skipped || 0} already existed.`
        );
        if (response.errors && response.errors.length > 0) {
          showError(`Some maps failed to sync: ${response.errors.join(', ')}`);
        }
      } else {
        // Handle different error types with user-friendly messages
        let errorMessage = response.error || 'Failed to sync maps';
        
        if (response.errorType === 'rate_limit') {
          errorMessage = 'GitHub API rate limit exceeded. Please try again in a few minutes. You can set GITHUB_TOKEN environment variable to increase the rate limit.';
        } else if (response.errorType === 'github_error') {
          errorMessage = 'Unable to reach GitHub repository. Please check your internet connection and try again later.';
        }
        
        showError(errorMessage);
      }
    } catch (err: unknown) {
      // Handle API errors (network, 429, 503, etc.)
      let errorMessage = 'Failed to sync maps';
      
      if (err && typeof err === 'object' && 'response' in err) {
        const apiError = err as { response?: { data?: { error?: string; errorType?: string }; status?: number } };
        const status = apiError.response?.status;
        const errorData = apiError.response?.data;
        
        if (status === 429) {
          errorMessage = 'GitHub API rate limit exceeded. Please try again in a few minutes. You can set GITHUB_TOKEN environment variable to increase the rate limit.';
        } else if (status === 503) {
          errorMessage = 'Unable to reach GitHub repository. Please check your internet connection and try again later.';
        } else if (errorData?.error) {
          errorMessage = errorData.error;
          // Check error type for additional context
          if (errorData.errorType === 'rate_limit') {
            errorMessage = 'GitHub API rate limit exceeded. Please try again in a few minutes.';
          }
        }
      } else if (err instanceof Error) {
        // Check if error message contains rate limit info
        const errMsg = err.message.toLowerCase();
        if (errMsg.includes('rate limit') || errMsg.includes('rate limit exceeded')) {
          errorMessage = 'GitHub API rate limit exceeded. Please try again in a few minutes.';
        } else {
          errorMessage = err.message;
        }
      }
      
      showError(errorMessage);
    } finally {
      setSyncingMaps(false);
    }
  };


  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Typography variant="body2" color="text.secondary" mb={4}>
        Configure webhook endpoints, integrations, and default player settings used across tournaments.
      </Typography>

      {loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <LinearProgress />
        </Paper>
      )}

      {!loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Stack spacing={3}>
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
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      fullWidth
                      helperText="Matches and servers will call this URL for webhook events and demo uploads"
                      inputProps={{ 'data-testid': 'settings-webhook-url-input' }}
                    />
            </Box>

            <Divider />

            <Box>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Default Player ELO
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Default starting ELO assigned to new players when no ELO is specified. Used for shuffle
                tournaments and any player created via Players/Teams import. FaceIT-style default is 3000.
              </Typography>
              <TextField
                label="Default Player ELO"
                type="number"
                value={defaultPlayerElo === '' ? '' : defaultPlayerElo}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') {
                    setDefaultPlayerElo('');
                    return;
                  }
                  const parsed = Number(value);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setDefaultPlayerElo(Math.round(parsed));
                  }
                }}
                onBlur={handleFieldBlur}
                onKeyDown={handleFieldKeyDown}
                fullWidth
                inputProps={{ min: 1, step: 50, 'data-testid': 'settings-default-player-elo-input' }}
                helperText="Positive number only. Example: 3000"
              />
            </Box>

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
                        value={steamApiKey}
                        onChange={(event) => setSteamApiKey(event.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        type={showSteamKey ? 'text' : 'password'}
                        fullWidth
                        inputProps={{ 'data-testid': 'settings-steam-api-key-input' }}
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
              {saving && (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    Saving...
                  </Typography>
                </Box>
              )}
              <Button
                data-testid="settings-save-button"
                onClick={async () => {
                  // Cancel any pending auto-save
                  if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                    saveTimeoutRef.current = null;
                  }
                  // Reset to default values (empty)
                  setWebhookUrl('');
                  setSteamApiKey('');
                  setInitialWebhookUrl('');
                  setInitialSteamApiKey('');
                  // Save defaults to server
                  try {
                    const payload = {
                      webhookUrl: null,
                      steamApiKey: null,
                    };
                    await api.put('/api/settings', payload);
                    // Update initial values to reflect defaults
                    setInitialWebhookUrl('');
                    setInitialSteamApiKey('');
                    window.dispatchEvent(
                      new CustomEvent<SettingsResponse['settings']>('matchzy:settingsUpdated', {
                        detail: { webhookUrl: null, steamApiKey: null },
                      })
                    );
                    showSuccess('Settings reset to defaults');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to reset settings';
                    showError(message);
                  }
                }}
                disabled={loading || saving}
              >
                Reset to Defaults
              </Button>
            </Box>

            <Divider />

            <Box>
              <Typography variant="body2" color="text.secondary" align="center">
                Version {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Unknown'}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
