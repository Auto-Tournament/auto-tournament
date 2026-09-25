/**
 * CS2's server defaults on its Settings tab: what the platform sends every
 * Auto Tournament CS2 server with a match (chat prefixes, knife round, demos,
 * ready-up, pauses, side selection, GG and forfeit), and in development the
 * plugin's debug chat and match simulation.
 *
 * These were core Settings' "Matches & Ratings", "Advanced" and "Developer"
 * tabs until the module split. They are the `at_*` and simulation keys CS2
 * declares on the API side (`api/src/integrations/cs2/settings.ts`), so
 * nothing about storing them changed: this component sends the fields that
 * changed through `PUT /api/settings`, whose fields are all optional.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import {
  api,
  radii,
  useIsDevelopment,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';

type Flag = 0 | 1 | null;

export interface Cs2DefaultsValues {
  atChatPrefix: string;
  atAdminChatPrefix: string;
  atKnifeEnabledDefault: boolean;
  atDebugChatEnabled: boolean;
  atAutostartMode: 0 | 1 | 2;
  atMinimumReadyRequired: number;
  atAllowForceReady: boolean;
  atKickWhenNoMatchLoaded: boolean;
  atWhitelistEnabledDefault: boolean;
  atPauseAfterRestore: boolean;
  atStopCommandAvailable: boolean;
  atStopCommandNoDamage: boolean;
  atUsePauseCommandForTacticalPause: boolean;
  atHostnameFormat: string;
  atDemoPath: string;
  atDemoNameFormat: string;
  atSeriesEndKickDelayNoDemo: number;
  atSeriesEndKickDelayDemoNoUpload: number;
  atSeriesEndKickDelayDemoUpload: number;
  atAutoreadyEnabled: Flag;
  atBothTeamsUnpauseRequired: Flag;
  atMaxPausesPerTeam: number | null;
  atPauseDuration: number | null;
  atSideSelectionEnabled: Flag;
  atSideSelectionTime: number | null;
  atGgEnabled: Flag;
  atGgThreshold: number | null;
  atGgMinScoreDiff: number | null;
  atFfwEnabled: Flag;
  atFfwTime: number | null;
  atDemoRecordingEnabled: Flag;
  simulateMatches: boolean;
  simulationTimescale: number;
}

type Key = keyof Cs2DefaultsValues;

/** What the page shows for a field the API has no value for (the plugin's own default). */
const DEFAULTS: Cs2DefaultsValues = {
  atChatPrefix: '[{Green}MAT{Default}]',
  atAdminChatPrefix: '[{Red}ADMIN{Default}]',
  atKnifeEnabledDefault: true,
  atDebugChatEnabled: false,
  atAutostartMode: 1,
  atMinimumReadyRequired: 0,
  atAllowForceReady: true,
  atKickWhenNoMatchLoaded: false,
  atWhitelistEnabledDefault: false,
  atPauseAfterRestore: true,
  atStopCommandAvailable: false,
  atStopCommandNoDamage: false,
  atUsePauseCommandForTacticalPause: false,
  atHostnameFormat: '{TEAM1} vs {TEAM2}',
  atDemoPath: 'AutoTournamentCS2/',
  atDemoNameFormat: '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}',
  atSeriesEndKickDelayNoDemo: 5,
  atSeriesEndKickDelayDemoNoUpload: 10,
  atSeriesEndKickDelayDemoUpload: 60,
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
  simulateMatches: false,
  simulationTimescale: 1,
};

const KEYS = Object.keys(DEFAULTS) as Key[];

/** Only a development build shows (and so can change) these. */
const DEV_KEYS: ReadonlySet<Key> = new Set<Key>([
  'atDebugChatEnabled',
  'simulateMatches',
  'simulationTimescale',
]);

/** The fields as `GET`/`PUT /api/settings` answer them, with the plugin defaults for the missing ones. */
export function cs2DefaultsFrom(settings: Record<string, unknown> | undefined): Cs2DefaultsValues {
  const values = { ...DEFAULTS } as Record<Key, unknown>;
  for (const key of KEYS) {
    const value = settings?.[key];
    if (value !== undefined && value !== null) values[key] = value;
  }
  return values as unknown as Cs2DefaultsValues;
}

/** A field as `PUT /api/settings` takes it: the chat prefixes clear to null when empty. */
function toRequest(key: Key, value: Cs2DefaultsValues[Key]): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (key === 'atChatPrefix' || key === 'atAdminChatPrefix') return trimmed === '' ? null : trimmed;
  return trimmed;
}

/** Everything back to "not set", so servers use the plugin's (or the tournament's) defaults. */
function resetRequest(isDev: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of KEYS) {
    if (DEV_KEYS.has(key)) continue;
    body[key] = null;
  }
  body.atDebugChatEnabled = false;
  if (isDev) body.simulateMatches = false;
  return body;
}

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

interface SettingsResponse {
  success: boolean;
  settings?: Record<string, unknown>;
}

export const Cs2ServerDefaults: React.FC<{ initial: Record<string, unknown> | undefined }> = ({
  initial,
}) => {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError, showSnackbar } = useSnackbar();
  const isDev = useIsDevelopment();
  const [vals, setVals] = useState<Cs2DefaultsValues>(() => cs2DefaultsFrom(initial));
  const [saved, setSaved] = useState<Cs2DefaultsValues>(() => cs2DefaultsFrom(initial));
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(<K extends Key>(key: K, value: Cs2DefaultsValues[K]) => {
    setVals((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** After a save or reset: what the API stored, and the event the shell's warnings listen for. */
  const applyResponse = useCallback((settings: Record<string, unknown> | undefined, keys: Key[]) => {
    const stored = cs2DefaultsFrom(settings);
    setSaved(stored);
    // Keep anything typed while the request was out; take the stored value for what was sent.
    setVals((prev) => {
      const next = { ...prev } as Record<Key, unknown>;
      for (const key of keys) next[key] = stored[key];
      return next as unknown as Cs2DefaultsValues;
    });
    window.dispatchEvent(new CustomEvent('at:settingsUpdated', { detail: settings }));
    return stored;
  }, []);

  const save = useCallback(
    async (overrides: Partial<Cs2DefaultsValues> = {}) => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      const current = { ...vals, ...overrides };
      const changed = KEYS.filter(
        (key) => current[key] !== saved[key] && (isDev || !DEV_KEYS.has(key))
      );
      if (changed.length === 0) return;

      const body: Record<string, unknown> = {};
      for (const key of changed) body[key] = toRequest(key, current[key]);

      try {
        const response = await api.put<SettingsResponse>('/api/settings', body);
        const stored = applyResponse(response.settings, changed);
        showSuccess(t('settings.saved'));

        if (changed.includes('simulateMatches')) {
          showSnackbar(
            stored.simulateMatches
              ? t('settings.success.simulationEnabledWithSpeed', {
                  speed: stored.simulationTimescale.toFixed(1),
                })
              : t('settings.success.simulationDisabled'),
            'info'
          );
        } else if (changed.includes('simulationTimescale') && stored.simulateMatches) {
          showSnackbar(
            t('settings.success.timescaleUpdated', {
              value: stored.simulationTimescale.toFixed(1),
            }),
            'info'
          );
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : t('settings.saveFailed'));
      }
    },
    [vals, saved, isDev, applyResponse, showSuccess, showSnackbar, showError, t]
  );

  // Saved a second after the last change, or at once on blur / Enter.
  useEffect(() => {
    const dirty = KEYS.some((key) => vals[key] !== saved[key] && (isDev || !DEV_KEYS.has(key)));
    if (!dirty) return;
    saveTimeout.current = setTimeout(() => void save(), 1000);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [vals, saved, isDev, save]);

  const flush = () => void save();
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  };

  const handleReset = async () => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    setBusy(true);
    try {
      const response = await api.put<SettingsResponse>('/api/settings', resetRequest(isDev));
      applyResponse(response.settings, KEYS);
      showSuccess(t('settings.reset.success'));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('settings.reset.error'));
    } finally {
      setBusy(false);
      setResetOpen(false);
    }
  };

  return (
    <Stack spacing={3} data-testid="cs2-server-defaults">
      <Typography variant="h6" fontWeight={600}>
        {t('settings.defaultsTitle')}
      </Typography>

                <Accordion sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<CaretDownIcon size={24} />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settings.chatDefaults.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settings.chatDefaults.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={2}>
                      <TextField
                        label={t('settings.chatDefaults.chatPrefixLabel')}
                        value={vals.atChatPrefix}
                        onChange={(event) => update('atChatPrefix', event.target.value)}
                        onBlur={flush}
                        onKeyDown={onEnter}
                        helperText={t('settings.chatDefaults.chatPrefixHelper')}
                        fullWidth
                      />
                      <TextField
                        label={t('settings.chatDefaults.adminChatPrefixLabel')}
                        value={vals.atAdminChatPrefix}
                        onChange={(event) => update('atAdminChatPrefix', event.target.value)}
                        onBlur={flush}
                        onKeyDown={onEnter}
                        helperText={t('settings.chatDefaults.adminChatPrefixHelper')}
                        fullWidth
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={vals.atKnifeEnabledDefault}
                            onChange={(event) => update('atKnifeEnabledDefault', event.target.checked)}
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settings.chatDefaults.knifeToggleLabel')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settings.chatDefaults.knifeNote')}
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Accordion sx={ACCORDION_SX}>
                  <AccordionSummary
                    expandIcon={<CaretDownIcon size={24} />}
                    sx={ACCORDION_SUMMARY_SX}
                    data-testid="cs2-settings-demos-summary"
                  >
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settings.atEnhanced.demo.title')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={vals.atDemoRecordingEnabled !== 0}
                            onChange={(e) =>
                              update('atDemoRecordingEnabled', e.target.checked ? 1 : 0)
                            }
                            color="primary"
                            size="small"
                          />
                        }
                        label={t('settings.atEnhanced.demo.enabled')}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('settings.atEnhanced.demo.description')}
                      </Typography>

                      <Divider />

                      <Typography variant="subtitle1" fontWeight={600}>
                        {t('settings.atCore.demos.title')}
                      </Typography>
                      <TextField
                        label={t('settings.atCore.hostname.formatLabel')}
                        value={vals.atHostnameFormat}
                        onChange={(e) => update('atHostnameFormat', e.target.value)}
                        onBlur={flush}
                        onKeyDown={onEnter}
                        helperText={t('settings.atCore.hostname.formatHelper')}
                        fullWidth
                        size="small"
                        inputProps={{ 'data-testid': 'at-hostname-format-input' }}
                      />
                      <TextField
                        label={t('settings.atCore.demos.demoPathLabel')}
                        value={vals.atDemoPath}
                        onChange={(e) => update('atDemoPath', e.target.value)}
                        onBlur={flush}
                        onKeyDown={onEnter}
                        helperText={t('settings.atCore.demos.demoPathHelper')}
                        fullWidth
                        size="small"
                      />
                      <TextField
                        label={t('settings.atCore.demos.demoNameFormatLabel')}
                        value={vals.atDemoNameFormat}
                        onChange={(e) => update('atDemoNameFormat', e.target.value)}
                        onBlur={flush}
                        onKeyDown={onEnter}
                        helperText={t('settings.atCore.demos.demoNameFormatHelper')}
                        fullWidth
                        size="small"
                      />

                      <Divider />

                      <Typography variant="subtitle1" fontWeight={600}>
                        {t('settings.atCore.seriesEnd.title')}
                      </Typography>
                      <Stack spacing={2}>
                        <TextField
                          label={t('settings.atCore.seriesEnd.kickDelayNoDemoLabel')}
                          type="number"
                          value={vals.atSeriesEndKickDelayNoDemo}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            update('atSeriesEndKickDelayNoDemo', v);
                          }}
                          onBlur={flush}
                          onKeyDown={onEnter}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label={t(
                            'settings.atCore.seriesEnd.kickDelayDemoNoUploadLabel'
                          )}
                          type="number"
                          value={vals.atSeriesEndKickDelayDemoNoUpload}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            update('atSeriesEndKickDelayDemoNoUpload', v);
                          }}
                          onBlur={flush}
                          onKeyDown={onEnter}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label={t(
                            'settings.atCore.seriesEnd.kickDelayDemoUploadLabel'
                          )}
                          type="number"
                          value={vals.atSeriesEndKickDelayDemoUpload}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isFinite(v)) return;
                            update('atSeriesEndKickDelayDemoUpload', v);
                          }}
                          onBlur={flush}
                          onKeyDown={onEnter}
                          inputProps={{ min: 0, max: 600 }}
                          size="small"
                          fullWidth
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t('settings.atCore.seriesEnd.kickDelayHelper')}
                        </Typography>
                      </Stack>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Alert severity="warning">
                  {t('settings.atCore.expert.description')}
                </Alert>

                <Accordion defaultExpanded sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<CaretDownIcon size={24} />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settings.atCore.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settings.atCore.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={3}>
                      {/* Ready / flow */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settings.atCore.ready.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <TextField
                            label={t('settings.atCore.ready.minimumReadyLabel')}
                            type="number"
                            value={vals.atMinimumReadyRequired}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isFinite(v)) return;
                              update('atMinimumReadyRequired', v);
                            }}
                            onBlur={flush}
                            onKeyDown={onEnter}
                            helperText={t(
                              'settings.atCore.ready.minimumReadyHelper'
                            )}
                            inputProps={{ min: 0, max: 10 }}
                            size="small"
                            fullWidth
                          />
                          <FormControlLabel
                            control={
                              <Switch
                                checked={vals.atAllowForceReady}
                                onChange={(e) => update('atAllowForceReady', e.target.checked)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settings.atCore.ready.allowForceReady')}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      <Box
                        sx={{
                          bgcolor: (theme) => `${theme.palette.warning.main}14`, // 8% amber wash
                          border: 1,
                          borderColor: 'warning.main',
                          borderRadius: radii.sm,
                          p: 2,
                        }}
                      >
                        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                          {t('settings.atCore.expert.title')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                          {t('settings.atCore.expert.description')}
                        </Typography>

                        <Stack spacing={2}>
                          <TextField
                            select
                            label={t(
                              'settings.atCore.expert.autostartMode.label'
                            )}
                            value={vals.atAutostartMode}
                            onChange={(e) =>
                              update('atAutostartMode', Number(e.target.value) as 0 | 1 | 2)
                            }
                            onBlur={flush}
                            helperText={t(
                              'settings.atCore.expert.autostartMode.helper'
                            )}
                            size="small"
                            fullWidth
                          >
                            <option value={0}>
                              {t('settings.atCore.expert.autostartMode.options.0')}
                            </option>
                            <option value={1}>
                              {t('settings.atCore.expert.autostartMode.options.1')}
                            </option>
                            <option value={2}>
                              {t('settings.atCore.expert.autostartMode.options.2')}
                            </option>
                          </TextField>

                          <Divider />

                          {/* Access / server lockdown */}
                          <Box>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                              {t('settings.atCore.access.title')}
                            </Typography>
                            <Stack spacing={1}>
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atKickWhenNoMatchLoaded}
                                    onChange={(e) => update('atKickWhenNoMatchLoaded', e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settings.atCore.access.kickWhenNoMatchLoaded'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atWhitelistEnabledDefault}
                                    onChange={(e) => update('atWhitelistEnabledDefault', e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settings.atCore.access.whitelistEnabledDefault'
                                )}
                              />
                            </Stack>
                          </Box>

                          <Divider />

                          {/* Admin tools */}
                          <Box>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                              {t('settings.atCore.adminTools.title')}
                            </Typography>
                            <Stack spacing={1}>
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atPauseAfterRestore}
                                    onChange={(e) => update('atPauseAfterRestore', e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settings.atCore.adminTools.pauseAfterRestore'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atStopCommandAvailable}
                                    onChange={(e) => update('atStopCommandAvailable', e.target.checked)}
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settings.atCore.adminTools.stopCommandAvailable'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atStopCommandNoDamage}
                                    onChange={(e) => update('atStopCommandNoDamage', e.target.checked)}
                                    color="primary"
                                    size="small"
                                    disabled={!vals.atStopCommandAvailable}
                                  />
                                }
                                label={t(
                                  'settings.atCore.adminTools.stopCommandNoDamage'
                                )}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    checked={vals.atUsePauseCommandForTacticalPause}
                                    onChange={(e) =>
                                      update('atUsePauseCommandForTacticalPause', e.target.checked)
                                    }
                                    color="primary"
                                    size="small"
                                  />
                                }
                                label={t(
                                  'settings.atCore.adminTools.usePauseForTacticalPause'
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
                  <AccordionSummary expandIcon={<CaretDownIcon size={24} />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settings.atEnhanced.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settings.atEnhanced.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <Stack spacing={3}>
                      {/* Auto-Ready System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settings.atEnhanced.autoready.title')}
                        </Typography>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={vals.atAutoreadyEnabled === 1}
                              onChange={(e) => update('atAutoreadyEnabled', e.target.checked ? 1 : 0)}
                              color="primary"
                              size="small"
                            />
                          }
                          label={t('settings.atEnhanced.autoready.label')}
                        />
                        <Typography variant="caption" color="text.secondary" display="block">
                          {t('settings.atEnhanced.autoready.description')}
                        </Typography>
                      </Box>

                      <Divider />

                      {/* Pause System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settings.atEnhanced.pause.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={vals.atBothTeamsUnpauseRequired === 1}
                                onChange={(e) =>
                                  update('atBothTeamsUnpauseRequired', e.target.checked ? 1 : 0)
                                }
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settings.atEnhanced.pause.bothTeamsUnpause')}
                          />
                          <TextField
                            label={t('settings.atEnhanced.pause.maxPausesLabel')}
                            type="number"
                            value={vals.atMaxPausesPerTeam ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              update('atMaxPausesPerTeam', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t('settings.atEnhanced.pause.maxPausesHelper')}
                            inputProps={{ min: 0, max: 999 }}
                            size="small"
                            fullWidth
                          />
                          <TextField
                            label={t(
                              'settings.atEnhanced.pause.pauseDurationLabel'
                            )}
                            type="number"
                            value={vals.atPauseDuration ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              update('atPauseDuration', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t(
                              'settings.atEnhanced.pause.pauseDurationHelper'
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
                          {t('settings.atEnhanced.sideSelection.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={vals.atSideSelectionEnabled === 1}
                                onChange={(e) =>
                                  update('atSideSelectionEnabled', e.target.checked ? 1 : 0)
                                }
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settings.atEnhanced.sideSelection.enabled')}
                          />
                          <TextField
                            label={t('settings.atEnhanced.sideSelection.timeLabel')}
                            type="number"
                            value={vals.atSideSelectionTime ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              update('atSideSelectionTime', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t('settings.atEnhanced.sideSelection.timeHelper')}
                            inputProps={{ min: 1, max: 999 }}
                            size="small"
                            fullWidth
                            disabled={vals.atSideSelectionEnabled !== 1}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      {/* .gg Command */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settings.atEnhanced.gg.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={vals.atGgEnabled === 1}
                                onChange={(e) => update('atGgEnabled', e.target.checked ? 1 : 0)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settings.atEnhanced.gg.enabled')}
                          />
                          <TextField
                            label={t('settings.atEnhanced.gg.thresholdLabel')}
                            type="number"
                            value={vals.atGgThreshold ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseFloat(e.target.value);
                              update('atGgThreshold', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t('settings.atEnhanced.gg.thresholdHelper')}
                            inputProps={{ min: 0, max: 1, step: 0.1 }}
                            size="small"
                            fullWidth
                            disabled={vals.atGgEnabled !== 1}
                          />
                          <TextField
                            label={t('settings.atEnhanced.gg.minScoreDiffLabel')}
                            type="number"
                            value={vals.atGgMinScoreDiff ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              update('atGgMinScoreDiff', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t('settings.atEnhanced.gg.minScoreDiffHelper')}
                            inputProps={{ min: 0, max: 16 }}
                            size="small"
                            fullWidth
                            disabled={vals.atGgEnabled !== 1}
                          />
                        </Stack>
                      </Box>

                      <Divider />

                      {/* FFW System */}
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          {t('settings.atEnhanced.ffw.title')}
                        </Typography>
                        <Stack spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={vals.atFfwEnabled === 1}
                                onChange={(e) => update('atFfwEnabled', e.target.checked ? 1 : 0)}
                                color="primary"
                                size="small"
                              />
                            }
                            label={t('settings.atEnhanced.ffw.enabled')}
                          />
                          <TextField
                            label={t('settings.atEnhanced.ffw.timeLabel')}
                            type="number"
                            value={vals.atFfwTime ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              update('atFfwTime', isNaN(val as number) ? null : val);
                            }}
                            onBlur={flush}
                            helperText={t('settings.atEnhanced.ffw.timeHelper')}
                            inputProps={{ min: 1, max: 999 }}
                            size="small"
                            fullWidth
                            disabled={vals.atFfwEnabled !== 1}
                          />
                        </Stack>
                      </Box>
                    </Stack>
                  </AccordionDetails>
                </Accordion>

      {isDev && (
        <>
          <Divider />
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {t('settings.developer.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      {t('settings.developer.description')}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={vals.atDebugChatEnabled}
                          onChange={(e) => {
                            const newValue = e.target.checked;
                            update('atDebugChatEnabled', newValue);
                            void save({ atDebugChatEnabled: newValue });
                          }}
                          size="small"
                          color="primary"
                        />
                      }
                      label={t('settings.developer.debugChat.label')}
                    />
                    <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                      {t('settings.developer.debugChat.description')}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={vals.simulateMatches}
                          onChange={(event) => update('simulateMatches', event.target.checked)}
                          color="error"
                          size="small"
                          slotProps={{
                            input: {
                              'data-testid': 'settings-simulate-matches-toggle',
                            } as React.InputHTMLAttributes<HTMLInputElement>,
                          }}
                        />
                      }
                      label={
                        <Typography component="span" color="error.main" fontWeight={600}>
                          {t('settings.developer.simulateToggleLabel')}
                        </Typography>
                      }
                    />
                    <Typography variant="caption" color="error.main" display="block" mt={1} fontWeight={500}>
                      {t('settings.developer.simulateNote')}
                    </Typography>
                    <Box mt={3}>
                      <Typography variant="subtitle1" fontWeight={500} gutterBottom>
                        {t('settings.developer.timescaleTitle')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" mb={1}>
                        {t('settings.developer.timescaleDescription')}
                      </Typography>
                      <Box px={1}>
                        <Slider
                          value={vals.simulationTimescale}
                          onChange={(_e, value) => {
                            const v = Array.isArray(value) ? value[0] : value;
                            update('simulationTimescale', typeof v === 'number' ? v : 1);
                          }}
                          onChangeCommitted={(_e, value) => {
                            const v = Array.isArray(value) ? value[0] : value;
                            void save({ simulationTimescale: typeof v === 'number' ? v : 1 });
                          }}
                          min={0.1}
                          max={10}
                          step={0.1}
                          marks={[1, 2, 4, 6, 8, 10].map((v) => ({ value: v, label: `${v}×` }))}
                          valueLabelDisplay="on"
                          data-testid="settings-simulation-timescale-slider"
                        />
                        {vals.simulationTimescale > 2 && (
                          <Typography
                            variant="caption"
                            color="warning.main"
                            sx={{ mt: 1, display: 'block' }}
                          >
                            {t('settings.developer.timescaleWarning')}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
        </>
      )}

      <Box display="flex" justifyContent="flex-end">
        <Button
          data-testid="cs2-settings-reset-button"
          onClick={() => setResetOpen(true)}
          disabled={busy}
        >
          {t('settings.reset.button')}
        </Button>
      </Box>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        aria-labelledby="cs2-reset-settings-dialog-title"
      >
        <DialogTitle id="cs2-reset-settings-dialog-title">{t('settings.reset.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('settings.reset.description')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>{t('settings.reset.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleReset()}
            data-testid="cs2-settings-reset-confirm"
            disabled={busy}
            autoFocus
          >
            {t('settings.reset.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
