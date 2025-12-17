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
} from '@mui/material';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SyncIcon from '@mui/icons-material/Sync';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';

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
  const [simulateMatches, setSimulateMatches] = useState(false);
  const [initialSimulateMatches, setInitialSimulateMatches] = useState(false);
  const [matchzyChatPrefix, setMatchzyChatPrefix] = useState('');
  const [initialMatchzyChatPrefix, setInitialMatchzyChatPrefix] = useState('');
  const [matchzyAdminChatPrefix, setMatchzyAdminChatPrefix] = useState('');
  const [initialMatchzyAdminChatPrefix, setInitialMatchzyAdminChatPrefix] = useState('');
  const [matchzyKnifeEnabledDefault, setMatchzyKnifeEnabledDefault] = useState(true);
  const [initialMatchzyKnifeEnabledDefault, setInitialMatchzyKnifeEnabledDefault] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [steamStatusChecking, setSteamStatusChecking] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const isDev = Boolean((import.meta as any).env?.DEV);
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
      const defaultElo = response.settings.defaultPlayerElo ?? 3000;
      const simulate = response.settings.simulateMatches ?? false;
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
      setDefaultPlayerElo(defaultElo);
      setInitialDefaultPlayerElo(defaultElo);
      setSimulateMatches(simulate);
      setInitialSimulateMatches(simulate);
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
          defaultPlayerElo:
            defaultPlayerElo === ''
              ? null
              : Number.isFinite(defaultPlayerElo)
              ? defaultPlayerElo
              : null,
          matchzyChatPrefix: matchzyChatPrefix.trim() === '' ? null : matchzyChatPrefix.trim(),
          matchzyAdminChatPrefix:
            matchzyAdminChatPrefix.trim() === '' ? null : matchzyAdminChatPrefix.trim(),
          matchzyKnifeEnabledDefault: matchzyKnifeEnabledDefault,
          // Only send developer options from dev builds to keep this feature
          // clearly scoped to development environments.
          ...(isDev && { simulateMatches }),
        };

        const response: SettingsResponse = await api.put('/api/settings', payload);
        const newWebhook = response.settings.webhookUrl ?? '';
        const newSteamKey = response.settings.steamApiKey ?? '';
        const newDefaultElo = response.settings.defaultPlayerElo ?? 3000;
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
        setDefaultPlayerElo(newDefaultElo);
        setInitialDefaultPlayerElo(newDefaultElo);
        setSimulateMatches(newSimulate);
        setInitialSimulateMatches(newSimulate);
        setMatchzyChatPrefix(newChatPrefix);
        setInitialMatchzyChatPrefix(newChatPrefix);
        setMatchzyAdminChatPrefix(newAdminChatPrefix);
        setInitialMatchzyAdminChatPrefix(newAdminChatPrefix);
        setMatchzyKnifeEnabledDefault(newKnifeEnabled);
        setInitialMatchzyKnifeEnabledDefault(newKnifeEnabled);

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
    },
    [
      webhookUrl,
      steamApiKey,
      defaultPlayerElo,
      matchzyChatPrefix,
      matchzyAdminChatPrefix,
      matchzyKnifeEnabledDefault,
      simulateMatches,
      isDev,
      showSuccess,
      showError,
    ]
  );

  const handleFieldBlur = () => {
    // Save immediately when field loses focus (if values changed)
    if (
      webhookUrl !== initialWebhookUrl ||
      steamApiKey !== initialSteamApiKey ||
      defaultPlayerElo !== initialDefaultPlayerElo ||
      matchzyChatPrefix !== initialMatchzyChatPrefix ||
      matchzyAdminChatPrefix !== initialMatchzyAdminChatPrefix ||
      matchzyKnifeEnabledDefault !== initialMatchzyKnifeEnabledDefault ||
      (isDev && simulateMatches !== initialSimulateMatches)
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
      defaultPlayerElo === initialDefaultPlayerElo &&
      matchzyChatPrefix === initialMatchzyChatPrefix &&
      matchzyAdminChatPrefix === initialMatchzyAdminChatPrefix &&
      matchzyKnifeEnabledDefault === initialMatchzyKnifeEnabledDefault &&
      (!isDev || simulateMatches === initialSimulateMatches)
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
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    initialWebhookUrl,
    initialSteamApiKey,
    initialDefaultPlayerElo,
    initialMatchzyChatPrefix,
    initialMatchzyAdminChatPrefix,
    initialMatchzyKnifeEnabledDefault,
    simulateMatches,
    initialSimulateMatches,
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
        Configure integrations, in-game behavior, rating defaults, and developer options.
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
                    Base URL for MatchZy webhooks and demo uploads. It must be reachable from your
                    CS2 servers.
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
                      helperText="Used to resolve vanity URLs and fetch player profiles. Leave blank to disable Steam lookups."
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
                    Sync CS2 maps from the GitHub repository. Only new maps are added; existing maps
                    are skipped.
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
                    Default Player ELO
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Starting ELO for new players when none is specified (used by shuffle tournaments
                    and player/team imports).
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
                    slotProps={{
                      htmlInput: {
                        min: 1,
                        step: 50,
                      },
                    }}
                    helperText="Positive number. Example: 3000"
                  />
                </Box>

                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    MatchZy Chat & Knife Defaults
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Control the in-game chat prefixes and whether knife rounds are enabled by
                    default for new matches. Changes are pushed via RCON before each match is
                    loaded.
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
                      This flag only affects matches where MatchZy would normally run a knife round
                      (for example, when no starting sides are chosen in the match config). Explicit
                      side picks or shuffle&apos;s auto-assigned sides are not overridden. Some
                      changes may require a map reload or server restart depending on your MatchZy
                      configuration.
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
                      Experimental features for local development. These options should not be used
                      in production environments.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={simulateMatches}
                          onChange={(event) => setSimulateMatches(event.target.checked)}
                          inputProps={{ 'data-testid': 'settings-simulate-matches-toggle' } as any}
                        />
                      }
                      label="Simulate matches (use bot-driven demo matches instead of real players)"
                    />
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                      When enabled, generated MatchZy configs include{' '}
                      <code>\"simulation\": true</code> so servers can run fully automated demo
                      matches for development and testing.
                    </Typography>
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
                This will reset all settings on this page (integrations, match & rating, and
                developer options) back to their defaults. Existing tournaments and servers are not
                modified, but new matches and lookups will use the default values. Are you sure you
                want to continue?
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
                    const response: SettingsResponse = await api.put('/api/settings', {
                      webhookUrl: null,
                      steamApiKey: null,
                      defaultPlayerElo: null,
                      matchzyChatPrefix: null,
                      matchzyAdminChatPrefix: null,
                      matchzyKnifeEnabledDefault: null,
                      ...(isDev && { simulateMatches: false }),
                    } as any);

                    const newWebhook = response.settings.webhookUrl ?? '';
                    const newSteamKey = response.settings.steamApiKey ?? '';
                    const newDefaultElo = response.settings.defaultPlayerElo ?? 3000;
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
                    setDefaultPlayerElo(newDefaultElo);
                    setInitialDefaultPlayerElo(newDefaultElo);
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
