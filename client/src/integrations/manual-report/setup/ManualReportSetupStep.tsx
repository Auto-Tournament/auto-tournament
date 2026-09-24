/**
 * The manual-report module's tournament settings, inside the setup wizard
 * (3.0 phase D, PR D9).
 *
 * Mirrors `api/src/integrations/manual-report/setup.ts`, which is where the
 * defaults and the validation live: this form only has to produce a
 * `manualReport` object that one accepts. The core stores and forwards it
 * without reading it, so nothing outside this file and its API twin knows the
 * shape.
 *
 * Series length is asked here rather than by the core, because a module that
 * ships this step owns the question (see `TournamentGameSettingsStepProps`).
 * It writes both `manualReport.bestOf` and the tournament's own `format`, so
 * the bracket and the report form agree about how many games a series is —
 * which is why the choices stop at 5 rather than at the module's 7, the
 * longest series a `format` can spell.
 */

import type { ReactNode } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { SegmentedControl, useModuleTranslation, radii } from '../../../module-sdk';
import type { TournamentGameSettingsStepProps } from '../../types';

/** The module's key inside `tournament.settings`. */
const KEY = 'manualReport';

/** Series lengths a tournament `format` can spell ('bo1', 'bo3', 'bo5'). */
const BEST_OF_CHOICES = [1, 3, 5] as const;

/** A day to answer, the API's default (`DEFAULT_CONFIRM_TIMEOUT_MIN`). */
const DEFAULT_TIMEOUT_MIN = 24 * 60;

type Confirmation = 'opponent' | 'none';
type TimeoutAction = 'auto_confirm' | 'escalate';

interface ManualReportSettings {
  gameLabel: string;
  bestOf: number;
  allowDraw: boolean;
  confirmation: Confirmation;
  confirmTimeoutMin: number;
  timeoutAction: TimeoutAction;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 'bo3' -> 3; anything unreadable is a single game. */
function seriesLengthOf(format: string): number {
  const n = Number(/^bo(\d+)$/i.exec(format)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * The stored object with every default applied, the same defaults `readSetup`
 * applies on the API side. `bestOf` falls back to the tournament's format, so
 * a tournament created before this step existed reads back unchanged.
 */
function readSettings(settings: Record<string, unknown>, format: string): ManualReportSettings {
  const own = asRecord(settings[KEY]);
  const bestOf = Number(own.bestOf);
  const timeout = Number(own.confirmTimeoutMin);
  return {
    gameLabel: typeof own.gameLabel === 'string' ? own.gameLabel : '',
    bestOf: Number.isInteger(bestOf) && bestOf > 0 ? bestOf : seriesLengthOf(format),
    allowDraw: own.allowDraw === true,
    confirmation: own.confirmation === 'none' ? 'none' : 'opponent',
    confirmTimeoutMin:
      Number.isInteger(timeout) && timeout >= 0 ? timeout : DEFAULT_TIMEOUT_MIN,
    timeoutAction: own.timeoutAction === 'escalate' ? 'escalate' : 'auto_confirm',
  };
}

export function ManualReportSetupStep({
  settings,
  onChange,
  gameName,
  format,
  onFormatChange,
  disabled = false,
}: TournamentGameSettingsStepProps) {
  const { t } = useModuleTranslation('manual-report');
  const value = readSettings(settings, format);

  const patch = (change: Partial<ManualReportSettings>) => {
    onChange({ [KEY]: { ...value, ...change } });
  };

  const setBestOf = (bestOf: number) => {
    // Both, and in one update: the bracket reads `format`, the report form
    // reads `bestOf`, and a tournament where they disagree is a series that
    // ends at a different score than the bracket expects.
    onFormatChange(`bo${bestOf}`);
    patch({ bestOf });
  };

  const noDeadline = value.confirmTimeoutMin === 0;
  const timeoutDisabled = disabled || value.confirmation === 'none';

  return (
    <Box
      component="fieldset"
      data-testid="manual-report-setup"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: radii.md,
        p: 2.5,
        m: 0,
        minWidth: 0,
        display: 'grid',
        gap: 3,
      }}
    >
      <Box component="legend" sx={{ px: 1 }}>
        <Typography component="span" fontWeight={600}>
          {t('tournament.setup.manualReport.title')}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
        {t('tournament.setup.manualReport.help')}
      </Typography>

      <Setting
        label={t('tournament.setup.manualReport.seriesLength')}
        help={t('tournament.setup.manualReport.seriesLengthHelp')}
      >
        <SegmentedControl
          label={t('tournament.setup.manualReport.seriesLength')}
          value={String(value.bestOf)}
          onChange={(next) => setBestOf(Number(next))}
          disabled={disabled}
          testId="manual-report-best-of"
          options={BEST_OF_CHOICES.map((n) => ({
            value: String(n),
            label: `Bo${n}`,
            testId: `manual-report-best-of-${n}`,
          }))}
        />
      </Setting>

      <TextField
        label={t('tournament.setup.manualReport.gameLabel')}
        value={value.gameLabel}
        onChange={(event) => patch({ gameLabel: event.target.value.slice(0, 60) })}
        disabled={disabled}
        placeholder={gameName}
        helperText={t('tournament.setup.manualReport.gameLabelHelp', { game: gameName })}
        slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'manual-report-game-label' } }}
        sx={{ maxWidth: 360 }}
      />

      <Setting
        label={t('tournament.setup.manualReport.allowDraw')}
        help={t('tournament.setup.manualReport.allowDrawHelp')}
      >
        <SegmentedControl
          label={t('tournament.setup.manualReport.allowDraw')}
          value={value.allowDraw ? 'yes' : 'no'}
          onChange={(next) => patch({ allowDraw: next === 'yes' })}
          disabled={disabled}
          testId="manual-report-allow-draw"
          options={[
            {
              value: 'no',
              label: t('tournament.setup.manualReport.allowDrawOptions.no'),
              testId: 'manual-report-allow-draw-no',
            },
            {
              value: 'yes',
              label: t('tournament.setup.manualReport.allowDrawOptions.yes'),
              testId: 'manual-report-allow-draw-yes',
            },
          ]}
        />
      </Setting>

      <Setting
        label={t('tournament.setup.manualReport.confirmation')}
        help={t(`tournament.setup.manualReport.confirmationHelp.${value.confirmation}`)}
      >
        <SegmentedControl<Confirmation>
          label={t('tournament.setup.manualReport.confirmation')}
          value={value.confirmation}
          onChange={(next) => patch({ confirmation: next })}
          disabled={disabled}
          testId="manual-report-confirmation"
          options={(['opponent', 'none'] as const).map((mode) => ({
            value: mode,
            label: t(`tournament.setup.manualReport.confirmationOptions.${mode}`),
            testId: `manual-report-confirmation-${mode}`,
          }))}
        />
      </Setting>

      <TextField
        label={t('tournament.setup.manualReport.confirmTimeout')}
        type="number"
        value={value.confirmTimeoutMin}
        onChange={(event) => {
          const parsed = parseInt(event.target.value, 10);
          patch({ confirmTimeoutMin: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed });
        }}
        disabled={timeoutDisabled}
        slotProps={{
          htmlInput: { min: 0, max: 43200, 'data-testid': 'manual-report-confirm-timeout' },
        }}
        helperText={
          noDeadline
            ? t('tournament.setup.manualReport.confirmTimeoutNone')
            : t('tournament.setup.manualReport.confirmTimeoutHelp')
        }
        sx={{ maxWidth: 360 }}
      />

      <Setting
        label={t('tournament.setup.manualReport.timeoutAction')}
        help={t(`tournament.setup.manualReport.timeoutActionHelp.${value.timeoutAction}`)}
      >
        <SegmentedControl<TimeoutAction>
          label={t('tournament.setup.manualReport.timeoutAction')}
          value={value.timeoutAction}
          onChange={(next) => patch({ timeoutAction: next })}
          disabled={timeoutDisabled || noDeadline}
          testId="manual-report-timeout-action"
          options={(['auto_confirm', 'escalate'] as const).map((action) => ({
            value: action,
            label: t(`tournament.setup.manualReport.timeoutActionOptions.${action}`),
            testId: `manual-report-timeout-action-${action}`,
          }))}
        />
      </Setting>
    </Box>
  );
}

/** A labelled control with a help line, the shape the wizard's own steps use. */
function Setting({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <Typography component="span" variant="body2" fontWeight={600}>
        {label}
      </Typography>
      {children}
      <Typography variant="body2" color="text.secondary">
        {help}
      </Typography>
    </Box>
  );
}
