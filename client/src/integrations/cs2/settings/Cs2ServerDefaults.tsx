/**
 * CS2's server defaults on its Settings tab: what the platform sends every
 * Ready Up server with a match (demos, ready-up, pauses, side selection, GG
 * and forfeit, the end-of-series kick delay), and in development match
 * simulation. Settings only MatchZy Enhanced read (chat prefixes, hostname
 * and demo name formats, autostart mode, .stop) were removed (2026-10-15):
 * Ready Up never got them.
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
  Link,
  Slider,
  Stack,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import {
  api,
  links,
  radii,
  useIsDevelopment,
  useModuleTranslation,
  useSnackbar,
  SwitchRow,
  fmtNum,
} from '../../../module-sdk';
import type { Untrusted } from '../../types';

type Flag = 0 | 1 | null;

export interface Cs2DefaultsValues {
  highlightsWatermark: boolean;
  highlightsPerPlayer: number | null;
  highlightsResolution: number;
  highlightsFps: number;
  /** '' (every track), 'off', or the picked track ids (the API's highlights_music). */
  highlightsMusic: string;
  /** Keep each clip's clean twin (the API's highlights_keep_clean). */
  highlightsKeepClean: boolean;
  atMinimumReadyRequired: number;
  atAllowForceReady: boolean;
  atTeamReady: boolean;
  atPauseAfterRestore: boolean;
  atJoinPassword: boolean;
  atAutostartAfterMinutes: number;
  vetoTurnSeconds: number;
  vetoFirstTurnSeconds: number;
  matchBreakMinutes: number;
  /** Spectators in GOTV (api cs2 gotv.ts): 1 on, 0 off. */
  gotvSpectators: number;
  gotvDelay: number;
  gotvSeats: number;
  /** 0 everyone, 1 signed-in players, 2 admins and casters. */
  gotvAccess: number;
  /** 0 the GOTV delay, 1 live, 2 off. */
  gotvLiveStats: number;
  /** The connect panel recommends the LAN address to everyone: 1 on, 0 off. */
  connectPreferLan: number;
  atSeriesEndKickDelayNoDemo: number;
  atAutoreadyEnabled: Flag;
  atBothTeamsUnpauseRequired: Flag;
  atPauseOnDisconnect: Flag;
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
  highlightsWatermark: true,
  highlightsPerPlayer: 6,
  highlightsResolution: 720,
  highlightsFps: 240,
  highlightsMusic: '',
  highlightsKeepClean: true,
  atMinimumReadyRequired: 0,
  atAllowForceReady: true,
  atTeamReady: true,
  atPauseAfterRestore: true,
  atJoinPassword: false,
  atAutostartAfterMinutes: 0,
  vetoTurnSeconds: 45,
  vetoFirstTurnSeconds: 120,
  matchBreakMinutes: 5,
  gotvSpectators: 1,
  gotvDelay: 105,
  gotvSeats: 8,
  gotvAccess: 0,
  gotvLiveStats: 0,
  connectPreferLan: 0,
  atSeriesEndKickDelayNoDemo: 30,
  atAutoreadyEnabled: null,
  atBothTeamsUnpauseRequired: null,
  atPauseOnDisconnect: null,
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
const DEV_KEYS: ReadonlySet<Key> = new Set<Key>(['simulateMatches', 'simulationTimescale']);

/** The fields as `GET`/`PUT /api/settings` answer them, with the plugin defaults for the missing ones. */
export function cs2DefaultsFrom(
  settings: Record<string, Untrusted> | undefined
): Cs2DefaultsValues {
  const values = { ...DEFAULTS } as Record<Key, Untrusted>;
  for (const key of KEYS) {
    const value = settings?.[key];
    if (value !== undefined && value !== null) values[key] = value;
  }
  // eslint-disable-next-line no-restricted-syntax -- the API stores these keys with these types (its settings PUT checks them)
  return values as unknown as Cs2DefaultsValues;
}

/** A field as `PUT /api/settings` takes it. */
function toRequest(_key: Key, value: Cs2DefaultsValues[Key]): Untrusted {
  return typeof value === 'string' ? value.trim() : value;
}

/** Everything back to "not set", so servers use the plugin's (or the tournament's) defaults. */
function resetRequest(isDev: boolean): Record<string, Untrusted> {
  const body: Record<string, Untrusted> = {};
  for (const key of KEYS) {
    if (DEV_KEYS.has(key)) continue;
    body[key] = null;
  }
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
  settings?: Record<string, Untrusted>;
}

export const Cs2ServerDefaults: React.FC<{ initial: Record<string, Untrusted> | undefined }> = ({
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
  const applyResponse = useCallback(
    (settings: Record<string, Untrusted> | undefined, keys: Key[]) => {
      const stored = cs2DefaultsFrom(settings);
      setSaved(stored);
      // Keep anything typed while the request was out; take the stored value for what was sent.
      setVals((prev) => {
        return { ...prev, ...Object.fromEntries(keys.map((key) => [key, stored[key]])) };
      });
      window.dispatchEvent(new CustomEvent('at:settingsUpdated', { detail: settings }));
      return stored;
    },
    []
  );

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

      const body: Record<string, Untrusted> = {};
      for (const key of changed) body[key] = toRequest(key, current[key]);

      try {
        const response = await api.put<SettingsResponse>('/api/settings', body);
        const stored = applyResponse(response.settings, changed);
        showSuccess(t('settings.saved'));

        if (changed.includes('simulateMatches')) {
          showSnackbar(
            stored.simulateMatches
              ? t('settings.success.simulationEnabledWithSpeed', {
                  speed: fmtNum(stored.simulationTimescale, 1),
                })
              : t('settings.success.simulationDisabled'),
            'info'
          );
        } else if (changed.includes('simulationTimescale') && stored.simulateMatches) {
          showSnackbar(
            t('settings.success.timescaleUpdated', {
              value: fmtNum(stored.simulationTimescale, 1),
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
            <SwitchRow
              label={t('settings.atEnhanced.demo.enabled')}
              checked={vals.atDemoRecordingEnabled !== 0}
              onChange={(e) => update('atDemoRecordingEnabled', e.target.checked ? 1 : 0)}
              size="small"
              help={t('settings.atEnhanced.demo.description')}
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
                inputProps={{ min: 0, max: 600, 'data-testid': 'at-kick-delay-input' }}
                size="small"
                fullWidth
              />
              <Typography variant="caption" color="text.secondary">
                {t('settings.atCore.seriesEnd.kickDelayHelper')}
              </Typography>
              <TextField
                label={t('settings.atCore.autostart.label')}
                helperText={t('settings.atCore.autostart.helper')}
                type="number"
                value={vals.atAutostartAfterMinutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  update('atAutostartAfterMinutes', v);
                }}
                onBlur={flush}
                onKeyDown={onEnter}
                inputProps={{ min: 0, max: 120 }}
                size="small"
                fullWidth
                data-testid="setting-autostart-minutes"
              />
              <TextField
                label={t('settings.vetoTurn.label')}
                helperText={t('settings.vetoTurn.helper')}
                type="number"
                value={vals.vetoTurnSeconds}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  update('vetoTurnSeconds', v);
                }}
                onBlur={flush}
                onKeyDown={onEnter}
                inputProps={{ min: 0, max: 600 }}
                size="small"
                fullWidth
                data-testid="setting-veto-turn-seconds"
              />
              <TextField
                label={t('settings.vetoFirstTurn.label')}
                helperText={t('settings.vetoFirstTurn.helper')}
                type="number"
                value={vals.vetoFirstTurnSeconds}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  update('vetoFirstTurnSeconds', v);
                }}
                onBlur={flush}
                onKeyDown={onEnter}
                inputProps={{ min: 0, max: 900 }}
                size="small"
                fullWidth
                data-testid="setting-veto-first-turn-seconds"
              />
              <TextField
                label={t('settings.matchBreak.label')}
                helperText={t('settings.matchBreak.helper')}
                type="number"
                value={vals.matchBreakMinutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  update('matchBreakMinutes', v);
                }}
                onBlur={flush}
                onKeyDown={onEnter}
                inputProps={{ min: 0, max: 120 }}
                size="small"
                fullWidth
                data-testid="setting-match-break-minutes"
              />
            </Stack>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Spectators in GOTV: who can watch a match from its match room, and how far behind. */}
      <Accordion defaultExpanded sx={ACCORDION_SX} data-testid="settings-gotv">
        <AccordionSummary expandIcon={<CaretDownIcon size={24} />} sx={ACCORDION_SUMMARY_SX}>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {t('settings.gotv.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('settings.gotv.description')}
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <SwitchRow
              label={t('settings.gotv.enabled')}
              checked={vals.gotvSpectators === 1}
              onChange={(e) => {
                const v = e.target.checked ? 1 : 0;
                update('gotvSpectators', v);
                void save({ gotvSpectators: v });
              }}
              slotProps={{
                input: { 'data-testid': 'setting-gotv-enabled' } as Record<string, string>,
              }}
            />
            {vals.gotvSpectators === 1 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                {(
                  [
                    ['gotvDelay', [0, 30, 105, 120]],
                    ['gotvSeats', [8, 16, 32]],
                    ['gotvAccess', [0, 1, 2]],
                    ['gotvLiveStats', [0, 1, 2]],
                  ] as const
                ).map(([key, options]) => (
                  <Box
                    key={key}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '150px minmax(0, 1fr)',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <Typography
                      component="label"
                      htmlFor={`setting-${key}`}
                      variant="body2"
                      fontWeight={600}
                    >
                      {t(`settings.gotv.${key}.label`)}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      id={`setting-${key}`}
                      value={vals[key]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        update(key, v);
                        void save({ [key]: v });
                      }}
                      slotProps={{ htmlInput: { 'data-testid': `setting-${key}` } }}
                    >
                      {options.map((o) => (
                        <MenuItem key={o} value={o}>
                          {t(`settings.gotv.${key}.option`, { context: String(o), count: o })}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                ))}
              </Box>
            )}
            <Typography variant="body2" color="text.secondary">
              {vals.gotvDelay === 0
                ? t('settings.gotv.noDelayNote')
                : t('settings.gotv.delayNote', { count: vals.gotvDelay })}{' '}
              {t('settings.gotv.portNote')}
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Alert severity="warning">{t('settings.atCore.expert.description')}</Alert>

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
                  helperText={t('settings.atCore.ready.minimumReadyHelper')}
                  inputProps={{ min: 0, max: 10 }}
                  size="small"
                  fullWidth
                />
                <SwitchRow
                  label={t('settings.atCore.ready.allowForceReady')}
                  checked={vals.atAllowForceReady}
                  onChange={(e) => update('atAllowForceReady', e.target.checked)}
                  size="small"
                />
                <SwitchRow
                  label={t('settings.atCore.ready.teamReady')}
                  checked={vals.atTeamReady}
                  onChange={(e) => update('atTeamReady', e.target.checked)}
                  size="small"
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
                {/* Admin tools */}
                <Box>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {t('settings.atCore.adminTools.title')}
                  </Typography>
                  <Stack spacing={1}>
                    <SwitchRow
                      label={t('settings.atCore.adminTools.joinPassword')}
                      checked={vals.atJoinPassword}
                      onChange={(e) => update('atJoinPassword', e.target.checked)}
                      size="small"
                    />
                    <SwitchRow
                      label={t('settings.atCore.adminTools.connectPreferLan')}
                      checked={vals.connectPreferLan === 1}
                      onChange={(e) => {
                        const v = e.target.checked ? 1 : 0;
                        update('connectPreferLan', v);
                        void save({ connectPreferLan: v });
                      }}
                      size="small"
                      slotProps={{
                        input: { 'data-testid': 'setting-connect-prefer-lan' } as Record<
                          string,
                          string
                        >,
                      }}
                    />
                    <SwitchRow
                      label={t('settings.atCore.adminTools.pauseAfterRestore')}
                      checked={vals.atPauseAfterRestore}
                      onChange={(e) => update('atPauseAfterRestore', e.target.checked)}
                      size="small"
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
              <SwitchRow
                label={t('settings.atEnhanced.autoready.label')}
                checked={vals.atAutoreadyEnabled === 1}
                onChange={(e) => update('atAutoreadyEnabled', e.target.checked ? 1 : 0)}
                size="small"
                help={t('settings.atEnhanced.autoready.description')}
              />
            </Box>

            <Divider />

            {/* Pause System */}
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {t('settings.atEnhanced.pause.title')}
              </Typography>
              <Stack spacing={2}>
                <SwitchRow
                  label={t('settings.atEnhanced.pause.bothTeamsUnpause')}
                  checked={vals.atBothTeamsUnpauseRequired === 1}
                  onChange={(e) => update('atBothTeamsUnpauseRequired', e.target.checked ? 1 : 0)}
                  size="small"
                />
                <SwitchRow
                  label={t('settings.atEnhanced.pause.onDisconnect')}
                  help={t('settings.atEnhanced.pause.onDisconnectHelp')}
                  // On unless turned off (the platform's default).
                  checked={vals.atPauseOnDisconnect !== 0}
                  onChange={(e) => update('atPauseOnDisconnect', e.target.checked ? 1 : 0)}
                  size="small"
                  data-testid="settings-pause-on-disconnect"
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
                  label={t('settings.atEnhanced.pause.pauseDurationLabel')}
                  type="number"
                  value={vals.atPauseDuration ?? ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                    update('atPauseDuration', isNaN(val as number) ? null : val);
                  }}
                  onBlur={flush}
                  helperText={t('settings.atEnhanced.pause.pauseDurationHelper')}
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
                <SwitchRow
                  label={t('settings.atEnhanced.sideSelection.enabled')}
                  checked={vals.atSideSelectionEnabled === 1}
                  onChange={(e) => update('atSideSelectionEnabled', e.target.checked ? 1 : 0)}
                  size="small"
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
                <SwitchRow
                  label={t('settings.atEnhanced.gg.enabled')}
                  checked={vals.atGgEnabled === 1}
                  onChange={(e) => update('atGgEnabled', e.target.checked ? 1 : 0)}
                  size="small"
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
                <SwitchRow
                  label={t('settings.atEnhanced.ffw.enabled')}
                  checked={vals.atFfwEnabled === 1}
                  onChange={(e) => update('atFfwEnabled', e.target.checked ? 1 : 0)}
                  size="small"
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

      <Divider />
      <Box data-testid="cs2-settings-highlights-moved">
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('settings.highlights.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('settings.highlights.moved')}{' '}
          <Link component={RouterLink} to={links.highlights()}>
            {t('nav.highlights')}
          </Link>
        </Typography>
      </Box>

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
            <SwitchRow
              label={
                <Typography component="span" color="error.main" fontWeight={600}>
                  {t('settings.developer.simulateToggleLabel')}
                </Typography>
              }
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
            <Typography
              variant="caption"
              color="error.main"
              display="block"
              mt={1}
              fontWeight={500}
            >
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
                  max={4}
                  step={0.1}
                  marks={[1, 2, 3, 4].map((v) => ({ value: v, label: `${v}×` }))}
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
