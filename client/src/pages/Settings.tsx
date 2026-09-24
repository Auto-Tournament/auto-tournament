import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Typography,
  Alert,
  Paper,
  Stack,
  TextField,
  Button,
  LinearProgress,
  Divider,
  CircularProgress,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
} from '@mui/material';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import SyncIcon from '@mui/icons-material/Sync';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { IgdbCredentialsCard } from '../components/games/IgdbCredentialsCard';

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
  const DEFAULT_AT_CHAT_PREFIX = '[{Green}MAT{Default}]';
  const DEFAULT_AT_ADMIN_CHAT_PREFIX = '[{Red}ADMIN{Default}]';
  const [webhookUrl, setWebhookUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingMaps, setSyncingMaps] = useState(false);
  const [initialWebhookUrl, setInitialWebhookUrl] = useState('');
  const [simulateMatches, setSimulateMatches] = useState(false);
  const [initialSimulateMatches, setInitialSimulateMatches] = useState(false);
  const [simulationTimescale, setSimulationTimescale] = useState<number>(1);
  const [initialSimulationTimescale, setInitialSimulationTimescale] = useState<number>(1);
  const [atChatPrefix, setAtChatPrefix] = useState(DEFAULT_AT_CHAT_PREFIX);
  const [initialAtChatPrefix, setInitialAtChatPrefix] =
    useState(DEFAULT_AT_CHAT_PREFIX);
  const [atAdminChatPrefix, setAtAdminChatPrefix] = useState(
    DEFAULT_AT_ADMIN_CHAT_PREFIX
  );
  const [initialAtAdminChatPrefix, setInitialAtAdminChatPrefix] = useState(
    DEFAULT_AT_ADMIN_CHAT_PREFIX
  );
  const [atKnifeEnabledDefault, setAtKnifeEnabledDefault] = useState(true);
  const [initialAtKnifeEnabledDefault, setInitialAtKnifeEnabledDefault] = useState(true);
  const [ratingsEnabled, setRatingsEnabled] = useState(true);
  const [initialRatingsEnabled, setInitialRatingsEnabled] = useState(true);
  const [atDebugChatEnabled, setAtDebugChatEnabled] = useState(false);
  const [initialAtDebugChatEnabled, setInitialAtDebugChatEnabled] = useState(false);
  const [allowSelfRegister, setAllowSelfRegister] = useState(false);
  const [initialAllowSelfRegister, setInitialAllowSelfRegister] = useState(false);
  // Auto Tournament CS2 core defaults
  const [atAutostartMode, setAtAutostartMode] = useState<0 | 1 | 2>(1);
  const [initialAtAutostartMode, setInitialAtAutostartMode] = useState<0 | 1 | 2>(1);
  const [atMinimumReadyRequired, setAtMinimumReadyRequired] = useState<number>(0);
  const [initialAtMinimumReadyRequired, setInitialAtMinimumReadyRequired] =
    useState<number>(0);
  const [atAllowForceReady, setAtAllowForceReady] = useState<boolean>(true);
  const [initialAtAllowForceReady, setInitialAtAllowForceReady] =
    useState<boolean>(true);
  const [atKickWhenNoMatchLoaded, setAtKickWhenNoMatchLoaded] =
    useState<boolean>(false);
  const [initialAtKickWhenNoMatchLoaded, setInitialAtKickWhenNoMatchLoaded] =
    useState<boolean>(false);
  const [atWhitelistEnabledDefault, setAtWhitelistEnabledDefault] =
    useState<boolean>(false);
  const [initialAtWhitelistEnabledDefault, setInitialAtWhitelistEnabledDefault] =
    useState<boolean>(false);
  const [atPauseAfterRestore, setAtPauseAfterRestore] = useState<boolean>(true);
  const [initialAtPauseAfterRestore, setInitialAtPauseAfterRestore] =
    useState<boolean>(true);
  const [atStopCommandAvailable, setAtStopCommandAvailable] =
    useState<boolean>(false);
  const [initialAtStopCommandAvailable, setInitialAtStopCommandAvailable] =
    useState<boolean>(false);
  const [atStopCommandNoDamage, setAtStopCommandNoDamage] = useState<boolean>(false);
  const [initialAtStopCommandNoDamage, setInitialAtStopCommandNoDamage] =
    useState<boolean>(false);
  const [atUsePauseCommandForTacticalPause, setAtUsePauseCommandForTacticalPause] =
    useState<boolean>(false);
  const [
    initialAtUsePauseCommandForTacticalPause,
    setInitialAtUsePauseCommandForTacticalPause,
  ] = useState<boolean>(false);
  // '' is a real value here: it tells Auto Tournament CS2 to leave the server's own
  // hostname alone, so it is never folded into the default on the way in or out.
  const [atHostnameFormat, setAtHostnameFormat] = useState<string>('{TEAM1} vs {TEAM2}');
  const [initialAtHostnameFormat, setInitialAtHostnameFormat] = useState<string>('{TEAM1} vs {TEAM2}');
  const [atDemoPath, setAtDemoPath] = useState<string>('AutoTournamentCS2/');
  const [initialAtDemoPath, setInitialAtDemoPath] = useState<string>('AutoTournamentCS2/');
  const [atDemoNameFormat, setAtDemoNameFormat] = useState<string>(
    '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}'
  );
  const [initialAtDemoNameFormat, setInitialAtDemoNameFormat] = useState<string>(
    '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}'
  );
  const [atSeriesEndKickDelayNoDemo, setAtSeriesEndKickDelayNoDemo] =
    useState<number>(5);
  const [initialAtSeriesEndKickDelayNoDemo, setInitialAtSeriesEndKickDelayNoDemo] =
    useState<number>(5);
  const [atSeriesEndKickDelayDemoNoUpload, setAtSeriesEndKickDelayDemoNoUpload] =
    useState<number>(10);
  const [
    initialAtSeriesEndKickDelayDemoNoUpload,
    setInitialAtSeriesEndKickDelayDemoNoUpload,
  ] = useState<number>(10);
  const [atSeriesEndKickDelayDemoUpload, setAtSeriesEndKickDelayDemoUpload] =
    useState<number>(60);
  const [initialAtSeriesEndKickDelayDemoUpload, setInitialAtSeriesEndKickDelayDemoUpload] =
    useState<number>(60);
  // Auto Tournament CS2 v1.3.0 settings
  const [atAutoreadyEnabled, setAtAutoreadyEnabled] = useState<0 | 1 | null>(null);
  const [initialAtAutoreadyEnabled, setInitialAtAutoreadyEnabled] = useState<0 | 1 | null>(null);
  const [atBothTeamsUnpauseRequired, setAtBothTeamsUnpauseRequired] = useState<0 | 1 | null>(null);
  const [initialAtBothTeamsUnpauseRequired, setInitialAtBothTeamsUnpauseRequired] = useState<0 | 1 | null>(null);
  const [atMaxPausesPerTeam, setAtMaxPausesPerTeam] = useState<number | null>(null);
  const [initialAtMaxPausesPerTeam, setInitialAtMaxPausesPerTeam] = useState<number | null>(null);
  const [atPauseDuration, setAtPauseDuration] = useState<number | null>(null);
  const [initialAtPauseDuration, setInitialAtPauseDuration] = useState<number | null>(null);
  const [atSideSelectionEnabled, setAtSideSelectionEnabled] = useState<0 | 1 | null>(null);
  const [initialAtSideSelectionEnabled, setInitialAtSideSelectionEnabled] = useState<0 | 1 | null>(null);
  const [atSideSelectionTime, setAtSideSelectionTime] = useState<number | null>(null);
  const [initialAtSideSelectionTime, setInitialAtSideSelectionTime] = useState<number | null>(null);
  const [atGgEnabled, setAtGgEnabled] = useState<0 | 1 | null>(null);
  const [initialAtGgEnabled, setInitialAtGgEnabled] = useState<0 | 1 | null>(null);
  const [atGgThreshold, setAtGgThreshold] = useState<number | null>(null);
  const [initialAtGgThreshold, setInitialAtGgThreshold] = useState<number | null>(null);
  const [atGgMinScoreDiff, setAtGgMinScoreDiff] = useState<number | null>(null);
  const [initialAtGgMinScoreDiff, setInitialAtGgMinScoreDiff] = useState<number | null>(null);
  const [atFfwEnabled, setAtFfwEnabled] = useState<0 | 1 | null>(null);
  const [initialAtFfwEnabled, setInitialAtFfwEnabled] = useState<0 | 1 | null>(null);
  const [atFfwTime, setAtFfwTime] = useState<number | null>(null);
  const [initialAtFfwTime, setInitialAtFfwTime] = useState<number | null>(null);
  const [atDemoRecordingEnabled, setAtDemoRecordingEnabled] = useState<0 | 1 | null>(null);
  const [initialAtDemoRecordingEnabled, setInitialAtDemoRecordingEnabled] = useState<0 | 1 | null>(null);
  const [resetApiDialogOpen, setResetApiDialogOpen] = useState(false);
  const [resettingApi, setResettingApi] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const isDev = useIsDevelopment();
  const [tabIndex, setTabIndex] = useState(0);
  const { t } = useTranslation();

  const ACCORDION_SX = {
    bgcolor: 'background.paper',
    border: 1,
    borderColor: 'divider',
    boxShadow: 'none',
    // MUI renders a default divider line via :before; hide it so our border is the only separator
    '&:before': { display: 'none' },
  } as const;

  const ACCORDION_SUMMARY_SX = {
    bgcolor: 'background.paper',
  } as const;

  const ACCORDION_DETAILS_SX = {
    bgcolor: 'background.surface2',
    borderTop: 1,
    borderColor: 'divider',
  } as const;

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
      const chatPrefix = response.settings.atChatPrefix ?? DEFAULT_AT_CHAT_PREFIX;
      const adminChatPrefix =
        response.settings.atAdminChatPrefix ?? DEFAULT_AT_ADMIN_CHAT_PREFIX;
      const knifeEnabled =
        response.settings.atKnifeEnabledDefault !== undefined
          ? response.settings.atKnifeEnabledDefault
          : true;
      const ratingsEnabledValue =
        response.settings.ratingsEnabled !== undefined ? response.settings.ratingsEnabled : true;
      const debugChatEnabled =
        response.settings.atDebugChatEnabled !== undefined
          ? response.settings.atDebugChatEnabled
          : false;
      const allowSelfRegisterValue =
        response.settings.allowSelfRegister !== undefined
          ? response.settings.allowSelfRegister
          : false;
      // Auto Tournament CS2 core defaults
      const autostartMode = response.settings.atAutostartMode ?? 1;
      const minimumReadyRequired = response.settings.atMinimumReadyRequired ?? 0;
      const allowForceReady = response.settings.atAllowForceReady ?? true;
      const kickWhenNoMatchLoaded = response.settings.atKickWhenNoMatchLoaded ?? false;
      const whitelistEnabledDefault = response.settings.atWhitelistEnabledDefault ?? false;
      const pauseAfterRestore = response.settings.atPauseAfterRestore ?? true;
      const stopCommandAvailable = response.settings.atStopCommandAvailable ?? false;
      const stopCommandNoDamage = response.settings.atStopCommandNoDamage ?? false;
      const usePauseCommandForTacticalPause =
        response.settings.atUsePauseCommandForTacticalPause ?? false;
      const hostnameFormat = response.settings.atHostnameFormat ?? '{TEAM1} vs {TEAM2}';
      const demoPath = response.settings.atDemoPath ?? 'AutoTournamentCS2/';
      const demoNameFormat =
        response.settings.atDemoNameFormat ?? '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}';
      const seriesEndKickDelayNoDemo = response.settings.atSeriesEndKickDelayNoDemo ?? 5;
      const seriesEndKickDelayDemoNoUpload =
        response.settings.atSeriesEndKickDelayDemoNoUpload ?? 10;
      const seriesEndKickDelayDemoUpload =
        response.settings.atSeriesEndKickDelayDemoUpload ?? 60;
      // Auto Tournament CS2 v1.3.0 settings
      const atAutoready = response.settings.atAutoreadyEnabled ?? null;
      const atBothTeamsUnpause = response.settings.atBothTeamsUnpauseRequired ?? null;
      const atMaxPauses = response.settings.atMaxPausesPerTeam ?? null;
      const atPauseDur = response.settings.atPauseDuration ?? null;
      const atSideSelEnabled = response.settings.atSideSelectionEnabled ?? null;
      const atSideSelTime = response.settings.atSideSelectionTime ?? null;
      const atGg = response.settings.atGgEnabled ?? null;
      const atGgThresh = response.settings.atGgThreshold ?? null;
      const atGgMinDiff = response.settings.atGgMinScoreDiff ?? null;
      const atFfw = response.settings.atFfwEnabled ?? null;
      const atFfwT = response.settings.atFfwTime ?? null;
      const atDemo = response.settings.atDemoRecordingEnabled ?? null;
      
      setWebhookUrl(webhook);
      setInitialWebhookUrl(webhook);
      setSimulateMatches(simulate);
      setInitialSimulateMatches(simulate);
      setSimulationTimescale(timescale);
      setInitialSimulationTimescale(timescale);
      setAtChatPrefix(chatPrefix);
      setInitialAtChatPrefix(chatPrefix);
      setAtAdminChatPrefix(adminChatPrefix);
      setInitialAtAdminChatPrefix(adminChatPrefix);
      setAtKnifeEnabledDefault(knifeEnabled);
      setInitialAtKnifeEnabledDefault(knifeEnabled);
      setAtDebugChatEnabled(debugChatEnabled);
      setInitialAtDebugChatEnabled(debugChatEnabled);
      setAllowSelfRegister(allowSelfRegisterValue);
      setInitialAllowSelfRegister(allowSelfRegisterValue);
      setRatingsEnabled(ratingsEnabledValue);
      setInitialRatingsEnabled(ratingsEnabledValue);
      setAtAutostartMode(autostartMode);
      setInitialAtAutostartMode(autostartMode);
      setAtMinimumReadyRequired(minimumReadyRequired);
      setInitialAtMinimumReadyRequired(minimumReadyRequired);
      setAtAllowForceReady(allowForceReady);
      setInitialAtAllowForceReady(allowForceReady);
      setAtKickWhenNoMatchLoaded(kickWhenNoMatchLoaded);
      setInitialAtKickWhenNoMatchLoaded(kickWhenNoMatchLoaded);
      setAtWhitelistEnabledDefault(whitelistEnabledDefault);
      setInitialAtWhitelistEnabledDefault(whitelistEnabledDefault);
      setAtPauseAfterRestore(pauseAfterRestore);
      setInitialAtPauseAfterRestore(pauseAfterRestore);
      setAtStopCommandAvailable(stopCommandAvailable);
      setInitialAtStopCommandAvailable(stopCommandAvailable);
      setAtStopCommandNoDamage(stopCommandNoDamage);
      setInitialAtStopCommandNoDamage(stopCommandNoDamage);
      setAtUsePauseCommandForTacticalPause(usePauseCommandForTacticalPause);
      setInitialAtUsePauseCommandForTacticalPause(usePauseCommandForTacticalPause);
      setAtHostnameFormat(hostnameFormat);
      setInitialAtHostnameFormat(hostnameFormat);
      setAtDemoPath(demoPath);
      setInitialAtDemoPath(demoPath);
      setAtDemoNameFormat(demoNameFormat);
      setInitialAtDemoNameFormat(demoNameFormat);
      setAtSeriesEndKickDelayNoDemo(seriesEndKickDelayNoDemo);
      setInitialAtSeriesEndKickDelayNoDemo(seriesEndKickDelayNoDemo);
      setAtSeriesEndKickDelayDemoNoUpload(seriesEndKickDelayDemoNoUpload);
      setInitialAtSeriesEndKickDelayDemoNoUpload(seriesEndKickDelayDemoNoUpload);
      setAtSeriesEndKickDelayDemoUpload(seriesEndKickDelayDemoUpload);
      setInitialAtSeriesEndKickDelayDemoUpload(seriesEndKickDelayDemoUpload);
      // Auto Tournament CS2
      setAtAutoreadyEnabled(atAutoready);
      setInitialAtAutoreadyEnabled(atAutoready);
      setAtBothTeamsUnpauseRequired(atBothTeamsUnpause);
      setInitialAtBothTeamsUnpauseRequired(atBothTeamsUnpause);
      setAtMaxPausesPerTeam(atMaxPauses);
      setInitialAtMaxPausesPerTeam(atMaxPauses);
      setAtPauseDuration(atPauseDur);
      setInitialAtPauseDuration(atPauseDur);
      setAtSideSelectionEnabled(atSideSelEnabled);
      setInitialAtSideSelectionEnabled(atSideSelEnabled);
      setAtSideSelectionTime(atSideSelTime);
      setInitialAtSideSelectionTime(atSideSelTime);
      setAtGgEnabled(atGg);
      setInitialAtGgEnabled(atGg);
      setAtGgThreshold(atGgThresh);
      setInitialAtGgThreshold(atGgThresh);
      setAtGgMinScoreDiff(atGgMinDiff);
      setInitialAtGgMinScoreDiff(atGgMinDiff);
      setAtFfwEnabled(atFfw);
      setInitialAtFfwEnabled(atFfw);
      setAtFfwTime(atFfwT);
      setInitialAtFfwTime(atFfwT);
      setAtDemoRecordingEnabled(atDemo);
      setInitialAtDemoRecordingEnabled(atDemo);
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
    async (showSuccessMessage = true, overrides?: { atDebugChatEnabled?: boolean }) => {
      setSaving(true);

      // Cancel any pending auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      try {
        const payload = {
          webhookUrl: webhookUrl.trim() === '' ? null : webhookUrl.trim(),
          atChatPrefix: atChatPrefix.trim() === '' ? null : atChatPrefix.trim(),
          atAdminChatPrefix:
            atAdminChatPrefix.trim() === '' ? null : atAdminChatPrefix.trim(),
          atKnifeEnabledDefault,
          ratingsEnabled,
          atDebugChatEnabled: overrides?.atDebugChatEnabled ?? atDebugChatEnabled,
          allowSelfRegister,
          // Auto Tournament CS2 core defaults
          atAutostartMode,
          atMinimumReadyRequired,
          atAllowForceReady,
          atKickWhenNoMatchLoaded,
          atWhitelistEnabledDefault,
          atPauseAfterRestore,
          atStopCommandAvailable,
          atStopCommandNoDamage,
          atUsePauseCommandForTacticalPause,
          atHostnameFormat: atHostnameFormat.trim(),
          atDemoPath: atDemoPath.trim(),
          atDemoNameFormat: atDemoNameFormat.trim(),
          atSeriesEndKickDelayNoDemo,
          atSeriesEndKickDelayDemoNoUpload,
          atSeriesEndKickDelayDemoUpload,
          // Auto Tournament CS2 v1.3.0 settings
          atAutoreadyEnabled,
          atBothTeamsUnpauseRequired,
          atMaxPausesPerTeam,
          atPauseDuration,
          atSideSelectionEnabled,
          atSideSelectionTime,
          atGgEnabled,
          atGgThreshold,
          atGgMinScoreDiff,
          atFfwEnabled,
          atFfwTime,
          atDemoRecordingEnabled,
          // Only send developer options from dev builds to keep this feature
          // clearly scoped to development environments.
          ...(isDev && { simulateMatches, simulationTimescale }),
        };

        const response: SettingsResponse = await api.put('/api/settings', payload);
        const newWebhook = response.settings.webhookUrl ?? '';
        const newSimulate = response.settings.simulateMatches ?? false;
        const newTimescale = response.settings.simulationTimescale ?? 1;
        const newChatPrefix = response.settings.atChatPrefix ?? DEFAULT_AT_CHAT_PREFIX;
        const newAdminChatPrefix =
          response.settings.atAdminChatPrefix ?? DEFAULT_AT_ADMIN_CHAT_PREFIX;
        const newKnifeEnabled =
          response.settings.atKnifeEnabledDefault !== undefined
            ? response.settings.atKnifeEnabledDefault
            : true;
        const newRatingsEnabled =
          response.settings.ratingsEnabled !== undefined
            ? response.settings.ratingsEnabled
            : true;
        const newDebugChatEnabled =
          response.settings.atDebugChatEnabled !== undefined
            ? response.settings.atDebugChatEnabled
            : false;
        const newAllowSelfRegister =
          response.settings.allowSelfRegister !== undefined
            ? response.settings.allowSelfRegister
            : false;
        const newAutostartMode = response.settings.atAutostartMode ?? 1;
        const newMinimumReadyRequired = response.settings.atMinimumReadyRequired ?? 0;
        const newAllowForceReady = response.settings.atAllowForceReady ?? true;
        const newKickWhenNoMatchLoaded = response.settings.atKickWhenNoMatchLoaded ?? false;
        const newWhitelistEnabledDefault = response.settings.atWhitelistEnabledDefault ?? false;
        const newPauseAfterRestore = response.settings.atPauseAfterRestore ?? true;
        const newStopCommandAvailable = response.settings.atStopCommandAvailable ?? false;
        const newStopCommandNoDamage = response.settings.atStopCommandNoDamage ?? false;
        const newUsePauseCommandForTacticalPause =
          response.settings.atUsePauseCommandForTacticalPause ?? false;
        const newHostnameFormat = response.settings.atHostnameFormat ?? '{TEAM1} vs {TEAM2}';
        const newDemoPath = response.settings.atDemoPath ?? 'AutoTournamentCS2/';
        const newDemoNameFormat =
          response.settings.atDemoNameFormat ?? '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}';
        const newSeriesEndKickDelayNoDemo = response.settings.atSeriesEndKickDelayNoDemo ?? 5;
        const newSeriesEndKickDelayDemoNoUpload =
          response.settings.atSeriesEndKickDelayDemoNoUpload ?? 10;
        const newSeriesEndKickDelayDemoUpload =
          response.settings.atSeriesEndKickDelayDemoUpload ?? 60;
        // Auto Tournament CS2 v1.3.0 settings
        const newAtAutoready = response.settings.atAutoreadyEnabled ?? null;
        const newAtBothTeamsUnpause = response.settings.atBothTeamsUnpauseRequired ?? null;
        const newAtMaxPauses = response.settings.atMaxPausesPerTeam ?? null;
        const newAtPauseDur = response.settings.atPauseDuration ?? null;
        const newAtSideSelEnabled = response.settings.atSideSelectionEnabled ?? null;
        const newAtSideSelTime = response.settings.atSideSelectionTime ?? null;
        const newAtGg = response.settings.atGgEnabled ?? null;
        const newAtGgThresh = response.settings.atGgThreshold ?? null;
        const newAtGgMinDiff = response.settings.atGgMinScoreDiff ?? null;
        const newAtFfw = response.settings.atFfwEnabled ?? null;
        const newAtFfwT = response.settings.atFfwTime ?? null;
        const newAtDemo = response.settings.atDemoRecordingEnabled ?? null;
        
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
        setAtChatPrefix(newChatPrefix);
        setInitialAtChatPrefix(newChatPrefix);
        setAtAdminChatPrefix(newAdminChatPrefix);
        setInitialAtAdminChatPrefix(newAdminChatPrefix);
        setAtKnifeEnabledDefault(newKnifeEnabled);
        setInitialAtKnifeEnabledDefault(newKnifeEnabled);
        setRatingsEnabled(newRatingsEnabled);
        setInitialRatingsEnabled(newRatingsEnabled);
        setAtDebugChatEnabled(newDebugChatEnabled);
        setInitialAtDebugChatEnabled(newDebugChatEnabled);
        setAllowSelfRegister(newAllowSelfRegister);
        setInitialAllowSelfRegister(newAllowSelfRegister);
        setAtAutostartMode(newAutostartMode);
        setInitialAtAutostartMode(newAutostartMode);
        setAtMinimumReadyRequired(newMinimumReadyRequired);
        setInitialAtMinimumReadyRequired(newMinimumReadyRequired);
        setAtAllowForceReady(newAllowForceReady);
        setInitialAtAllowForceReady(newAllowForceReady);
        setAtKickWhenNoMatchLoaded(newKickWhenNoMatchLoaded);
        setInitialAtKickWhenNoMatchLoaded(newKickWhenNoMatchLoaded);
        setAtWhitelistEnabledDefault(newWhitelistEnabledDefault);
        setInitialAtWhitelistEnabledDefault(newWhitelistEnabledDefault);
        setAtPauseAfterRestore(newPauseAfterRestore);
        setInitialAtPauseAfterRestore(newPauseAfterRestore);
        setAtStopCommandAvailable(newStopCommandAvailable);
        setInitialAtStopCommandAvailable(newStopCommandAvailable);
        setAtStopCommandNoDamage(newStopCommandNoDamage);
        setInitialAtStopCommandNoDamage(newStopCommandNoDamage);
        setAtUsePauseCommandForTacticalPause(newUsePauseCommandForTacticalPause);
        setInitialAtUsePauseCommandForTacticalPause(newUsePauseCommandForTacticalPause);
        setAtHostnameFormat(newHostnameFormat);
        setInitialAtHostnameFormat(newHostnameFormat);
        setAtDemoPath(newDemoPath);
        setInitialAtDemoPath(newDemoPath);
        setAtDemoNameFormat(newDemoNameFormat);
        setInitialAtDemoNameFormat(newDemoNameFormat);
        setAtSeriesEndKickDelayNoDemo(newSeriesEndKickDelayNoDemo);
        setInitialAtSeriesEndKickDelayNoDemo(newSeriesEndKickDelayNoDemo);
        setAtSeriesEndKickDelayDemoNoUpload(newSeriesEndKickDelayDemoNoUpload);
        setInitialAtSeriesEndKickDelayDemoNoUpload(newSeriesEndKickDelayDemoNoUpload);
        setAtSeriesEndKickDelayDemoUpload(newSeriesEndKickDelayDemoUpload);
        setInitialAtSeriesEndKickDelayDemoUpload(newSeriesEndKickDelayDemoUpload);
        // Auto Tournament CS2
        setAtAutoreadyEnabled(newAtAutoready);
        setInitialAtAutoreadyEnabled(newAtAutoready);
        setAtBothTeamsUnpauseRequired(newAtBothTeamsUnpause);
        setInitialAtBothTeamsUnpauseRequired(newAtBothTeamsUnpause);
        setAtMaxPausesPerTeam(newAtMaxPauses);
        setInitialAtMaxPausesPerTeam(newAtMaxPauses);
        setAtPauseDuration(newAtPauseDur);
        setInitialAtPauseDuration(newAtPauseDur);
        setAtSideSelectionEnabled(newAtSideSelEnabled);
        setInitialAtSideSelectionEnabled(newAtSideSelEnabled);
        setAtSideSelectionTime(newAtSideSelTime);
        setInitialAtSideSelectionTime(newAtSideSelTime);
        setAtGgEnabled(newAtGg);
        setInitialAtGgEnabled(newAtGg);
        setAtGgThreshold(newAtGgThresh);
        setInitialAtGgThreshold(newAtGgThresh);
        setAtGgMinScoreDiff(newAtGgMinDiff);
        setInitialAtGgMinScoreDiff(newAtGgMinDiff);
        setAtFfwEnabled(newAtFfw);
        setInitialAtFfwEnabled(newAtFfw);
        setAtFfwTime(newAtFfwT);
        setInitialAtFfwTime(newAtFfwT);
        setAtDemoRecordingEnabled(newAtDemo);
        setInitialAtDemoRecordingEnabled(newAtDemo);

        if (showSuccessMessage) {
          showSuccess(t('settingsPage.success.saveSettings'));

          if (simulationToggled) {
            showSnackbar(
              newSimulate
                ? isDev
                  ? t('settingsPage.success.simulationEnabledWithSpeed', {
                      speed: newTimescale.toFixed(1),
                    })
                  : t('settingsPage.success.simulationEnabled')
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
          new CustomEvent<SettingsResponse['settings']>('at:settingsUpdated', {
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
      atChatPrefix,
      atAdminChatPrefix,
      atKnifeEnabledDefault,
      ratingsEnabled,
      atDebugChatEnabled,
      simulateMatches,
      simulationTimescale,
      allowSelfRegister,
      atAutostartMode,
      atMinimumReadyRequired,
      atAllowForceReady,
      atKickWhenNoMatchLoaded,
      atWhitelistEnabledDefault,
      atPauseAfterRestore,
      atStopCommandAvailable,
      atStopCommandNoDamage,
      atUsePauseCommandForTacticalPause,
      atHostnameFormat,
      atDemoPath,
      atDemoNameFormat,
      atSeriesEndKickDelayNoDemo,
      atSeriesEndKickDelayDemoNoUpload,
      atSeriesEndKickDelayDemoUpload,
      atAutoreadyEnabled,
      atBothTeamsUnpauseRequired,
      atMaxPausesPerTeam,
      atPauseDuration,
      atSideSelectionEnabled,
      atSideSelectionTime,
      atGgEnabled,
      atGgThreshold,
      atGgMinScoreDiff,
      atFfwEnabled,
      atFfwTime,
      atDemoRecordingEnabled,
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
      atChatPrefix !== initialAtChatPrefix ||
      atAdminChatPrefix !== initialAtAdminChatPrefix ||
      atKnifeEnabledDefault !== initialAtKnifeEnabledDefault ||
      ratingsEnabled !== initialRatingsEnabled ||
      atDebugChatEnabled !== initialAtDebugChatEnabled ||
      allowSelfRegister !== initialAllowSelfRegister ||
      atAutostartMode !== initialAtAutostartMode ||
      atMinimumReadyRequired !== initialAtMinimumReadyRequired ||
      atAllowForceReady !== initialAtAllowForceReady ||
      atKickWhenNoMatchLoaded !== initialAtKickWhenNoMatchLoaded ||
      atWhitelistEnabledDefault !== initialAtWhitelistEnabledDefault ||
      atPauseAfterRestore !== initialAtPauseAfterRestore ||
      atStopCommandAvailable !== initialAtStopCommandAvailable ||
      atStopCommandNoDamage !== initialAtStopCommandNoDamage ||
      atUsePauseCommandForTacticalPause !== initialAtUsePauseCommandForTacticalPause ||
      atHostnameFormat !== initialAtHostnameFormat ||
      atDemoPath !== initialAtDemoPath ||
      atDemoNameFormat !== initialAtDemoNameFormat ||
      atSeriesEndKickDelayNoDemo !== initialAtSeriesEndKickDelayNoDemo ||
      atSeriesEndKickDelayDemoNoUpload !== initialAtSeriesEndKickDelayDemoNoUpload ||
      atSeriesEndKickDelayDemoUpload !== initialAtSeriesEndKickDelayDemoUpload ||
      atAutoreadyEnabled !== initialAtAutoreadyEnabled ||
      atBothTeamsUnpauseRequired !== initialAtBothTeamsUnpauseRequired ||
      atMaxPausesPerTeam !== initialAtMaxPausesPerTeam ||
      atPauseDuration !== initialAtPauseDuration ||
      atSideSelectionEnabled !== initialAtSideSelectionEnabled ||
      atSideSelectionTime !== initialAtSideSelectionTime ||
      atGgEnabled !== initialAtGgEnabled ||
      atGgThreshold !== initialAtGgThreshold ||
      atGgMinScoreDiff !== initialAtGgMinScoreDiff ||
      atFfwEnabled !== initialAtFfwEnabled ||
      atFfwTime !== initialAtFfwTime ||
      atDemoRecordingEnabled !== initialAtDemoRecordingEnabled ||
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
      atChatPrefix === initialAtChatPrefix &&
      atAdminChatPrefix === initialAtAdminChatPrefix &&
      atKnifeEnabledDefault === initialAtKnifeEnabledDefault &&
      atDebugChatEnabled === initialAtDebugChatEnabled &&
      ratingsEnabled === initialRatingsEnabled &&
      allowSelfRegister === initialAllowSelfRegister &&
      atAutostartMode === initialAtAutostartMode &&
      atMinimumReadyRequired === initialAtMinimumReadyRequired &&
      atAllowForceReady === initialAtAllowForceReady &&
      atKickWhenNoMatchLoaded === initialAtKickWhenNoMatchLoaded &&
      atWhitelistEnabledDefault === initialAtWhitelistEnabledDefault &&
      atPauseAfterRestore === initialAtPauseAfterRestore &&
      atStopCommandAvailable === initialAtStopCommandAvailable &&
      atStopCommandNoDamage === initialAtStopCommandNoDamage &&
      atUsePauseCommandForTacticalPause === initialAtUsePauseCommandForTacticalPause &&
      atHostnameFormat === initialAtHostnameFormat &&
      atDemoPath === initialAtDemoPath &&
      atDemoNameFormat === initialAtDemoNameFormat &&
      atSeriesEndKickDelayNoDemo === initialAtSeriesEndKickDelayNoDemo &&
      atSeriesEndKickDelayDemoNoUpload === initialAtSeriesEndKickDelayDemoNoUpload &&
      atSeriesEndKickDelayDemoUpload === initialAtSeriesEndKickDelayDemoUpload &&
      atAutoreadyEnabled === initialAtAutoreadyEnabled &&
      atBothTeamsUnpauseRequired === initialAtBothTeamsUnpauseRequired &&
      atMaxPausesPerTeam === initialAtMaxPausesPerTeam &&
      atPauseDuration === initialAtPauseDuration &&
      atSideSelectionEnabled === initialAtSideSelectionEnabled &&
      atSideSelectionTime === initialAtSideSelectionTime &&
      atGgEnabled === initialAtGgEnabled &&
      atGgThreshold === initialAtGgThreshold &&
      atGgMinScoreDiff === initialAtGgMinScoreDiff &&
      atFfwEnabled === initialAtFfwEnabled &&
      atFfwTime === initialAtFfwTime &&
      atDemoRecordingEnabled === initialAtDemoRecordingEnabled &&
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
    atChatPrefix,
    atAdminChatPrefix,
    atKnifeEnabledDefault,
    atDebugChatEnabled,
    ratingsEnabled,
    allowSelfRegister,
    atAutostartMode,
    atMinimumReadyRequired,
    atAllowForceReady,
    atKickWhenNoMatchLoaded,
    atWhitelistEnabledDefault,
    atPauseAfterRestore,
    atStopCommandAvailable,
    atStopCommandNoDamage,
    atUsePauseCommandForTacticalPause,
    atHostnameFormat,
    atDemoPath,
    atDemoNameFormat,
    atSeriesEndKickDelayNoDemo,
    atSeriesEndKickDelayDemoNoUpload,
    atSeriesEndKickDelayDemoUpload,
    atAutoreadyEnabled,
    atBothTeamsUnpauseRequired,
    atMaxPausesPerTeam,
    atPauseDuration,
    atSideSelectionEnabled,
    atSideSelectionTime,
    atGgEnabled,
    atGgThreshold,
    atGgMinScoreDiff,
    atFfwEnabled,
    atFfwTime,
    atDemoRecordingEnabled,
    initialWebhookUrl,
    initialAtChatPrefix,
    initialAtAdminChatPrefix,
    initialAtKnifeEnabledDefault,
    initialAtDebugChatEnabled,
    initialRatingsEnabled,
    initialAllowSelfRegister,
    initialAtAutostartMode,
    initialAtMinimumReadyRequired,
    initialAtAllowForceReady,
    initialAtKickWhenNoMatchLoaded,
    initialAtWhitelistEnabledDefault,
    initialAtPauseAfterRestore,
    initialAtStopCommandAvailable,
    initialAtStopCommandNoDamage,
    initialAtUsePauseCommandForTacticalPause,
    initialAtHostnameFormat,
    initialAtDemoPath,
    initialAtDemoNameFormat,
    initialAtSeriesEndKickDelayNoDemo,
    initialAtSeriesEndKickDelayDemoNoUpload,
    initialAtSeriesEndKickDelayDemoUpload,
    initialAtAutoreadyEnabled,
    initialAtBothTeamsUnpauseRequired,
    initialAtMaxPausesPerTeam,
    initialAtPauseDuration,
    initialAtSideSelectionEnabled,
    initialAtSideSelectionTime,
    initialAtGgEnabled,
    initialAtGgThreshold,
    initialAtGgMinScoreDiff,
    initialAtFfwEnabled,
    initialAtFfwTime,
    initialAtDemoRecordingEnabled,
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
                <Tab label={t('settingsPage.tabs.advanced')} {...a11yProps(3)} />
                {isDev && <Tab label={t('settingsPage.tabs.developer')} {...a11yProps(4)} />}
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

                <Divider />

                <IgdbCredentialsCard />

                <Divider />

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
                    {t('settingsPage.players.registration.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.players.registration.description')}
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
                    label={t('settingsPage.players.registration.toggleLabel')}
                  />
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('settingsPage.players.registration.recommendation')}
                  </Typography>
                </Box>

                <Divider />

              </Stack>
            </TabPanel>

            {/* Match behavior and rating rules */}
            <TabPanel value={tabIndex} index={2}>
              <Stack spacing={3}>
                <Accordion defaultExpanded sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.ratings.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settingsPage.matchRating.ratings.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
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
                  </AccordionDetails>
                </Accordion>

                <Accordion sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.chatDefaults.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settingsPage.matchRating.chatDefaults.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={2}>
                      <TextField
                        label={t('settingsPage.matchRating.chatDefaults.chatPrefixLabel')}
                        value={atChatPrefix}
                        onChange={(event) => setAtChatPrefix(event.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        helperText={t('settingsPage.matchRating.chatDefaults.chatPrefixHelper')}
                        fullWidth
                      />
                      <TextField
                        label={t('settingsPage.matchRating.chatDefaults.adminChatPrefixLabel')}
                        value={atAdminChatPrefix}
                        onChange={(event) => setAtAdminChatPrefix(event.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        helperText={t('settingsPage.matchRating.chatDefaults.adminChatPrefixHelper')}
                        fullWidth
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={atKnifeEnabledDefault}
                            onChange={(event) => setAtKnifeEnabledDefault(event.target.checked)}
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settingsPage.matchRating.chatDefaults.knifeToggleLabel')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settingsPage.matchRating.chatDefaults.knifeNote')}
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Accordion sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.atEnhanced.demo.title')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={atDemoRecordingEnabled !== 0}
                            onChange={(e) =>
                              setAtDemoRecordingEnabled(e.target.checked ? 1 : 0)
                            }
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settingsPage.matchRating.atEnhanced.demo.enabled')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settingsPage.matchRating.atEnhanced.demo.description')}
                      </Typography>

                      <Divider />

                      <Typography variant="subtitle1" fontWeight={600}>
                        {t('settingsPage.matchRating.atCore.demos.title')}
                      </Typography>
                      <TextField
                        label={t('settingsPage.matchRating.atCore.hostname.formatLabel')}
                        value={atHostnameFormat}
                        onChange={(e) => setAtHostnameFormat(e.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        helperText={t('settingsPage.matchRating.atCore.hostname.formatHelper')}
                        fullWidth
                        size="small"
                        inputProps={{ 'data-testid': 'at-hostname-format-input' }}
                      />
                      <TextField
                        label={t('settingsPage.matchRating.atCore.demos.demoPathLabel')}
                        value={atDemoPath}
                        onChange={(e) => setAtDemoPath(e.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        helperText={t('settingsPage.matchRating.atCore.demos.demoPathHelper')}
                        fullWidth
                        size="small"
                      />
                      <TextField
                        label={t('settingsPage.matchRating.atCore.demos.demoNameFormatLabel')}
                        value={atDemoNameFormat}
                        onChange={(e) => setAtDemoNameFormat(e.target.value)}
                        onBlur={handleFieldBlur}
                        onKeyDown={handleFieldKeyDown}
                        helperText={t('settingsPage.matchRating.atCore.demos.demoNameFormatHelper')}
                        fullWidth
                        size="small"
                      />

                      <Divider />

                      <Typography variant="subtitle1" fontWeight={600}>
                        {t('settingsPage.matchRating.atCore.seriesEnd.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <TextField
                          label={t('settingsPage.matchRating.atCore.seriesEnd.kickDelayNoDemoLabel')}
                          type="number"
                          value={atSeriesEndKickDelayNoDemo}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            setAtSeriesEndKickDelayNoDemo(v);
                          }}
                          onBlur={handleFieldBlur}
                          onKeyDown={handleFieldKeyDown}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label={t(
                            'settingsPage.matchRating.atCore.seriesEnd.kickDelayDemoNoUploadLabel'
                          )}
                          type="number"
                          value={atSeriesEndKickDelayDemoNoUpload}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            setAtSeriesEndKickDelayDemoNoUpload(v);
                          }}
                          onBlur={handleFieldBlur}
                          onKeyDown={handleFieldKeyDown}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label={t(
                            'settingsPage.matchRating.atCore.seriesEnd.kickDelayDemoUploadLabel'
                          )}
                          type="number"
                          value={atSeriesEndKickDelayDemoUpload}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            setAtSeriesEndKickDelayDemoUpload(v);
                          }}
                          onBlur={handleFieldBlur}
                          onKeyDown={handleFieldKeyDown}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t('settingsPage.matchRating.atCore.seriesEnd.kickDelayHelper')}
                        </Typography>
                      </Stack>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            </TabPanel>

            {/* Advanced settings */}
            <TabPanel value={tabIndex} index={3}>
              <Stack spacing={3}>
                <Alert severity="warning">
                  {t('settingsPage.matchRating.atCore.expert.description')}
                </Alert>

                <Accordion defaultExpanded sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.atCore.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settingsPage.matchRating.atCore.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={3}>
                      {/* Ready / flow */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settingsPage.matchRating.atCore.ready.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <TextField
                            label={t('settingsPage.matchRating.atCore.ready.minimumReadyLabel')}
                            type="number"
                            value={atMinimumReadyRequired}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isFinite(v)) return;
                              setAtMinimumReadyRequired(v);
                            }}
                            onBlur={handleFieldBlur}
                            onKeyDown={handleFieldKeyDown}
                            helperText={t(
                              'settingsPage.matchRating.atCore.ready.minimumReadyHelper'
                            )}
                            inputProps={{ min: 0, max: 10 }}
                            size="small"
                            fullWidth
                          />
                          <FormControlLabel
                            control={
                              <Switch
                                checked={atAllowForceReady}
                                onChange={(e) => setAtAllowForceReady(e.target.checked)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settingsPage.matchRating.atCore.ready.allowForceReady')}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      <Box
                        sx={{
                          bgcolor: (theme) => `${theme.palette.warning.main}14`, // 8% amber wash
                          border: 1,
                          borderColor: 'warning.main',
                          borderRadius: 1,
                          p: 2,
                        }}
                      >
                        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                          {t('settingsPage.matchRating.atCore.expert.title')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                          {t('settingsPage.matchRating.atCore.expert.description')}
                        </Typography>

                        <Stack spacing={2}>
                          <TextField
                            select
                            label={t(
                              'settingsPage.matchRating.atCore.expert.autostartMode.label'
                            )}
                            value={atAutostartMode}
                            onChange={(e) =>
                              setAtAutostartMode(Number(e.target.value) as 0 | 1 | 2)
                            }
                            onBlur={handleFieldBlur}
                            helperText={t(
                              'settingsPage.matchRating.atCore.expert.autostartMode.helper'
                            )}
                            size="small"
                            fullWidth
                          >
                            <option value={0}>
                              {t('settingsPage.matchRating.atCore.expert.autostartMode.options.0')}
                            </option>
                            <option value={1}>
                              {t('settingsPage.matchRating.atCore.expert.autostartMode.options.1')}
                            </option>
                            <option value={2}>
                              {t('settingsPage.matchRating.atCore.expert.autostartMode.options.2')}
                            </option>
                          </TextField>

                          <Divider />

                          {/* Access / server lockdown */}
                          <Box>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                              {t('settingsPage.matchRating.atCore.access.title')}
                            </Typography>
                            <Stack spacing={1}>
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atKickWhenNoMatchLoaded}
                                    onChange={(e) => setAtKickWhenNoMatchLoaded(e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.access.kickWhenNoMatchLoaded'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atWhitelistEnabledDefault}
                                    onChange={(e) => setAtWhitelistEnabledDefault(e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.access.whitelistEnabledDefault'
                                )}
                              />
                            </Stack>
                          </Box>

                          <Divider />

                          {/* Admin tools */}
                          <Box>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                              {t('settingsPage.matchRating.atCore.adminTools.title')}
                            </Typography>
                            <Stack spacing={1}>
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atPauseAfterRestore}
                                    onChange={(e) => setAtPauseAfterRestore(e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.adminTools.pauseAfterRestore'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atStopCommandAvailable}
                                    onChange={(e) => setAtStopCommandAvailable(e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.adminTools.stopCommandAvailable'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atStopCommandNoDamage}
                                    onChange={(e) => setAtStopCommandNoDamage(e.target.checked)}
                                    color="primary"
                                    size="small"
                                    disabled={!atStopCommandAvailable}
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.adminTools.stopCommandNoDamage'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={atUsePauseCommandForTacticalPause}
                                    onChange={(e) =>
                                      setAtUsePauseCommandForTacticalPause(e.target.checked)
                                    }
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settingsPage.matchRating.atCore.adminTools.usePauseForTacticalPause'
                                )}
                              />
                            </Stack>
                          </Box>
                        </Stack>
                      </Box>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Accordion sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.atEnhanced.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settingsPage.matchRating.atEnhanced.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={3}>
                      {/* Auto-Ready System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settingsPage.matchRating.atEnhanced.autoready.title')}
                        </Typography>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={atAutoreadyEnabled === 1}
                              onChange={(e) => setAtAutoreadyEnabled(e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settingsPage.matchRating.atEnhanced.autoready.label')}
                        />
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('settingsPage.matchRating.atEnhanced.autoready.description')}
                        </Typography>
                      </Box>

                      <Divider />

                      {/* Pause System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settingsPage.matchRating.atEnhanced.pause.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={atBothTeamsUnpauseRequired === 1}
                                onChange={(e) =>
                                  setAtBothTeamsUnpauseRequired(e.target.checked ? 1 : 0)
                                }
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settingsPage.matchRating.atEnhanced.pause.bothTeamsUnpause')}
                          />
                          <TextField
                            label={t('settingsPage.matchRating.atEnhanced.pause.maxPausesLabel')}
                            type="number"
                            value={atMaxPausesPerTeam ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setAtMaxPausesPerTeam(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t('settingsPage.matchRating.atEnhanced.pause.maxPausesHelper')}
                            inputProps={{ min: 0, max: 999 }}
                            size="small"
                            fullWidth
                          />
                          <TextField
                            label={t(
                              'settingsPage.matchRating.atEnhanced.pause.pauseDurationLabel'
                            )}
                            type="number"
                            value={atPauseDuration ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setAtPauseDuration(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t(
                              'settingsPage.matchRating.atEnhanced.pause.pauseDurationHelper'
                            )}
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
                          {t('settingsPage.matchRating.atEnhanced.sideSelection.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={atSideSelectionEnabled === 1}
                                onChange={(e) =>
                                  setAtSideSelectionEnabled(e.target.checked ? 1 : 0)
                                }
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settingsPage.matchRating.atEnhanced.sideSelection.enabled')}
                          />
                          <TextField
                            label={t('settingsPage.matchRating.atEnhanced.sideSelection.timeLabel')}
                            type="number"
                            value={atSideSelectionTime ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setAtSideSelectionTime(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t('settingsPage.matchRating.atEnhanced.sideSelection.timeHelper')}
                            inputProps={{ min: 1, max: 999 }}
                            size="small"
                            fullWidth
                            disabled={atSideSelectionEnabled !== 1}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      {/* .gg Command */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settingsPage.matchRating.atEnhanced.gg.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={atGgEnabled === 1}
                                onChange={(e) => setAtGgEnabled(e.target.checked ? 1 : 0)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settingsPage.matchRating.atEnhanced.gg.enabled')}
                          />
                          <TextField
                            label={t('settingsPage.matchRating.atEnhanced.gg.thresholdLabel')}
                            type="number"
                            value={atGgThreshold ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseFloat(e.target.value);
                              setAtGgThreshold(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t('settingsPage.matchRating.atEnhanced.gg.thresholdHelper')}
                            inputProps={{ min: 0, max: 1, step: 0.1 }}
                            size="small"
                            fullWidth
                            disabled={atGgEnabled !== 1}
                          />
                          <TextField
                            label={t('settingsPage.matchRating.atEnhanced.gg.minScoreDiffLabel')}
                            type="number"
                            value={atGgMinScoreDiff ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setAtGgMinScoreDiff(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t('settingsPage.matchRating.atEnhanced.gg.minScoreDiffHelper')}
                            inputProps={{ min: 0, max: 16 }}
                            size="small"
                            fullWidth
                            disabled={atGgEnabled !== 1}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      {/* FFW System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settingsPage.matchRating.atEnhanced.ffw.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={atFfwEnabled === 1}
                                onChange={(e) => setAtFfwEnabled(e.target.checked ? 1 : 0)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settingsPage.matchRating.atEnhanced.ffw.enabled')}
                          />
                          <TextField
                            label={t('settingsPage.matchRating.atEnhanced.ffw.timeLabel')}
                            type="number"
                            value={atFfwTime ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setAtFfwTime(isNaN(val as number) ? null : val);
                            }}
                            onBlur={handleFieldBlur}
                            helperText={t('settingsPage.matchRating.atEnhanced.ffw.timeHelper')}
                            inputProps={{ min: 1, max: 999 }}
                            size="small"
                            fullWidth
                            disabled={atFfwEnabled !== 1}
                          />
                        </Stack>
                      </Box>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            </TabPanel>

            {isDev && (
              <TabPanel value={tabIndex} index={4}>
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
                          checked={atDebugChatEnabled}
                          onChange={(e) => {
                            const newValue = e.target.checked;
                            setAtDebugChatEnabled(newValue);
                            // Pass the new value as an override to handleSave since state updates are async
                            void handleSave(true, { atDebugChatEnabled: newValue });
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
                          max={10}
                          step={0.1}
                          marks={[1, 2, 4, 6, 8, 10].map((v) => ({ value: v, label: `${v}×` }))}
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
                      atChatPrefix: null;
                      atAdminChatPrefix: null;
                      atKnifeEnabledDefault: null;
                      atDebugChatEnabled?: boolean;
                      simulateMatches?: boolean;
                      // Auto Tournament CS2 core defaults
                      atMinimumReadyRequired?: null;
                      atAllowForceReady?: null;
                      atKickWhenNoMatchLoaded?: null;
                      atWhitelistEnabledDefault?: null;
                      atPauseAfterRestore?: null;
                      atStopCommandAvailable?: null;
                      atStopCommandNoDamage?: null;
                      atUsePauseCommandForTacticalPause?: null;
                      atHostnameFormat?: null;
                      atDemoPath?: null;
                      atDemoNameFormat?: null;
                      atSeriesEndKickDelayNoDemo?: null;
                      atSeriesEndKickDelayDemoNoUpload?: null;
                      atSeriesEndKickDelayDemoUpload?: null;
                      // Auto Tournament CS2 v1.3.0 settings - reset to null (use tournament defaults)
                      atAutoreadyEnabled: null;
                      atBothTeamsUnpauseRequired: null;
                      atMaxPausesPerTeam: null;
                      atPauseDuration: null;
                      atSideSelectionEnabled: null;
                      atSideSelectionTime: null;
                      atGgEnabled: null;
                      atGgThreshold: null;
                      atGgMinScoreDiff: null;
                      atFfwEnabled: null;
                      atFfwTime: null;
                      atDemoRecordingEnabled: null;
                    } = {
                      webhookUrl: null,
                      atChatPrefix: null,
                      atAdminChatPrefix: null,
                      atKnifeEnabledDefault: null,
                      atDebugChatEnabled: false,
                      atMinimumReadyRequired: null,
                      atAllowForceReady: null,
                      atKickWhenNoMatchLoaded: null,
                      atWhitelistEnabledDefault: null,
                      atPauseAfterRestore: null,
                      atStopCommandAvailable: null,
                      atStopCommandNoDamage: null,
                      atUsePauseCommandForTacticalPause: null,
                      atHostnameFormat: null,
                      atDemoPath: null,
                      atDemoNameFormat: null,
                      atSeriesEndKickDelayNoDemo: null,
                      atSeriesEndKickDelayDemoNoUpload: null,
                      atSeriesEndKickDelayDemoUpload: null,
                      // Auto Tournament CS2 - reset to null to use tournament defaults
                      atAutoreadyEnabled: null,
                      atBothTeamsUnpauseRequired: null,
                      atMaxPausesPerTeam: null,
                      atPauseDuration: null,
                      atSideSelectionEnabled: null,
                      atSideSelectionTime: null,
                      atGgEnabled: null,
                      atGgThreshold: null,
                      atGgMinScoreDiff: null,
                      atFfwEnabled: null,
                      atFfwTime: null,
                      atDemoRecordingEnabled: null,
                      ...(isDev && { simulateMatches: false }),
                    };

                    const response: SettingsResponse = await api.put(
                      '/api/settings',
                      resetPayload
                    );

                    const newWebhook = response.settings.webhookUrl ?? '';
                    const newSimulate = response.settings.simulateMatches ?? false;
                    const newChatPrefix =
                      response.settings.atChatPrefix ?? DEFAULT_AT_CHAT_PREFIX;
                    const newAdminChatPrefix =
                      response.settings.atAdminChatPrefix ??
                      DEFAULT_AT_ADMIN_CHAT_PREFIX;
                    const newKnifeEnabled =
                      response.settings.atKnifeEnabledDefault !== undefined
                        ? response.settings.atKnifeEnabledDefault
                        : true;
                    const newDebugChatEnabled =
                      response.settings.atDebugChatEnabled !== undefined
                        ? response.settings.atDebugChatEnabled
                        : false;
                    const newMinimumReadyRequired = response.settings.atMinimumReadyRequired ?? 0;
                    const newAllowForceReady = response.settings.atAllowForceReady ?? true;
                    const newKickWhenNoMatchLoaded = response.settings.atKickWhenNoMatchLoaded ?? false;
                    const newWhitelistEnabledDefault = response.settings.atWhitelistEnabledDefault ?? false;
                    const newPauseAfterRestore = response.settings.atPauseAfterRestore ?? true;
                    const newStopCommandAvailable = response.settings.atStopCommandAvailable ?? false;
                    const newStopCommandNoDamage = response.settings.atStopCommandNoDamage ?? false;
                    const newUsePauseCommandForTacticalPause =
                      response.settings.atUsePauseCommandForTacticalPause ?? false;
                    const newHostnameFormat =
                      response.settings.atHostnameFormat ?? '{TEAM1} vs {TEAM2}';
                    const newDemoPath = response.settings.atDemoPath ?? 'AutoTournamentCS2/';
                    const newDemoNameFormat =
                      response.settings.atDemoNameFormat ??
                      '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}';
                    const newSeriesEndKickDelayNoDemo =
                      response.settings.atSeriesEndKickDelayNoDemo ?? 5;
                    const newSeriesEndKickDelayDemoNoUpload =
                      response.settings.atSeriesEndKickDelayDemoNoUpload ?? 10;
                    const newSeriesEndKickDelayDemoUpload =
                      response.settings.atSeriesEndKickDelayDemoUpload ?? 60;
                    // Auto Tournament CS2 settings
                    const newAtAutoready = response.settings.atAutoreadyEnabled ?? null;
                    const newAtBothTeamsUnpause = response.settings.atBothTeamsUnpauseRequired ?? null;
                    const newAtMaxPauses = response.settings.atMaxPausesPerTeam ?? null;
                    const newAtPauseDur = response.settings.atPauseDuration ?? null;
                    const newAtSideSelEnabled = response.settings.atSideSelectionEnabled ?? null;
                    const newAtSideSelTime = response.settings.atSideSelectionTime ?? null;
                    const newAtGg = response.settings.atGgEnabled ?? null;
                    const newAtGgThresh = response.settings.atGgThreshold ?? null;
                    const newAtGgMinDiff = response.settings.atGgMinScoreDiff ?? null;
                    const newAtFfw = response.settings.atFfwEnabled ?? null;
                    const newAtFfwT = response.settings.atFfwTime ?? null;
                    const newAtDemo = response.settings.atDemoRecordingEnabled ?? null;

                    setWebhookUrl(newWebhook);
                    setInitialWebhookUrl(newWebhook);
                    setSimulateMatches(newSimulate);
                    setInitialSimulateMatches(newSimulate);
                    setAtChatPrefix(newChatPrefix);
                    setInitialAtChatPrefix(newChatPrefix);
                    setAtAdminChatPrefix(newAdminChatPrefix);
                    setInitialAtAdminChatPrefix(newAdminChatPrefix);
                    setAtKnifeEnabledDefault(newKnifeEnabled);
                    setInitialAtKnifeEnabledDefault(newKnifeEnabled);
                    setAtDebugChatEnabled(newDebugChatEnabled);
                    setInitialAtDebugChatEnabled(newDebugChatEnabled);
                    setAtMinimumReadyRequired(newMinimumReadyRequired);
                    setInitialAtMinimumReadyRequired(newMinimumReadyRequired);
                    setAtAllowForceReady(newAllowForceReady);
                    setInitialAtAllowForceReady(newAllowForceReady);
                    setAtKickWhenNoMatchLoaded(newKickWhenNoMatchLoaded);
                    setInitialAtKickWhenNoMatchLoaded(newKickWhenNoMatchLoaded);
                    setAtWhitelistEnabledDefault(newWhitelistEnabledDefault);
                    setInitialAtWhitelistEnabledDefault(newWhitelistEnabledDefault);
                    setAtPauseAfterRestore(newPauseAfterRestore);
                    setInitialAtPauseAfterRestore(newPauseAfterRestore);
                    setAtStopCommandAvailable(newStopCommandAvailable);
                    setInitialAtStopCommandAvailable(newStopCommandAvailable);
                    setAtStopCommandNoDamage(newStopCommandNoDamage);
                    setInitialAtStopCommandNoDamage(newStopCommandNoDamage);
                    setAtUsePauseCommandForTacticalPause(newUsePauseCommandForTacticalPause);
                    setInitialAtUsePauseCommandForTacticalPause(newUsePauseCommandForTacticalPause);
                    setAtHostnameFormat(newHostnameFormat);
                    setInitialAtHostnameFormat(newHostnameFormat);
                    setAtDemoPath(newDemoPath);
                    setInitialAtDemoPath(newDemoPath);
                    setAtDemoNameFormat(newDemoNameFormat);
                    setInitialAtDemoNameFormat(newDemoNameFormat);
                    setAtSeriesEndKickDelayNoDemo(newSeriesEndKickDelayNoDemo);
                    setInitialAtSeriesEndKickDelayNoDemo(newSeriesEndKickDelayNoDemo);
                    setAtSeriesEndKickDelayDemoNoUpload(newSeriesEndKickDelayDemoNoUpload);
                    setInitialAtSeriesEndKickDelayDemoNoUpload(newSeriesEndKickDelayDemoNoUpload);
                    setAtSeriesEndKickDelayDemoUpload(newSeriesEndKickDelayDemoUpload);
                    setInitialAtSeriesEndKickDelayDemoUpload(newSeriesEndKickDelayDemoUpload);
                    // Auto Tournament CS2
                    setAtAutoreadyEnabled(newAtAutoready);
                    setInitialAtAutoreadyEnabled(newAtAutoready);
                    setAtBothTeamsUnpauseRequired(newAtBothTeamsUnpause);
                    setInitialAtBothTeamsUnpauseRequired(newAtBothTeamsUnpause);
                    setAtMaxPausesPerTeam(newAtMaxPauses);
                    setInitialAtMaxPausesPerTeam(newAtMaxPauses);
                    setAtPauseDuration(newAtPauseDur);
                    setInitialAtPauseDuration(newAtPauseDur);
                    setAtSideSelectionEnabled(newAtSideSelEnabled);
                    setInitialAtSideSelectionEnabled(newAtSideSelEnabled);
                    setAtSideSelectionTime(newAtSideSelTime);
                    setInitialAtSideSelectionTime(newAtSideSelTime);
                    setAtGgEnabled(newAtGg);
                    setInitialAtGgEnabled(newAtGg);
                    setAtGgThreshold(newAtGgThresh);
                    setInitialAtGgThreshold(newAtGgThresh);
                    setAtGgMinScoreDiff(newAtGgMinDiff);
                    setInitialAtGgMinScoreDiff(newAtGgMinDiff);
                    setAtFfwEnabled(newAtFfw);
                    setInitialAtFfwEnabled(newAtFfw);
                    setAtFfwTime(newAtFfwT);
                    setInitialAtFfwTime(newAtFfwT);
                    setAtDemoRecordingEnabled(newAtDemo);
                    setInitialAtDemoRecordingEnabled(newAtDemo);

                    window.dispatchEvent(
                      new CustomEvent<SettingsResponse['settings']>('at:settingsUpdated', {
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
