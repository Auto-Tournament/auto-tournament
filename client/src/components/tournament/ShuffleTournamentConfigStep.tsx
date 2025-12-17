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
  roundLimitType: 'first_to_13' | 'max_rounds';
  maxRounds: number;
  overtimeMode: 'enabled' | 'disabled';
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
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
  const handleRoundLimitTypeChange = (event: SelectChangeEvent<string>) => {
    onSettingsChange({
      ...settings,
      roundLimitType: event.target.value as 'first_to_13' | 'max_rounds',
    });
  };

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

  const handleOvertimeModeChange = (event: SelectChangeEvent<string>) => {
    onSettingsChange({
      ...settings,
      overtimeMode: event.target.value as 'enabled' | 'disabled',
    });
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

        {/* Round Limit Type */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Tooltip
            title="Determines how matches end. 'First to 13' is standard competitive format. 'Max Rounds' allows custom round limits."
            arrow
            placement="top"
            enterDelay={500}
          >
            <FormControl fullWidth data-testid="shuffle-round-limit-field">
              <InputLabel>Round Limit Type</InputLabel>
              <Select
                value={settings.roundLimitType}
                label="Round Limit Type"
                onChange={handleRoundLimitTypeChange}
                disabled={!canEdit || saving}
              >
                <MenuItem value="first_to_13">First to 13</MenuItem>
                <MenuItem value="max_rounds">Max Rounds</MenuItem>
              </Select>
              <FormHelperText>
                {settings.roundLimitType === 'first_to_13'
                  ? 'Match ends when a team reaches 13 rounds (standard competitive format)'
                  : 'Match continues until max rounds is reached'}
              </FormHelperText>
            </FormControl>
          </Tooltip>
        </Grid>

        {/* Max Rounds (only shown if roundLimitType is max_rounds) */}
        {settings.roundLimitType === 'max_rounds' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <Tooltip
              title={`Maximum number of rounds per match. CS2 automatically determines the winner as the first team to reach (max rounds ÷ 2) + 1 rounds. For example, with max rounds set to 24, the winner is the first team to reach 13 rounds (24 ÷ 2 + 1 = 13). This setting is passed to MatchZy, which handles match completion logic. Recommended: 24 rounds for balanced matches.`}
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
                    ? `Winner is first team to reach ${
                        Math.floor(settings.maxRounds / 2) + 1
                      } rounds (max rounds: ${settings.maxRounds})`
                    : 'Maximum number of rounds per match (default: 24, max: 30)'
                }
                error={
                  settings.maxRounds > 0 && (settings.maxRounds < 1 || settings.maxRounds > 30)
                }
                fullWidth
              />
            </Tooltip>
          </Grid>
        )}

        {/* Overtime Mode - Only shown when roundLimitType is first_to_13 */}
        {settings.roundLimitType === 'first_to_13' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <Tooltip
              title="Controls what happens when a match is tied at 12-12. When enabled, standard CS2 overtime rules apply (MR3 format - first to 4 rounds with 10k start money)."
              arrow
              placement="top"
              enterDelay={500}
            >
              <FormControl fullWidth data-testid="shuffle-overtime-field">
                <InputLabel>Overtime Mode</InputLabel>
                <Select
                  value={settings.overtimeMode}
                  label="Overtime Mode"
                  onChange={handleOvertimeModeChange}
                  disabled={!canEdit || saving}
                >
                  <MenuItem value="enabled">Enable Overtime</MenuItem>
                  <MenuItem value="disabled">No Overtime (Tie at 12-12)</MenuItem>
                </Select>
                <FormHelperText>
                  {settings.overtimeMode === 'enabled'
                    ? 'Standard CS2 overtime rules apply (MR3 format - first to 4 rounds wins)'
                    : 'Match ends at 12-12 tie, no overtime. Winner determined by score or tie.'}
                </FormHelperText>
              </FormControl>
            </Tooltip>
          </Grid>
        )}

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
      </Grid>
    </Box>
  );
}
