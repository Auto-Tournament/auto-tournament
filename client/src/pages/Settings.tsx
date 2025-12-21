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
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
} from '@mui/material';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SyncIcon from '@mui/icons-material/Sync';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';

const STEAM_API_DOC_URL = 'https://steamcommunity.com/dev/apikey';

declare const __APP_VERSION__: string | undefined;

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `settings-tab-${index}`,
    'aria-controls': `settings-tabpanel-${index}`,
  };
}

export default function Settings() {
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError, showSnackbar } = useSnackbar();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [steamApiKey, setSteamApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSteamKey, setShowSteamKey] = useState(false);
  const [syncingMaps, setSyncingMaps] = useState(false);
  const [initialWebhookUrl, setInitialWebhookUrl] = useState('');
  const [initialSteamApiKey, setInitialSteamApiKey] = useState('');
  const [simulateMatches, setSimulateMatches] = useState(false);
  const [initialSimulateMatches, setInitialSimulateMatches] = useState(false);
  const [simulationTimescale, setSimulationTimescale] = useState<number>(1);
  const [initialSimulationTimescale, setInitialSimulationTimescale] = useState<number>(1);
  const [matchzyChatPrefix, setMatchzyChatPrefix] = useState('');
  const [initialMatchzyChatPrefix, setInitialMatchzyChatPrefix] = useState('');
  const [matchzyAdminChatPrefix, setMatchzyAdminChatPrefix] = useState('');
  const [initialMatchzyAdminChatPrefix, setInitialMatchzyAdminChatPrefix] = useState('');
  const [matchzyKnifeEnabledDefault, setMatchzyKnifeEnabledDefault] = useState(true);
  const [initialMatchzyKnifeEnabledDefault, setInitialMatchzyKnifeEnabledDefault] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [steamStatusChecking, setSteamStatusChecking] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const isDev = useIsDevelopment();
  const [tabIndex, setTabIndex] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);

    try {
      const response: SettingsResponse = await api.get('/api/settings');
      const webhook = response.settings.webhookUrl ?? '';
      const steamKey = response.settings.steamApiKey ?? '';
      const simulate = response.settings.simulateMatches ?? false;
      const timescale = response.settings.simulationTimescale ?? 1;
      const chatPrefix = response.settings.matchzyChatPrefix ?? '';
      const adminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
      const knifeEnabled =
        response.settings.matchzyKnifeEnabledDefault !== undefined
          ? response.settings.matchzyKnifeEnabledDefault
          : true;
      setWebhookUrl(webhook);
      setSteamApiKey(steamKey);
      setInitialWebhookUrl(webhook);
      setInitialSteamApiKey(steamKey);
      setSimulateMatches(simulate);
      setInitialSimulateMatches(simulate);
      setSimulationTimescale(timescale);
      setInitialSimulationTimescale(timescale);
      setMatchzyChatPrefix(chatPrefix);
      setInitialMatchzyChatPrefix(chatPrefix);
      setMatchzyAdminChatPrefix(adminChatPrefix);
      setInitialMatchzyAdminChatPrefix(adminChatPrefix);
      setMatchzyKnifeEnabledDefault(knifeEnabled);
      setInitialMatchzyKnifeEnabledDefault(knifeEnabled);
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

  const handleSave = useCallback(
    async (showSuccessMessage = true) => {
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
          matchzyChatPrefix: matchzyChatPrefix.trim() === '' ? null : matchzyChatPrefix.trim(),
          matchzyAdminChatPrefix:
            matchzyAdminChatPrefix.trim() === '' ? null : matchzyAdminChatPrefix.trim(),
          matchzyKnifeEnabledDefault: matchzyKnifeEnabledDefault,
          // Only send developer options from dev builds to keep this feature
          // clearly scoped to development environments.
          ...(isDev && { simulateMatches, simulationTimescale }),
        };

        const response: SettingsResponse = await api.put('/api/settings', payload);
        const newWebhook = response.settings.webhookUrl ?? '';
        const newSteamKey = response.settings.steamApiKey ?? '';
        const newSimulate = response.settings.simulateMatches ?? false;
        const newTimescale = response.settings.simulationTimescale ?? 1;
        const newChatPrefix = response.settings.matchzyChatPrefix ?? '';
        const newAdminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
        const newKnifeEnabled =
          response.settings.matchzyKnifeEnabledDefault !== undefined
            ? response.settings.matchzyKnifeEnabledDefault
            : true;
        // Compute deltas before updating state
        const simulationToggled = isDev && newSimulate !== initialSimulateMatches;
        const timescaleChanged =
          isDev && newTimescale !== initialSimulationTimescale;

        setWebhookUrl(newWebhook);
        setSteamApiKey(newSteamKey);
        setInitialWebhookUrl(newWebhook);
        setInitialSteamApiKey(newSteamKey);
        setSimulateMatches(newSimulate);
        setInitialSimulateMatches(newSimulate);
        setSimulationTimescale(newTimescale);
        setInitialSimulationTimescale(newTimescale);
        setMatchzyChatPrefix(newChatPrefix);
        setInitialMatchzyChatPrefix(newChatPrefix);
        setMatchzyAdminChatPrefix(newAdminChatPrefix);
        setInitialMatchzyAdminChatPrefix(newAdminChatPrefix);
        setMatchzyKnifeEnabledDefault(newKnifeEnabled);
        setInitialMatchzyKnifeEnabledDefault(newKnifeEnabled);

        if (showSuccessMessage) {
          showSuccess('Settings saved');

          if (simulationToggled) {
            showSnackbar(
              newSimulate
                ? `Simulation mode enabled${isDev ? ` at ${newTimescale.toFixed(1)}x speed` : ''}`
                : 'Simulation mode disabled',
              'info'
            );
          } else if (timescaleChanged && newSimulate) {
            showSnackbar(
              `Simulation timescale updated to ${newTimescale.toFixed(1)}x`,
              'info'
            );
          }
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
    },
    [
      webhookUrl,
      steamApiKey,
      matchzyChatPrefix,
      matchzyAdminChatPrefix,
      matchzyKnifeEnabledDefault,
      simulateMatches,
      simulationTimescale,
      isDev,
      showSuccess,
      showError,
      showSnackbar,
      initialSimulateMatches,
      initialSimulationTimescale,
    ]
  );

  const handleFieldBlur = () => {
    // Save immediately when field loses focus (if values changed)
    if (
      webhookUrl !== initialWebhookUrl ||
      steamApiKey !== initialSteamApiKey ||
      matchzyChatPrefix !== initialMatchzyChatPrefix ||
      matchzyAdminChatPrefix !== initialMatchzyAdminChatPrefix ||
      matchzyKnifeEnabledDefault !== initialMatchzyKnifeEnabledDefault ||
      (isDev &&
        (simulateMatches !== initialSimulateMatches ||
          simulationTimescale !== initialSimulationTimescale))
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
      matchzyChatPrefix === initialMatchzyChatPrefix &&
      matchzyAdminChatPrefix === initialMatchzyAdminChatPrefix &&
      matchzyKnifeEnabledDefault === initialMatchzyKnifeEnabledDefault &&
      (!isDev ||
        (simulateMatches === initialSimulateMatches &&
          simulationTimescale === initialSimulationTimescale))
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
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    initialWebhookUrl,
    initialSteamApiKey,
    initialMatchzyChatPrefix,
    initialMatchzyAdminChatPrefix,
    initialMatchzyKnifeEnabledDefault,
    simulateMatches,
    initialSimulateMatches,
    initialSimulationTimescale,
    simulationTimescale,
    isDev,
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
          `Map sync completed! ${response.stats?.added || 0} new map(s) added, ${
            response.stats?.skipped || 0
          } already existed.`
        );
        if (response.errors && response.errors.length > 0) {
          showError(`Some maps failed to sync: ${response.errors.join(', ')}`);
        }
      } else {
        // Handle different error types with user-friendly messages
        let errorMessage = response.error || 'Failed to sync maps';

        if (response.errorType === 'rate_limit') {
          errorMessage =
            'GitHub API rate limit exceeded. Please try again in a few minutes. You can set GITHUB_TOKEN environment variable to increase the rate limit.';
        } else if (response.errorType === 'github_error') {
          errorMessage =
            'Unable to reach GitHub repository. Please check your internet connection and try again later.';
        }

        showError(errorMessage);
      }
    } catch (err: unknown) {
      // Handle API errors (network, 429, 503, etc.)
      let errorMessage = 'Failed to sync maps';

      if (err && typeof err === 'object' && 'response' in err) {
        const apiError = err as {
          response?: { data?: { error?: string; errorType?: string }; status?: number };
        };
        const status = apiError.response?.status;
        const errorData = apiError.response?.data;

        if (status === 429) {
          errorMessage =
            'GitHub API rate limit exceeded. Please try again in a few minutes. You can set GITHUB_TOKEN environment variable to increase the rate limit.';
        } else if (status === 503) {
          errorMessage =
            'Unable to reach GitHub repository. Please check your internet connection and try again later.';
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
        Configure core integrations, in-game defaults, and developer options.
      </Typography>

      {loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <LinearProgress />
        </Paper>
      )}

      {!loading && (
        <>
          <Paper sx={{ mb: 2 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={tabIndex}
                onChange={handleTabChange}
                textColor="secondary"
                indicatorColor="secondary"
                aria-label="Settings tabs"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="Integrations" {...a11yProps(0)} />
                <Tab label="Match & Rating" {...a11yProps(1)} />
                {isDev && <Tab label="Developer" {...a11yProps(2)} />}
              </Tabs>
            </Box>

            <TabPanel value={tabIndex} index={0}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    MatchZy Webhook
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    MatchZy webhook URL that your CS2 servers can reach.
                  </Typography>
                  <TextField
                    label="Webhook URL"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    onBlur={handleFieldBlur}
                    onKeyDown={handleFieldKeyDown}
                    helperText="Example: https://your-domain.com"
                    fullWidth
                    required
                    error={!loading && webhookUrl.trim() === ''}
                    slotProps={{
                      htmlInput: { 'data-testid': 'settings-webhook-url-input' },
                    }}
                  />
                </Box>

                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    Steam Integration
                  </Typography>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems="flex-center"
                    spacing={1}
                  >
                    <TextField
                      label="Steam Web API Key"
                      value={steamApiKey}
                      onChange={(event) => setSteamApiKey(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      type={showSteamKey ? 'text' : 'password'}
                      fullWidth
                      helperText="Resolves Steam vanity URLs and player info. Leave blank to disable lookups."
                      slotProps={{
                        htmlInput: { 'data-testid': 'settings-steam-api-key-input' },
                      }}
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
                      sx={{ width: '56px', height: '56px' }}
                    >
                      <OpenInNewIcon />
                    </IconButton>
                  </Stack>
                  <Box mt={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={loading || steamStatusChecking}
                      startIcon={
                        steamStatusChecking ? <CircularProgress size={14} /> : <VisibilityIcon />
                      }
                      onClick={async () => {
                        setSteamStatusChecking(true);
                        try {
                          const response = await api.get<{
                            success: boolean;
                            configured?: boolean;
                            message?: string;
                            error?: string;
                          }>('/api/steam/status');

                          if (response.success && response.configured) {
                            showSuccess(response.message || 'Steam API key is set and reachable.');
                          } else if (!response.success && response.configured === false) {
                            showError(
                              response.error ||
                                'Steam API key is not set. Vanity URLs cannot be resolved until you add a key.'
                            );
                          } else {
                            showError(
                              response.error ||
                                'Steam API key appears set but Steam could not be reached. Check your network or key.'
                            );
                          }
                        } catch (err) {
                          const message =
                            err instanceof Error
                              ? err.message
                              : 'Failed to check Steam API status. Please try again.';
                          showError(message);
                        } finally {
                          setSteamStatusChecking(false);
                        }
                      }}
                    >
                      {steamStatusChecking ? 'Checking Steam…' : 'Check Steam connectivity'}
                    </Button>
                  </Box>
                </Box>

                <Divider />

                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    Map Synchronization
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Sync CS2 maps from the GitHub repository.
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
              </Stack>
            </TabPanel>

            <TabPanel value={tabIndex} index={1}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    MatchZy Chat & Knife Defaults
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Configure in-game chat prefixes and default knife round behavior.
                  </Typography>
                  <Stack spacing={2}>
                    <TextField
                      label="Chat Prefix"
                      value={matchzyChatPrefix}
                      onChange={(event) => setMatchzyChatPrefix(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      helperText='Default: "[MAT]". Leave blank to reset to the default prefix.'
                      fullWidth
                    />
                    <TextField
                      label="Admin Chat Prefix"
                      value={matchzyAdminChatPrefix}
                      onChange={(event) => setMatchzyAdminChatPrefix(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      helperText='Default: "[ADMIN]". Leave blank to reset to the default admin prefix.'
                      fullWidth
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={matchzyKnifeEnabledDefault}
                          onChange={(event) => setMatchzyKnifeEnabledDefault(event.target.checked)}
                        />
                      }
                      label="Enable knife rounds by default for new matches (when sides are not pre-selected)"
                    />
                    <Typography variant="caption" color="text.secondary" display="block">
                      Applies only when MatchZy would normally run a knife round; explicit side
                      picks or shuffle-assigned sides are not changed.
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            </TabPanel>

            {isDev && (
              <TabPanel value={tabIndex} index={2}>
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      Developer Options
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      Local development helpers only; don&apos;t enable in production.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={simulateMatches}
                          onChange={(event) => setSimulateMatches(event.target.checked)}
                          inputProps={
                            {
                              'data-testid': 'settings-simulate-matches-toggle',
                            } satisfies React.InputHTMLAttributes<HTMLInputElement>
                          }
                        />
                      }
                      label="Simulate matches (use bot-driven demo matches instead of real players)"
                    />
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                      When enabled, generated MatchZy configs include <code>\"simulation\": true</code> for automated demo matches.
                    </Typography>
                    <Box mt={3}>
                      <Typography variant="subtitle1" fontWeight={500} gutterBottom>
                        Simulation Timescale
                      </Typography>
                      <Typography variant="body2" color="text.secondary" mb={1}>
                        Controls how fast simulated matches run. Higher values speed up bots and
                        round flow. This only applies when simulation is enabled.
                      </Typography>
                      <Box px={1}>
                        <Slider
                          value={simulationTimescale}
                          onChange={(_e, value) => {
                            const v = Array.isArray(value) ? value[0] : value;
                            setSimulationTimescale(typeof v === 'number' ? v : 1);
                          }}
                          onChangeCommitted={(_e, value) => {
                            const v = Array.isArray(value) ? value[0] : value;
                            setSimulationTimescale(typeof v === 'number' ? v : 1);
                            void handleSave(true);
                          }}
                          min={0.1}
                          max={4}
                          step={0.1}
                          marks
                          valueLabelDisplay="on"
                          data-testid="settings-simulation-timescale-slider"
                        />
                        {simulationTimescale > 2 && (
                          <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                            Speeds above 2.0 can be a bit unstable and may cause odd bot behavior, but
                            are fine to use for quick local testing.
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                </Stack>
              </TabPanel>
            )}
          </Paper>

          <Box
            mt={2}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
          >
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
              Version {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Unknown'}
            </Typography>

            <Button
              data-testid="settings-save-button"
              onClick={() => setResetDialogOpen(true)}
              disabled={loading || saving}
            >
              Reset Settings
            </Button>
          </Box>

                    <Dialog
            open={resetDialogOpen}
            onClose={() => setResetDialogOpen(false)}
            aria-labelledby="reset-settings-dialog-title"
          >
            <DialogTitle id="reset-settings-dialog-title">Reset settings?</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                Reset all settings on this page back to defaults. Existing tournaments and servers
                are not changed, but new matches and lookups will use the default values. Continue?
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
              <Button
                color="error"
                variant="contained"
                onClick={async () => {
                  // Cancel any pending auto-save
                  if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                    saveTimeoutRef.current = null;
                  }
                  // Save default values to server
                  try {
                    const resetPayload: {
                      webhookUrl: null;
                      steamApiKey: null;
                      matchzyChatPrefix: null;
                      matchzyAdminChatPrefix: null;
                      matchzyKnifeEnabledDefault: null;
                      simulateMatches?: boolean;
                    } = {
                      webhookUrl: null,
                      steamApiKey: null,
                      matchzyChatPrefix: null,
                      matchzyAdminChatPrefix: null,
                      matchzyKnifeEnabledDefault: null,
                      ...(isDev && { simulateMatches: false }),
                    };

                    const response: SettingsResponse = await api.put(
                      '/api/settings',
                      resetPayload
                    );

                    const newWebhook = response.settings.webhookUrl ?? '';
                    const newSteamKey = response.settings.steamApiKey ?? '';
                    const newSimulate = response.settings.simulateMatches ?? false;
                    const newChatPrefix = response.settings.matchzyChatPrefix ?? '';
                    const newAdminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
                    const newKnifeEnabled =
                      response.settings.matchzyKnifeEnabledDefault !== undefined
                        ? response.settings.matchzyKnifeEnabledDefault
                        : true;

                    setWebhookUrl(newWebhook);
                    setSteamApiKey(newSteamKey);
                    setInitialWebhookUrl(newWebhook);
                    setInitialSteamApiKey(newSteamKey);
                    setSimulateMatches(newSimulate);
                    setInitialSimulateMatches(newSimulate);
                    setMatchzyChatPrefix(newChatPrefix);
                    setInitialMatchzyChatPrefix(newChatPrefix);
                    setMatchzyAdminChatPrefix(newAdminChatPrefix);
                    setInitialMatchzyAdminChatPrefix(newAdminChatPrefix);
                    setMatchzyKnifeEnabledDefault(newKnifeEnabled);
                    setInitialMatchzyKnifeEnabledDefault(newKnifeEnabled);

                    window.dispatchEvent(
                      new CustomEvent<SettingsResponse['settings']>('matchzy:settingsUpdated', {
                        detail: response.settings,
                      })
                    );
                    showSuccess('Settings reset to defaults');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to reset settings';
                    showError(message);
                  } finally {
                    setResetDialogOpen(false);
                  }
                }}
                autoFocus
              >
                Reset
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
