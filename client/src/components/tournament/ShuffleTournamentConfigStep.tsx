import React from 'react';
import { TextField, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';

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
}

/**
 * The setting only shuffle tournaments have: players per team. Round limit and
 * overtime live with the Counter-Strike 2 settings (integrations/cs2/setup/Cs2MatchSettings) and
 * the rating template on the Basics step, the same as for bracket tournaments.
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
