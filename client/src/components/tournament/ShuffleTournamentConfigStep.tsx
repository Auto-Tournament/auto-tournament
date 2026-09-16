import React from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Grid,
  FormHelperText,
  Tooltip,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { EloCalculationTemplate } from '../../types/elo.types';

/**
 * The three meaningful overtime configurations, derived from the
 * (overtimeMode, overtimeSegments) pair that is sent to MatchZy:
 * - enabled            → 'enabled' + null/N segments
 * - disabledDraws      → 'disabled' + null (no overtime, draws allowed)
 * - disabledNoDraws    → 'disabled' + 0 (no overtime, damage tiebreak)
 */
export type OvertimeOption = 'enabled' | 'disabledDraws' | 'disabledNoDraws';

export function deriveOvertimeOption(
  mode: 'enabled' | 'disabled' | undefined,
  segments: number | null | undefined
): OvertimeOption {
  if ((mode ?? 'enabled') === 'enabled') return 'enabled';
  return segments === 0 ? 'disabledNoDraws' : 'disabledDraws';
}

export interface ShuffleTournamentSettings {
  teamSize: number; // Number of players per team (default: 5)
  maxRounds: number; // Directly controls mp_maxrounds in the MatchZy config
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
  overtimeMode?: 'enabled' | 'disabled';
  /**
   * See docs/guides/shuffle-tournaments.md for full semantics.
   * - undefined/null → MatchZy default (usually unlimited OT, draws allowed)
   * - 0 with overtimeMode === 'disabled' → "no OT, no draws" (force winner by damage)
   * - >0 with overtimeMode === 'enabled' → OT with damage tiebreak after N segments
   */
  overtimeSegments?: number | null;
}

interface ShuffleTournamentConfigStepProps {
  settings: ShuffleTournamentSettings;
  canEdit: boolean;
  saving: boolean;
  onSettingsChange: (settings: ShuffleTournamentSettings) => void;
  eloTemplates?: EloCalculationTemplate[]; // Available ELO templates
}

export function ShuffleTournamentConfigStep({
  settings,
  canEdit,
  saving,
  onSettingsChange,
  eloTemplates = [],
}: ShuffleTournamentConfigStepProps) {
  const { t } = useTranslation();
  const overtimeOption = deriveOvertimeOption(settings.overtimeMode, settings.overtimeSegments);

  const handleMaxRoundsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    // Allow empty value for free typing
    if (inputValue === '') {
      onSettingsChange({
        ...settings,
        maxRounds: 0, // Use 0 as placeholder for empty, will be validated on proceed
      });
      return;
    }
    const value = parseInt(inputValue, 10);
    if (!isNaN(value)) {
      onSettingsChange({
        ...settings,
        maxRounds: value,
      });
    }
  };

  const handleTeamSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    // Allow empty value for free typing
    if (inputValue === '') {
      onSettingsChange({
        ...settings,
        teamSize: 0, // Use 0 as placeholder for empty, will be validated on proceed
      });
      return;
    }
    const value = parseInt(inputValue, 10);
    if (!isNaN(value)) {
      onSettingsChange({
        ...settings,
        teamSize: value,
      });
    }
  };

  const handleEloTemplateChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    onSettingsChange({
      ...settings,
      eloTemplateId: value === 'pure-win-loss' ? 'pure-win-loss' : value,
    });
  };

  const handleOvertimeOptionChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value as OvertimeOption;
    if (value === 'enabled') {
      onSettingsChange({
        ...settings,
        overtimeMode: 'enabled',
        // 0 segments only means something together with "disabled".
        overtimeSegments: settings.overtimeSegments === 0 ? null : settings.overtimeSegments,
      });
      return;
    }
    onSettingsChange({
      ...settings,
      overtimeMode: 'disabled',
      overtimeSegments: value === 'disabledNoDraws' ? 0 : null,
    });
  };

  const handleOvertimeSegmentsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    if (raw === '') {
      onSettingsChange({
        ...settings,
        overtimeSegments: null,
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onSettingsChange({
        ...settings,
        overtimeSegments: null,
      });
      return;
    }
    onSettingsChange({
      ...settings,
      overtimeSegments: parsed,
    });
  };

  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={600}>
        {t('tournament.shuffleConfig.overline')}
      </Typography>
      <Typography variant="subtitle2" fontWeight={600} mb={2}>
        {t('tournament.shuffleConfig.subtitle')}
      </Typography>

      <Grid container spacing={3}>
        {/* Team Size */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title={t('tournament.shuffleConfig.teamSizeTooltip')}
            arrow
            placement="top"
            enterDelay={500}
          >
            <TextField
              label={t('tournament.shuffleConfig.teamSizeLabel')}
              type="number"
              value={settings.teamSize === 0 ? '' : settings.teamSize}
              onChange={handleTeamSizeChange}
              disabled={!canEdit || saving}
              slotProps={{
                htmlInput: { min: 2, max: 10, 'data-testid': 'shuffle-team-size-field' },
              }}
              helperText={t('tournament.shuffleConfig.teamSizeHelper')}
              error={settings.teamSize > 0 && (settings.teamSize < 2 || settings.teamSize > 10)}
              fullWidth
            />
          </Tooltip>
        </Grid>

        {/* Max Rounds */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title={t('tournament.shuffleConfig.maxRoundsTooltip')}
            arrow
            placement="top"
            enterDelay={500}
          >
            <TextField
              label={t('tournament.shuffleConfig.maxRoundsLabel')}
              type="number"
              value={settings.maxRounds === 0 ? '' : settings.maxRounds}
              onChange={handleMaxRoundsChange}
              disabled={!canEdit || saving}
              slotProps={{
                htmlInput: { min: 1, max: 30, 'data-testid': 'shuffle-max-rounds-field' },
              }}
              helperText={
                settings.maxRounds > 0
                  ? t('tournament.shuffleConfig.maxRoundsHelper', {
                      maxRounds: settings.maxRounds,
                      winRounds: Math.floor(settings.maxRounds / 2) + 1,
                    })
                  : t('tournament.shuffleConfig.maxRoundsHelperEmpty')
              }
              error={settings.maxRounds > 0 && (settings.maxRounds < 1 || settings.maxRounds > 30)}
              fullWidth
            />
          </Tooltip>
        </Grid>

        {/* ELO Calculation Template */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title={t('tournament.shuffleConfig.eloTemplateTooltip')}
            arrow
            placement="top"
            enterDelay={500}
          >
            <FormControl fullWidth data-testid="shuffle-elo-template-field">
              <InputLabel id="elo-template-label" shrink={true}>
                {t('tournament.shuffleConfig.eloTemplateLabel')}
              </InputLabel>
              <Select
                labelId="elo-template-label"
                value={settings.eloTemplateId ?? 'pure-win-loss'}
                label={t('tournament.shuffleConfig.eloTemplateLabel')}
                onChange={handleEloTemplateChange}
                disabled={!canEdit || saving}
                notched={true}
              >
                {eloTemplates
                  .filter((t) => t.enabled || t.id === 'pure-win-loss')
                  .sort((a, b) => {
                    // Put pure-win-loss first
                    if (a.id === 'pure-win-loss') return -1;
                    if (b.id === 'pure-win-loss') return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.id === 'pure-win-loss' ? (
                        <>
                          {template.name}
                          <em style={{ marginLeft: 8, opacity: 0.7, fontSize: '0.875rem' }}>
                            {t('tournament.shuffleConfig.eloDefaultSuffix')}
                          </em>
                        </>
                      ) : (
                        template.name
                      )}
                    </MenuItem>
                  ))}
              </Select>
              <FormHelperText>
                {eloTemplates.find((t) => t.id === (settings.eloTemplateId || 'pure-win-loss'))
                  ?.description || t('tournament.shuffleConfig.eloTemplateHelper')}
              </FormHelperText>
            </FormControl>
          </Tooltip>
        </Grid>

        {/* Overtime Settings */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title={t('tournament.overtime.shuffleTooltip')}
            arrow
            placement="top"
            enterDelay={500}
          >
            <Box>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel id="shuffle-overtime-mode-label">
                  {t('tournament.overtime.selectLabel')}
                </InputLabel>
                <Select
                  labelId="shuffle-overtime-mode-label"
                  value={overtimeOption}
                  label={t('tournament.overtime.selectLabel')}
                  onChange={handleOvertimeOptionChange}
                  disabled={!canEdit || saving}
                >
                  <MenuItem value="enabled">{t('tournament.overtime.options.enabled')}</MenuItem>
                  <MenuItem value="disabledDraws">
                    {t('tournament.overtime.options.disabledDraws')}
                  </MenuItem>
                  <MenuItem value="disabledNoDraws">
                    {t('tournament.overtime.options.disabledNoDraws')}
                  </MenuItem>
                </Select>
                <FormHelperText>{t('tournament.overtime.modeHelper')}</FormHelperText>
              </FormControl>

              {overtimeOption === 'enabled' && (
                <TextField
                  label={t('tournament.overtime.segmentsLabel')}
                  type="number"
                  value={
                    typeof settings.overtimeSegments === 'number' ? settings.overtimeSegments : ''
                  }
                  onChange={handleOvertimeSegmentsChange}
                  disabled={!canEdit || saving}
                  slotProps={{
                    htmlInput: { min: 0, max: 10 },
                  }}
                  helperText={
                    typeof settings.overtimeSegments === 'number' && settings.overtimeSegments > 0
                      ? t('tournament.overtime.segmentsHelperValue', {
                          count: settings.overtimeSegments,
                        })
                      : t('tournament.overtime.segmentsHelper')
                  }
                  fullWidth
                />
              )}
            </Box>
          </Tooltip>
        </Grid>
      </Grid>
    </Box>
  );
}
