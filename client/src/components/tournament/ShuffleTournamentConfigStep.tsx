import React from 'react';
import { TextField, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * What only a shuffle tournament asks: players per team. Its round rules and
 * map sequence are the game's settings (CS2: `settings.cs2`), asked by the
 * game module's steps like any other tournament's.
 */
export interface ShuffleTournamentSettings {
  teamSize: number; // Number of players per team (default: 5)
}

interface ShuffleTournamentConfigStepProps {
  settings: ShuffleTournamentSettings;
  canEdit: boolean;
  saving: boolean;
  onSettingsChange: (settings: ShuffleTournamentSettings) => void;
}

/**
 * The setting only shuffle tournaments have: players per team. The round
 * limit and overtime are the game module's rules step, and the rating
 * template is on the Basics step, the same as for bracket tournaments.
 */
export function ShuffleTournamentConfigStep({
  settings,
  canEdit,
  saving,
  onSettingsChange,
}: ShuffleTournamentConfigStepProps) {
  const { t } = useTranslation();

  const handleTeamSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    // Empty while typing: 0 is the placeholder, validated before Continue.
    if (inputValue === '') {
      onSettingsChange({ ...settings, teamSize: 0 });
      return;
    }
    const value = parseInt(inputValue, 10);
    if (!isNaN(value)) {
      onSettingsChange({ ...settings, teamSize: value });
    }
  };

  return (
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
        sx={{ maxWidth: 360 }}
      />
    </Tooltip>
  );
}
