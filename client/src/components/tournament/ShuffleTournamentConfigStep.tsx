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
import type { EloCalculationTemplate } from '../../types/elo.types';

export interface ShuffleTournamentSettings {
  teamSize: number; // Number of players per team (default: 5)
  maxRounds: number; // Directly controls mp_maxrounds in the MatchZy config
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
  overtimeMode?: 'enabled' | 'disabled';
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

  const handleOvertimeModeChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value as 'enabled' | 'disabled';
    onSettingsChange({
      ...settings,
      overtimeMode: value,
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
    if (!Number.isFinite(parsed) || parsed <= 0) {
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
        Shuffle Tournament Configuration
      </Typography>
      <Typography variant="subtitle2" fontWeight={600} mb={2}>
        Match Rules & Settings
      </Typography>

      <Grid container spacing={3}>
        {/* Team Size */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title="Number of players per team. Common options: 4v4, 5v5, 6v6. Minimum 2 players, maximum 10 players per team."
            arrow
            placement="top"
            enterDelay={500}
          >
            <TextField
              label="Team Size"
              type="number"
              value={settings.teamSize === 0 ? '' : settings.teamSize}
              onChange={handleTeamSizeChange}
              disabled={!canEdit || saving}
              slotProps={{
                htmlInput: { min: 2, max: 10, 'data-testid': 'shuffle-team-size-field' },
              }}
              helperText="Number of players per team (default: 5 for 5v5, range: 2-10)"
              error={settings.teamSize > 0 && (settings.teamSize < 2 || settings.teamSize > 10)}
              fullWidth
            />
          </Tooltip>
        </Grid>

        {/* Max Rounds */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title="Maximum number of rounds per match. This value is passed directly to MatchZy as mp_maxrounds. Example: 6 = MR6, 24 = MR24."
            arrow
            placement="top"
            enterDelay={500}
          >
            <TextField
              label="Max Rounds"
              type="number"
              value={settings.maxRounds === 0 ? '' : settings.maxRounds}
              onChange={handleMaxRoundsChange}
              disabled={!canEdit || saving}
              slotProps={{
                htmlInput: { min: 1, max: 30, 'data-testid': 'shuffle-max-rounds-field' },
              }}
              helperText={
                settings.maxRounds > 0
                  ? `Match plays up to ${settings.maxRounds} rounds; winner is first to ${
                      Math.floor(settings.maxRounds / 2) + 1
                    } rounds`
                  : 'Maximum number of rounds per match (default: 24, max: 30)'
              }
              error={settings.maxRounds > 0 && (settings.maxRounds < 1 || settings.maxRounds > 30)}
              fullWidth
            />
          </Tooltip>
        </Grid>

        {/* ELO Calculation Template */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title="Choose how ELO is calculated for this tournament. By default, the 'Pure Win/Loss' template only uses match result (win/loss); stats are tracked but do not change ELO. Other templates are optional and add stat-based adjustments on top of the OpenSkill win/loss change if you want Excel-style behavior."
            arrow
            placement="top"
            enterDelay={500}
          >
            <FormControl fullWidth data-testid="shuffle-elo-template-field">
              <InputLabel id="elo-template-label" shrink={true}>
                ELO Calculation Template
              </InputLabel>
              <Select
                labelId="elo-template-label"
                value={settings.eloTemplateId ?? 'pure-win-loss'}
                label="ELO Calculation Template"
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
                            (Default)
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
                  ?.description ||
                  'Pure Win/Loss (default): only match result affects ELO. Player stats are still recorded for leaderboards and exports, but they do not change the rating unless you select a custom template.'}
              </FormHelperText>
            </FormControl>
          </Tooltip>
        </Grid>

        {/* Overtime Settings */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title={
              'Control overtime behavior for shuffle matches and how ties are decided at max rounds. ' +
              'When overtime is disabled, tied matches can either remain draws or be broken by total team damage, ' +
              'depending on how overtime segments are configured.'
            }
            arrow
            placement="top"
            enterDelay={500}
          >
            <Box>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel id="shuffle-overtime-mode-label">Overtime</InputLabel>
                <Select
                  labelId="shuffle-overtime-mode-label"
                  value={settings.overtimeMode ?? 'enabled'}
                  label="Overtime"
                  onChange={handleOvertimeModeChange}
                  disabled={!canEdit || saving}
                >
                  <MenuItem value="enabled">Enabled (standard overtime)</MenuItem>
                  <MenuItem value="disabled">Disabled (no overtime)</MenuItem>
                </Select>
                <FormHelperText>
                  Enable or disable overtime when a match is tied at max rounds. When overtime is
                  disabled, ties can still be broken by performance (total team damage) if your
                  MatchZy config uses that rule.
                </FormHelperText>
              </FormControl>

              {settings.overtimeMode !== 'disabled' && (
                <TextField
                  label="Overtime segments (optional)"
                  type="number"
                  value={settings.overtimeSegments && settings.overtimeSegments > 0
                    ? settings.overtimeSegments
                    : ''}
                  onChange={handleOvertimeSegmentsChange}
                  disabled={!canEdit || saving}
                  slotProps={{
                    htmlInput: { min: 1, max: 10 },
                  }}
                  helperText={
                    settings.overtimeSegments && settings.overtimeSegments > 0
                      ? `Limit overtime to ${settings.overtimeSegments} segment${
                          settings.overtimeSegments === 1 ? '' : 's'
                        }.`
                      : 'Leave empty for MatchZy default (usually unlimited overtime). When segments are set and your MatchZy config enables performance tiebreaks, tied matches after OT can be decided by total team damage instead of ending as a draw.'
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
