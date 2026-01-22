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
import SyncIcon from '@mui/icons-material/Sync';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingMaps, setSyncingMaps] = useState(false);
  const [initialWebhookUrl, setInitialWebhookUrl] = useState('');
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
  const [ratingsEnabled, setRatingsEnabled] = useState(true);
  const [initialRatingsEnabled, setInitialRatingsEnabled] = useState(true);
  const [matchzyDebugChatEnabled, setMatchzyDebugChatEnabled] = useState(false);
  const [initialMatchzyDebugChatEnabled, setInitialMatchzyDebugChatEnabled] = useState(false);
  const [allowSelfRegister, setAllowSelfRegister] = useState(false);
  // MatchZy Enhanced v1.3.0 settings
  const [matchzyAutoreadyEnabled, setMatchzyAutoreadyEnabled] = useState<0 | 1 | null>(null);
  const [initialMatchzyAutoreadyEnabled, setInitialMatchzyAutoreadyEnabled] = useState<0 | 1 | null>(null);
  const [matchzyBothTeamsUnpauseRequired, setMatchzyBothTeamsUnpauseRequired] = useState<0 | 1 | null>(null);
  const [initialMatchzyBothTeamsUnpauseRequired, setInitialMatchzyBothTeamsUnpauseRequired] = useState<0 | 1 | null>(null);
  const [matchzyMaxPausesPerTeam, setMatchzyMaxPausesPerTeam] = useState<number | null>(null);
  const [initialMatchzyMaxPausesPerTeam, setInitialMatchzyMaxPausesPerTeam] = useState<number | null>(null);
  const [matchzyPauseDuration, setMatchzyPauseDuration] = useState<number | null>(null);
  const [initialMatchzyPauseDuration, setInitialMatchzyPauseDuration] = useState<number | null>(null);
  const [matchzySideSelectionEnabled, setMatchzySideSelectionEnabled] = useState<0 | 1 | null>(null);
  const [initialMatchzySideSelectionEnabled, setInitialMatchzySideSelectionEnabled] = useState<0 | 1 | null>(null);
  const [matchzySideSelectionTime, setMatchzySideSelectionTime] = useState<number | null>(null);
  const [initialMatchzySideSelectionTime, setInitialMatchzySideSelectionTime] = useState<number | null>(null);
  const [matchzyGgEnabled, setMatchzyGgEnabled] = useState<0 | 1 | null>(null);
  const [initialMatchzyGgEnabled, setInitialMatchzyGgEnabled] = useState<0 | 1 | null>(null);
  const [matchzyGgThreshold, setMatchzyGgThreshold] = useState<number | null>(null);
  const [initialMatchzyGgThreshold, setInitialMatchzyGgThreshold] = useState<number | null>(null);
  const [matchzyGgMinScoreDiff, setMatchzyGgMinScoreDiff] = useState<number | null>(null);
  const [initialMatchzyGgMinScoreDiff, setInitialMatchzyGgMinScoreDiff] = useState<number | null>(null);
  const [matchzyFfwEnabled, setMatchzyFfwEnabled] = useState<0 | 1 | null>(null);
  const [initialMatchzyFfwEnabled, setInitialMatchzyFfwEnabled] = useState<0 | 1 | null>(null);
  const [matchzyFfwTime, setMatchzyFfwTime] = useState<number | null>(null);
  const [initialMatchzyFfwTime, setInitialMatchzyFfwTime] = useState<number | null>(null);
  const [matchzyDemoRecordingEnabled, setMatchzyDemoRecordingEnabled] = useState<0 | 1 | null>(null);
  const [initialMatchzyDemoRecordingEnabled, setInitialMatchzyDemoRecordingEnabled] = useState<0 | 1 | null>(null);
  const [resetApiDialogOpen, setResetApiDialogOpen] = useState(false);
  const [resettingApi, setResettingApi] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const isDev = useIsDevelopment();
  const [tabIndex, setTabIndex] = useState(0);
  const { t } = useTranslation();

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);

    try {
      const response: SettingsResponse = await api.get('/api/settings');
      const webhook = response.settings.webhookUrl ?? '';
      const simulate = response.settings.simulateMatches ?? false;
      const timescale = response.settings.simulationTimescale ?? 1;
      const chatPrefix = response.settings.matchzyChatPrefix ?? '';
      const adminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
      const knifeEnabled =
        response.settings.matchzyKnifeEnabledDefault !== undefined
          ? response.settings.matchzyKnifeEnabledDefault
          : true;
      const ratingsEnabledValue =
        response.settings.ratingsEnabled !== undefined ? response.settings.ratingsEnabled : true;
      const debugChatEnabled =
        response.settings.matchzyDebugChatEnabled !== undefined
          ? response.settings.matchzyDebugChatEnabled
          : false;
      const allowSelfRegisterValue =
        response.settings.allowSelfRegister !== undefined
          ? response.settings.allowSelfRegister
          : false;
      // MatchZy Enhanced v1.3.0 settings
      const matchzyAutoready = response.settings.matchzyAutoreadyEnabled ?? null;
      const matchzyBothTeamsUnpause = response.settings.matchzyBothTeamsUnpauseRequired ?? null;
      const matchzyMaxPauses = response.settings.matchzyMaxPausesPerTeam ?? null;
      const matchzyPauseDur = response.settings.matchzyPauseDuration ?? null;
      const matchzySideSelEnabled = response.settings.matchzySideSelectionEnabled ?? null;
      const matchzySideSelTime = response.settings.matchzySideSelectionTime ?? null;
      const matchzyGg = response.settings.matchzyGgEnabled ?? null;
      const matchzyGgThresh = response.settings.matchzyGgThreshold ?? null;
      const matchzyGgMinDiff = response.settings.matchzyGgMinScoreDiff ?? null;
      const matchzyFfw = response.settings.matchzyFfwEnabled ?? null;
      const matchzyFfwT = response.settings.matchzyFfwTime ?? null;
      const matchzyDemo = response.settings.matchzyDemoRecordingEnabled ?? null;
      
      setWebhookUrl(webhook);
      setInitialWebhookUrl(webhook);
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
      setMatchzyDebugChatEnabled(debugChatEnabled);
      setInitialMatchzyDebugChatEnabled(debugChatEnabled);
      setAllowSelfRegister(allowSelfRegisterValue);
      setRatingsEnabled(ratingsEnabledValue);
      setInitialRatingsEnabled(ratingsEnabledValue);
      // MatchZy Enhanced
      setMatchzyAutoreadyEnabled(matchzyAutoready);
      setInitialMatchzyAutoreadyEnabled(matchzyAutoready);
      setMatchzyBothTeamsUnpauseRequired(matchzyBothTeamsUnpause);
      setInitialMatchzyBothTeamsUnpauseRequired(matchzyBothTeamsUnpause);
      setMatchzyMaxPausesPerTeam(matchzyMaxPauses);
      setInitialMatchzyMaxPausesPerTeam(matchzyMaxPauses);
      setMatchzyPauseDuration(matchzyPauseDur);
      setInitialMatchzyPauseDuration(matchzyPauseDur);
      setMatchzySideSelectionEnabled(matchzySideSelEnabled);
      setInitialMatchzySideSelectionEnabled(matchzySideSelEnabled);
      setMatchzySideSelectionTime(matchzySideSelTime);
      setInitialMatchzySideSelectionTime(matchzySideSelTime);
      setMatchzyGgEnabled(matchzyGg);
      setInitialMatchzyGgEnabled(matchzyGg);
      setMatchzyGgThreshold(matchzyGgThresh);
      setInitialMatchzyGgThreshold(matchzyGgThresh);
      setMatchzyGgMinScoreDiff(matchzyGgMinDiff);
      setInitialMatchzyGgMinScoreDiff(matchzyGgMinDiff);
      setMatchzyFfwEnabled(matchzyFfw);
      setInitialMatchzyFfwEnabled(matchzyFfw);
      setMatchzyFfwTime(matchzyFfwT);
      setInitialMatchzyFfwTime(matchzyFfwT);
      setMatchzyDemoRecordingEnabled(matchzyDemo);
      setInitialMatchzyDemoRecordingEnabled(matchzyDemo);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settingsPage.errors.loadSettings');
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    document.title = t('settingsPage.title');
    void fetchSettings();
  }, [fetchSettings, t]);

  useEffect(() => {
    // No header actions needed for settings page
    setHeaderActions(null);

    return () => {
      setHeaderActions(null);
    };
  }, [setHeaderActions]);

  const handleSave = useCallback(
    async (showSuccessMessage = true, overrides?: { matchzyDebugChatEnabled?: boolean }) => {
      setSaving(true);

      // Cancel any pending auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      try {
        const payload = {
          webhookUrl: webhookUrl.trim() === '' ? null : webhookUrl.trim(),
          matchzyChatPrefix: matchzyChatPrefix.trim() === '' ? null : matchzyChatPrefix.trim(),
          matchzyAdminChatPrefix:
            matchzyAdminChatPrefix.trim() === '' ? null : matchzyAdminChatPrefix.trim(),
          matchzyKnifeEnabledDefault,
          ratingsEnabled,
          matchzyDebugChatEnabled: overrides?.matchzyDebugChatEnabled ?? matchzyDebugChatEnabled,
          allowSelfRegister,
          // MatchZy Enhanced v1.3.0 settings
          matchzyAutoreadyEnabled,
          matchzyBothTeamsUnpauseRequired,
          matchzyMaxPausesPerTeam,
          matchzyPauseDuration,
          matchzySideSelectionEnabled,
          matchzySideSelectionTime,
          matchzyGgEnabled,
          matchzyGgThreshold,
          matchzyGgMinScoreDiff,
          matchzyFfwEnabled,
          matchzyFfwTime,
          matchzyDemoRecordingEnabled,
          // Only send developer options from dev builds to keep this feature
          // clearly scoped to development environments.
          ...(isDev && { simulateMatches, simulationTimescale }),
        };

        const response: SettingsResponse = await api.put('/api/settings', payload);
        const newWebhook = response.settings.webhookUrl ?? '';
        const newSimulate = response.settings.simulateMatches ?? false;
        const newTimescale = response.settings.simulationTimescale ?? 1;
        const newChatPrefix = response.settings.matchzyChatPrefix ?? '';
        const newAdminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
        const newKnifeEnabled =
          response.settings.matchzyKnifeEnabledDefault !== undefined
            ? response.settings.matchzyKnifeEnabledDefault
            : true;
        const newRatingsEnabled =
          response.settings.ratingsEnabled !== undefined
            ? response.settings.ratingsEnabled
            : true;
        const newDebugChatEnabled =
          response.settings.matchzyDebugChatEnabled !== undefined
            ? response.settings.matchzyDebugChatEnabled
            : false;
        const newAllowSelfRegister =
          response.settings.allowSelfRegister !== undefined
            ? response.settings.allowSelfRegister
            : false;
        // MatchZy Enhanced v1.3.0 settings
        const newMatchzyAutoready = response.settings.matchzyAutoreadyEnabled ?? null;
        const newMatchzyBothTeamsUnpause = response.settings.matchzyBothTeamsUnpauseRequired ?? null;
        const newMatchzyMaxPauses = response.settings.matchzyMaxPausesPerTeam ?? null;
        const newMatchzyPauseDur = response.settings.matchzyPauseDuration ?? null;
        const newMatchzySideSelEnabled = response.settings.matchzySideSelectionEnabled ?? null;
        const newMatchzySideSelTime = response.settings.matchzySideSelectionTime ?? null;
        const newMatchzyGg = response.settings.matchzyGgEnabled ?? null;
        const newMatchzyGgThresh = response.settings.matchzyGgThreshold ?? null;
        const newMatchzyGgMinDiff = response.settings.matchzyGgMinScoreDiff ?? null;
        const newMatchzyFfw = response.settings.matchzyFfwEnabled ?? null;
        const newMatchzyFfwT = response.settings.matchzyFfwTime ?? null;
        const newMatchzyDemo = response.settings.matchzyDemoRecordingEnabled ?? null;
        
        // Compute deltas before updating state
        const simulationToggled = isDev && newSimulate !== initialSimulateMatches;
        const timescaleChanged =
          isDev && newTimescale !== initialSimulationTimescale;

        setWebhookUrl(newWebhook);
        setInitialWebhookUrl(newWebhook);
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
        setRatingsEnabled(newRatingsEnabled);
        setInitialRatingsEnabled(newRatingsEnabled);
        setMatchzyDebugChatEnabled(newDebugChatEnabled);
        setInitialMatchzyDebugChatEnabled(newDebugChatEnabled);
        setAllowSelfRegister(newAllowSelfRegister);
        // MatchZy Enhanced
        setMatchzyAutoreadyEnabled(newMatchzyAutoready);
        setInitialMatchzyAutoreadyEnabled(newMatchzyAutoready);
        setMatchzyBothTeamsUnpauseRequired(newMatchzyBothTeamsUnpause);
        setInitialMatchzyBothTeamsUnpauseRequired(newMatchzyBothTeamsUnpause);
        setMatchzyMaxPausesPerTeam(newMatchzyMaxPauses);
        setInitialMatchzyMaxPausesPerTeam(newMatchzyMaxPauses);
        setMatchzyPauseDuration(newMatchzyPauseDur);
        setInitialMatchzyPauseDuration(newMatchzyPauseDur);
        setMatchzySideSelectionEnabled(newMatchzySideSelEnabled);
        setInitialMatchzySideSelectionEnabled(newMatchzySideSelEnabled);
        setMatchzySideSelectionTime(newMatchzySideSelTime);
        setInitialMatchzySideSelectionTime(newMatchzySideSelTime);
        setMatchzyGgEnabled(newMatchzyGg);
        setInitialMatchzyGgEnabled(newMatchzyGg);
        setMatchzyGgThreshold(newMatchzyGgThresh);
        setInitialMatchzyGgThreshold(newMatchzyGgThresh);
        setMatchzyGgMinScoreDiff(newMatchzyGgMinDiff);
        setInitialMatchzyGgMinScoreDiff(newMatchzyGgMinDiff);
        setMatchzyFfwEnabled(newMatchzyFfw);
        setInitialMatchzyFfwEnabled(newMatchzyFfw);
        setMatchzyFfwTime(newMatchzyFfwT);
        setInitialMatchzyFfwTime(newMatchzyFfwT);
        setMatchzyDemoRecordingEnabled(newMatchzyDemo);
        setInitialMatchzyDemoRecordingEnabled(newMatchzyDemo);

        if (showSuccessMessage) {
          showSuccess(t('settingsPage.success.saveSettings'));

          if (simulationToggled) {
            showSnackbar(
              newSimulate
                ? t('settingsPage.success.simulationEnabled', {
                    suffix: isDev ? ` at ${newTimescale.toFixed(1)}x speed` : '',
                  })
                : t('settingsPage.success.simulationDisabled'),
              'info'
            );
          } else if (timescaleChanged && newSimulate) {
            showSnackbar(
              t('settingsPage.success.timescaleUpdated', {
                value: newTimescale.toFixed(1),
              }),
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
        const message =
          err instanceof Error ? err.message : t('settingsPage.errors.saveSettings');
        showError(message);
      } finally {
        setSaving(false);
      }
    },
    [
      webhookUrl,
      matchzyChatPrefix,
      matchzyAdminChatPrefix,
      matchzyKnifeEnabledDefault,
      ratingsEnabled,
      matchzyDebugChatEnabled,
      simulateMatches,
      simulationTimescale,
      allowSelfRegister,
      matchzyAutoreadyEnabled,
      matchzyBothTeamsUnpauseRequired,
      matchzyMaxPausesPerTeam,
      matchzyPauseDuration,
      matchzySideSelectionEnabled,
      matchzySideSelectionTime,
      matchzyGgEnabled,
      matchzyGgThreshold,
      matchzyGgMinScoreDiff,
      matchzyFfwEnabled,
      matchzyFfwTime,
      matchzyDemoRecordingEnabled,
      isDev,
      showSuccess,
      showError,
      showSnackbar,
      initialSimulateMatches,
      initialSimulationTimescale,
      t,
    ]
  );

  const handleFieldBlur = () => {
    // Save immediately when field loses focus (if values changed)
    if (
      webhookUrl !== initialWebhookUrl ||
      matchzyChatPrefix !== initialMatchzyChatPrefix ||
      matchzyAdminChatPrefix !== initialMatchzyAdminChatPrefix ||
      matchzyKnifeEnabledDefault !== initialMatchzyKnifeEnabledDefault ||
      ratingsEnabled !== initialRatingsEnabled ||
      matchzyDebugChatEnabled !== initialMatchzyDebugChatEnabled ||
      matchzyAutoreadyEnabled !== initialMatchzyAutoreadyEnabled ||
      matchzyBothTeamsUnpauseRequired !== initialMatchzyBothTeamsUnpauseRequired ||
      matchzyMaxPausesPerTeam !== initialMatchzyMaxPausesPerTeam ||
      matchzyPauseDuration !== initialMatchzyPauseDuration ||
      matchzySideSelectionEnabled !== initialMatchzySideSelectionEnabled ||
      matchzySideSelectionTime !== initialMatchzySideSelectionTime ||
      matchzyGgEnabled !== initialMatchzyGgEnabled ||
      matchzyGgThreshold !== initialMatchzyGgThreshold ||
      matchzyGgMinScoreDiff !== initialMatchzyGgMinScoreDiff ||
      matchzyFfwEnabled !== initialMatchzyFfwEnabled ||
      matchzyFfwTime !== initialMatchzyFfwTime ||
      matchzyDemoRecordingEnabled !== initialMatchzyDemoRecordingEnabled ||
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

  const handleResetApi = useCallback(async () => {
    setResettingApi(true);

    try {
      await api.post('/api/test/reset-database');
      showSuccess(t('settingsPage.developer.resetApiSuccess'));
      await fetchSettings();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('settingsPage.developer.resetApiError');
      showError(message);
    } finally {
      setResettingApi(false);
      setResetApiDialogOpen(false);
    }
  }, [fetchSettings, showError, showSuccess, t]);

  // Auto-save when values change
  useEffect(() => {
    // Don't auto-save on initial load
    if (loading) return;

    // Don't auto-save if values haven't changed
    if (
      webhookUrl === initialWebhookUrl &&
      matchzyChatPrefix === initialMatchzyChatPrefix &&
      matchzyAdminChatPrefix === initialMatchzyAdminChatPrefix &&
      matchzyKnifeEnabledDefault === initialMatchzyKnifeEnabledDefault &&
      matchzyDebugChatEnabled === initialMatchzyDebugChatEnabled &&
      ratingsEnabled === initialRatingsEnabled &&
      matchzyAutoreadyEnabled === initialMatchzyAutoreadyEnabled &&
      matchzyBothTeamsUnpauseRequired === initialMatchzyBothTeamsUnpauseRequired &&
      matchzyMaxPausesPerTeam === initialMatchzyMaxPausesPerTeam &&
      matchzyPauseDuration === initialMatchzyPauseDuration &&
      matchzySideSelectionEnabled === initialMatchzySideSelectionEnabled &&
      matchzySideSelectionTime === initialMatchzySideSelectionTime &&
      matchzyGgEnabled === initialMatchzyGgEnabled &&
      matchzyGgThreshold === initialMatchzyGgThreshold &&
      matchzyGgMinScoreDiff === initialMatchzyGgMinScoreDiff &&
      matchzyFfwEnabled === initialMatchzyFfwEnabled &&
      matchzyFfwTime === initialMatchzyFfwTime &&
      matchzyDemoRecordingEnabled === initialMatchzyDemoRecordingEnabled &&
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
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    matchzyDebugChatEnabled,
    ratingsEnabled,
    matchzyAutoreadyEnabled,
    matchzyBothTeamsUnpauseRequired,
    matchzyMaxPausesPerTeam,
    matchzyPauseDuration,
    matchzySideSelectionEnabled,
    matchzySideSelectionTime,
    matchzyGgEnabled,
    matchzyGgThreshold,
    matchzyGgMinScoreDiff,
    matchzyFfwEnabled,
    matchzyFfwTime,
    matchzyDemoRecordingEnabled,
    initialWebhookUrl,
    initialMatchzyChatPrefix,
    initialMatchzyAdminChatPrefix,
    initialMatchzyKnifeEnabledDefault,
    initialMatchzyDebugChatEnabled,
    initialRatingsEnabled,
    initialMatchzyAutoreadyEnabled,
    initialMatchzyBothTeamsUnpauseRequired,
    initialMatchzyMaxPausesPerTeam,
    initialMatchzyPauseDuration,
    initialMatchzySideSelectionEnabled,
    initialMatchzySideSelectionTime,
    initialMatchzyGgEnabled,
    initialMatchzyGgThreshold,
    initialMatchzyGgMinScoreDiff,
    initialMatchzyFfwEnabled,
    initialMatchzyFfwTime,
    initialMatchzyDemoRecordingEnabled,
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
        {t('settingsPage.intro')}
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
                aria-label={t('settingsPage.title')}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label={t('settingsPage.tabs.integrations')} {...a11yProps(0)} />
                <Tab label={t('settingsPage.tabs.players')} {...a11yProps(1)} />
                <Tab label={t('settingsPage.tabs.matches')} {...a11yProps(2)} />
                {isDev && <Tab label={t('settingsPage.tabs.developer')} {...a11yProps(3)} />}
              </Tabs>
            </Box>

            <TabPanel value={tabIndex} index={0}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('settingsPage.integrations.webhook.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.integrations.webhook.description')}
                  </Typography>
                  <TextField
                    label={t('settingsPage.integrations.webhook.label')}
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    onBlur={handleFieldBlur}
                    onKeyDown={handleFieldKeyDown}
                    helperText={t('settingsPage.integrations.webhook.helper')}
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
                    {t('settingsPage.integrations.mapSync.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.integrations.mapSync.description')}
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={syncingMaps ? <CircularProgress size={16} /> : <SyncIcon />}
                    onClick={handleSyncMaps}
                    disabled={syncingMaps || loading}
                  >
                    {syncingMaps
                      ? t('settingsPage.integrations.mapSync.buttonSyncing')
                      : t('settingsPage.integrations.mapSync.buttonIdle')}
                  </Button>
                </Box>
              </Stack>
            </TabPanel>

            {/* Players & access control */}
            <TabPanel value={tabIndex} index={1}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    Player registration
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Control whether new Steam logins automatically create player records. When
                    disabled, only players created or imported by admins will appear in private
                    tournaments and shuffle pools.
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={allowSelfRegister}
                        onChange={(event) => setAllowSelfRegister(event.target.checked)}
                        color="primary"
                        size="small"
                      />
                    }
                    label="Allow anyone to register via Steam login"
                  />
                  <Typography variant="caption" color="text.secondary" display="block">
                    Recommended: keep this off for invite‑only or private tournaments so random
                    Steam logins do not pollute the player list.
                  </Typography>
                </Box>

                <Divider />

              </Stack>
            </TabPanel>

            {/* Match behavior and rating rules */}
            <TabPanel value={tabIndex} index={2}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('settingsPage.matchRating.ratings.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.matchRating.ratings.description')}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={ratingsEnabled}
                        onChange={(event) => setRatingsEnabled(event.target.checked)}
                        color="primary"
                        size="small"
                      />
                    }
                    label={t('settingsPage.matchRating.ratings.toggleLabel')}
                  />
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('settingsPage.matchRating.ratings.note')}
                  </Typography>
                </Box>

                <Divider />

                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('settingsPage.matchRating.chatDefaults.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.matchRating.chatDefaults.description')}
                  </Typography>
                  <Stack spacing={2}>
                    <TextField
                      label={t('settingsPage.matchRating.chatDefaults.chatPrefixLabel')}
                      value={matchzyChatPrefix}
                      onChange={(event) => setMatchzyChatPrefix(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      helperText={t(
                        'settingsPage.matchRating.chatDefaults.chatPrefixHelper'
                      )}
                      fullWidth
                    />
                    <TextField
                      label={t('settingsPage.matchRating.chatDefaults.adminChatPrefixLabel')}
                      value={matchzyAdminChatPrefix}
                      onChange={(event) => setMatchzyAdminChatPrefix(event.target.value)}
                      onBlur={handleFieldBlur}
                      onKeyDown={handleFieldKeyDown}
                      helperText={t(
                        'settingsPage.matchRating.chatDefaults.adminChatPrefixHelper'
                      )}
                      fullWidth
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={matchzyKnifeEnabledDefault}
                          onChange={(event) => setMatchzyKnifeEnabledDefault(event.target.checked)}
                          color="primary"
                          size="small"
                        />
                      }
                      label={t(
                        'settingsPage.matchRating.chatDefaults.knifeToggleLabel'
                      )}
                    />
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('settingsPage.matchRating.chatDefaults.knifeNote')}
                    </Typography>
                  </Stack>
                </Box>

                <Divider />

                {/* MatchZy Enhanced v1.3.0 Settings */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('settingsPage.matchRating.matchzyEnhanced.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={3}>
                    {t('settingsPage.matchRating.matchzyEnhanced.description')}
                  </Typography>

                  <Stack spacing={3}>
                    {/* Auto-Ready System */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.autoready.title')}
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={matchzyAutoreadyEnabled === 1}
                            onChange={(e) => setMatchzyAutoreadyEnabled(e.target.checked ? 1 : 0)}
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settingsPage.matchRating.matchzyEnhanced.autoready.label')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settingsPage.matchRating.matchzyEnhanced.autoready.description')}
                      </Typography>
                    </Box>

                    <Divider />

                    {/* Pause System */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.pause.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={matchzyBothTeamsUnpauseRequired === 1}
                              onChange={(e) => setMatchzyBothTeamsUnpauseRequired(e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settingsPage.matchRating.matchzyEnhanced.pause.bothTeamsUnpause')}
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.pause.maxPausesLabel')}
                          type="number"
                          value={matchzyMaxPausesPerTeam ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setMatchzyMaxPausesPerTeam(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.pause.maxPausesHelper')}
                          inputProps={{ min: 0, max: 999 }}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.pause.pauseDurationLabel')}
                          type="number"
                          value={matchzyPauseDuration ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setMatchzyPauseDuration(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.pause.pauseDurationHelper')}
                          inputProps={{ min: 0, max: 999 }}
                          size="small"
                          fullWidth
                        />
                      </Stack>
                    </Box>

                    <Divider />

                    {/* Side Selection */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.sideSelection.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={matchzySideSelectionEnabled === 1}
                              onChange={(e) => setMatchzySideSelectionEnabled(e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settingsPage.matchRating.matchzyEnhanced.sideSelection.enabled')}
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.sideSelection.timeLabel')}
                          type="number"
                          value={matchzySideSelectionTime ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setMatchzySideSelectionTime(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.sideSelection.timeHelper')}
                          inputProps={{ min: 1, max: 999 }}
                          size="small"
                          fullWidth
                          disabled={matchzySideSelectionEnabled !== 1}
                        />
                      </Stack>
                    </Box>

                    <Divider />

                    {/* .gg Command */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.gg.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={matchzyGgEnabled === 1}
                              onChange={(e) => setMatchzyGgEnabled(e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settingsPage.matchRating.matchzyEnhanced.gg.enabled')}
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.gg.thresholdLabel')}
                          type="number"
                          value={matchzyGgThreshold ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            setMatchzyGgThreshold(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.gg.thresholdHelper')}
                          inputProps={{ min: 0, max: 1, step: 0.1 }}
                          size="small"
                          fullWidth
                          disabled={matchzyGgEnabled !== 1}
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.gg.minScoreDiffLabel')}
                          type="number"
                          value={matchzyGgMinScoreDiff ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setMatchzyGgMinScoreDiff(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.gg.minScoreDiffHelper')}
                          inputProps={{ min: 0, max: 16 }}
                          size="small"
                          fullWidth
                          disabled={matchzyGgEnabled !== 1}
                        />
                      </Stack>
                    </Box>

                    <Divider />

                    {/* FFW System */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.ffw.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={matchzyFfwEnabled === 1}
                              onChange={(e) => setMatchzyFfwEnabled(e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settingsPage.matchRating.matchzyEnhanced.ffw.enabled')}
                        />
                        <TextField
                          label={t('settingsPage.matchRating.matchzyEnhanced.ffw.timeLabel')}
                          type="number"
                          value={matchzyFfwTime ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            setMatchzyFfwTime(isNaN(val as number) ? null : val);
                          }}
                          onBlur={handleFieldBlur}
                          helperText={t('settingsPage.matchRating.matchzyEnhanced.ffw.timeHelper')}
                          inputProps={{ min: 1, max: 999 }}
                          size="small"
                          fullWidth
                          disabled={matchzyFfwEnabled !== 1}
                        />
                      </Stack>
                    </Box>

                    <Divider />

                    {/* Demo Recording */}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {t('settingsPage.matchRating.matchzyEnhanced.demo.title')}
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={matchzyDemoRecordingEnabled === 1}
                            onChange={(e) => setMatchzyDemoRecordingEnabled(e.target.checked ? 1 : 0)}
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settingsPage.matchRating.matchzyEnhanced.demo.enabled')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settingsPage.matchRating.matchzyEnhanced.demo.description')}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            </TabPanel>

            {isDev && (
              <TabPanel value={tabIndex} index={3}>
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {t('settingsPage.developer.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      {t('settingsPage.developer.description')}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={matchzyDebugChatEnabled}
                          onChange={(e) => {
                            const newValue = e.target.checked;
                            setMatchzyDebugChatEnabled(newValue);
                            // Pass the new value as an override to handleSave since state updates are async
                            void handleSave(true, { matchzyDebugChatEnabled: newValue });
                          }}
                          size="small"
                          color="primary"
                        />
                      }
                      label={t('settingsPage.developer.debugChat.label')}
                    />
                    <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                      {t('settingsPage.developer.debugChat.description')}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={simulateMatches}
                          onChange={(event) => setSimulateMatches(event.target.checked)}
                          color="error"
                          size="small"
                          inputProps={
                            {
                              'data-testid': 'settings-simulate-matches-toggle',
                            } satisfies React.InputHTMLAttributes<HTMLInputElement>
                          }
                        />
                      }
                      label={
                        <Typography component="span" color="error.main" fontWeight={600}>
                          {t('settingsPage.developer.simulateToggleLabel')}
                        </Typography>
                      }
                    />
                    <Typography variant="caption" color="error.main" display="block" mt={1} fontWeight={500}>
                      {t('settingsPage.developer.simulateNote')}
                    </Typography>
                    <Box mt={3}>
                      <Typography variant="subtitle1" fontWeight={500} gutterBottom>
                        {t('settingsPage.developer.timescaleTitle')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" mb={1}>
                        {t('settingsPage.developer.timescaleDescription')}
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
                          <Typography
                            variant="caption"
                            color="warning.main"
                            sx={{ mt: 1, display: 'block' }}
                          >
                            {t('settingsPage.developer.timescaleWarning')}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                  <Divider />
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom color="error">
                      {t('settingsPage.developer.resetApiTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      {t('settingsPage.developer.resetApiDescription')}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => setResetApiDialogOpen(true)}
                      disabled={resettingApi}
                      data-testid="settings-reset-api-button"
                    >
                      {resettingApi
                        ? t('settingsPage.developer.resetApiButtonLoading')
                        : t('settingsPage.developer.resetApiButton')}
                    </Button>
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
              {t('settingsPage.footer.version')}{' '}
              {typeof __APP_VERSION__ !== 'undefined'
                ? __APP_VERSION__
                : t('settingsPage.footer.unknownVersion')}
            </Typography>

            <Button
              data-testid="settings-save-button"
              onClick={() => setResetDialogOpen(true)}
              disabled={loading || saving}
            >
              {t('settingsPage.footer.resetButton')}
            </Button>
          </Box>

          <Dialog
            open={resetDialogOpen}
            onClose={() => setResetDialogOpen(false)}
            aria-labelledby="reset-settings-dialog-title"
          >
            <DialogTitle id="reset-settings-dialog-title">
              {t('settingsPage.resetDialog.title')}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                {t('settingsPage.resetDialog.description')}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetDialogOpen(false)}>
                {t('settingsPage.resetDialog.cancel')}
              </Button>
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
                      matchzyChatPrefix: null;
                      matchzyAdminChatPrefix: null;
                      matchzyKnifeEnabledDefault: null;
                      matchzyDebugChatEnabled?: boolean;
                      simulateMatches?: boolean;
                      // MatchZy Enhanced v1.3.0 settings - reset to null (use tournament defaults)
                      matchzyAutoreadyEnabled: null;
                      matchzyBothTeamsUnpauseRequired: null;
                      matchzyMaxPausesPerTeam: null;
                      matchzyPauseDuration: null;
                      matchzySideSelectionEnabled: null;
                      matchzySideSelectionTime: null;
                      matchzyGgEnabled: null;
                      matchzyGgThreshold: null;
                      matchzyGgMinScoreDiff: null;
                      matchzyFfwEnabled: null;
                      matchzyFfwTime: null;
                      matchzyDemoRecordingEnabled: null;
                    } = {
                      webhookUrl: null,
                      matchzyChatPrefix: null,
                      matchzyAdminChatPrefix: null,
                      matchzyKnifeEnabledDefault: null,
                      matchzyDebugChatEnabled: false,
                      // MatchZy Enhanced - reset to null to use tournament defaults
                      matchzyAutoreadyEnabled: null,
                      matchzyBothTeamsUnpauseRequired: null,
                      matchzyMaxPausesPerTeam: null,
                      matchzyPauseDuration: null,
                      matchzySideSelectionEnabled: null,
                      matchzySideSelectionTime: null,
                      matchzyGgEnabled: null,
                      matchzyGgThreshold: null,
                      matchzyGgMinScoreDiff: null,
                      matchzyFfwEnabled: null,
                      matchzyFfwTime: null,
                      matchzyDemoRecordingEnabled: null,
                      ...(isDev && { simulateMatches: false }),
                    };

                    const response: SettingsResponse = await api.put(
                      '/api/settings',
                      resetPayload
                    );

                    const newWebhook = response.settings.webhookUrl ?? '';
                    const newSimulate = response.settings.simulateMatches ?? false;
                    const newChatPrefix = response.settings.matchzyChatPrefix ?? '';
                    const newAdminChatPrefix = response.settings.matchzyAdminChatPrefix ?? '';
                    const newKnifeEnabled =
                      response.settings.matchzyKnifeEnabledDefault !== undefined
                        ? response.settings.matchzyKnifeEnabledDefault
                        : true;
                    const newDebugChatEnabled =
                      response.settings.matchzyDebugChatEnabled !== undefined
                        ? response.settings.matchzyDebugChatEnabled
                        : false;
                    // MatchZy Enhanced settings
                    const newMatchzyAutoready = response.settings.matchzyAutoreadyEnabled ?? null;
                    const newMatchzyBothTeamsUnpause = response.settings.matchzyBothTeamsUnpauseRequired ?? null;
                    const newMatchzyMaxPauses = response.settings.matchzyMaxPausesPerTeam ?? null;
                    const newMatchzyPauseDur = response.settings.matchzyPauseDuration ?? null;
                    const newMatchzySideSelEnabled = response.settings.matchzySideSelectionEnabled ?? null;
                    const newMatchzySideSelTime = response.settings.matchzySideSelectionTime ?? null;
                    const newMatchzyGg = response.settings.matchzyGgEnabled ?? null;
                    const newMatchzyGgThresh = response.settings.matchzyGgThreshold ?? null;
                    const newMatchzyGgMinDiff = response.settings.matchzyGgMinScoreDiff ?? null;
                    const newMatchzyFfw = response.settings.matchzyFfwEnabled ?? null;
                    const newMatchzyFfwT = response.settings.matchzyFfwTime ?? null;
                    const newMatchzyDemo = response.settings.matchzyDemoRecordingEnabled ?? null;

                    setWebhookUrl(newWebhook);
                    setInitialWebhookUrl(newWebhook);
                    setSimulateMatches(newSimulate);
                    setInitialSimulateMatches(newSimulate);
                    setMatchzyChatPrefix(newChatPrefix);
                    setInitialMatchzyChatPrefix(newChatPrefix);
                    setMatchzyAdminChatPrefix(newAdminChatPrefix);
                    setInitialMatchzyAdminChatPrefix(newAdminChatPrefix);
                    setMatchzyKnifeEnabledDefault(newKnifeEnabled);
                    setInitialMatchzyKnifeEnabledDefault(newKnifeEnabled);
                    setMatchzyDebugChatEnabled(newDebugChatEnabled);
                    setInitialMatchzyDebugChatEnabled(newDebugChatEnabled);
                    // MatchZy Enhanced
                    setMatchzyAutoreadyEnabled(newMatchzyAutoready);
                    setInitialMatchzyAutoreadyEnabled(newMatchzyAutoready);
                    setMatchzyBothTeamsUnpauseRequired(newMatchzyBothTeamsUnpause);
                    setInitialMatchzyBothTeamsUnpauseRequired(newMatchzyBothTeamsUnpause);
                    setMatchzyMaxPausesPerTeam(newMatchzyMaxPauses);
                    setInitialMatchzyMaxPausesPerTeam(newMatchzyMaxPauses);
                    setMatchzyPauseDuration(newMatchzyPauseDur);
                    setInitialMatchzyPauseDuration(newMatchzyPauseDur);
                    setMatchzySideSelectionEnabled(newMatchzySideSelEnabled);
                    setInitialMatchzySideSelectionEnabled(newMatchzySideSelEnabled);
                    setMatchzySideSelectionTime(newMatchzySideSelTime);
                    setInitialMatchzySideSelectionTime(newMatchzySideSelTime);
                    setMatchzyGgEnabled(newMatchzyGg);
                    setInitialMatchzyGgEnabled(newMatchzyGg);
                    setMatchzyGgThreshold(newMatchzyGgThresh);
                    setInitialMatchzyGgThreshold(newMatchzyGgThresh);
                    setMatchzyGgMinScoreDiff(newMatchzyGgMinDiff);
                    setInitialMatchzyGgMinScoreDiff(newMatchzyGgMinDiff);
                    setMatchzyFfwEnabled(newMatchzyFfw);
                    setInitialMatchzyFfwEnabled(newMatchzyFfw);
                    setMatchzyFfwTime(newMatchzyFfwT);
                    setInitialMatchzyFfwTime(newMatchzyFfwT);
                    setMatchzyDemoRecordingEnabled(newMatchzyDemo);
                    setInitialMatchzyDemoRecordingEnabled(newMatchzyDemo);

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
                {t('settingsPage.resetDialog.confirm')}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={resetApiDialogOpen}
            onClose={() => {
              if (!resettingApi) {
                setResetApiDialogOpen(false);
              }
            }}
            aria-labelledby="reset-api-dialog-title"
          >
            <DialogTitle id="reset-api-dialog-title">
              {t('settingsPage.developer.resetApiDialog.title')}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                {t('settingsPage.developer.resetApiDialog.description')}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetApiDialogOpen(false)} disabled={resettingApi}>
                {t('settingsPage.developer.resetApiDialog.cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={handleResetApi}
                disabled={resettingApi}
                autoFocus
              >
                {resettingApi
                  ? t('settingsPage.developer.resetApiDialog.confirmLoading')
                  : t('settingsPage.developer.resetApiDialog.confirm')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
