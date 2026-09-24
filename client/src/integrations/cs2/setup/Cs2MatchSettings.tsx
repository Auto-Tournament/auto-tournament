import { Box, TextField, Typography } from '@mui/material';
import { SegmentedControl, useModuleTranslation } from '../../../module-sdk';
import { deriveOvertimeOption, type OvertimeOption } from '../../../components/tournament/ShuffleTournamentConfigStep';
import type { TournamentRulesStepProps as Cs2MatchSettingsProps } from '../../types';

/**
 * Round limit and overtime, which the Counter-Strike 2 module passes to
 * MatchZy (mp_maxrounds, overtimeMode / overtimeSegments). Same rules for
 * shuffle and bracket tournaments.
 */
export function Cs2MatchSettings({
  value,
  onChange,
  disabled = false,
  maxRoundsTestId,
}: Cs2MatchSettingsProps) {
  const { t } = useModuleTranslation('cs2');
  const overtimeOption = deriveOvertimeOption(value.overtimeMode, value.overtimeSegments);
  const { maxRounds, overtimeSegments } = value;

  const handleOvertimeOption = (option: OvertimeOption) => {
    if (option === 'enabled') {
      // 0 segments only means something together with "disabled".
      onChange({
        overtimeMode: 'enabled',
        overtimeSegments: overtimeSegments === 0 ? null : overtimeSegments,
      });
      return;
    }
    onChange({
      overtimeMode: 'disabled',
      overtimeSegments: option === 'disabledNoDraws' ? 0 : null,
    });
  };

  return (
    <Box
      component="fieldset"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2.5,
        m: 0,
        minWidth: 0,
        display: 'grid',
        gap: 3,
      }}
    >
      <Box component="legend" sx={{ px: 1 }}>
        <Typography component="span" fontWeight={600}>
          {t('tournament.setup.format.cs2Title')}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
        {t('tournament.setup.format.cs2Help')}
      </Typography>

      <TextField
        label={t('tournament.wizard.maxRoundsLabel')}
        type="number"
        value={maxRounds === 0 ? '' : maxRounds}
        onChange={(event) => {
          const parsed = parseInt(event.target.value, 10);
          onChange({ maxRounds: Number.isNaN(parsed) ? 0 : parsed });
        }}
        disabled={disabled}
        slotProps={{ htmlInput: { min: 1, max: 30, 'data-testid': maxRoundsTestId } }}
        helperText={
          maxRounds > 0
            ? t('tournament.wizard.maxRoundsHelper', {
                maxRounds,
                winRounds: Math.floor(maxRounds / 2) + 1,
              })
            : t('tournament.wizard.maxRoundsHelperEmpty')
        }
        error={maxRounds < 1 || maxRounds > 30}
        sx={{ maxWidth: 360 }}
      />

      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography component="span" variant="body2" fontWeight={600}>
          {t('tournament.overtime.selectLabel')}
        </Typography>
        <SegmentedControl<OvertimeOption>
          label={t('tournament.overtime.selectLabel')}
          value={overtimeOption}
          onChange={handleOvertimeOption}
          disabled={disabled}
          testId="tournament-overtime-mode"
          options={[
            { value: 'enabled', label: t('tournament.setup.format.overtime.enabled') },
            { value: 'disabledDraws', label: t('tournament.setup.format.overtime.disabledDraws') },
            {
              value: 'disabledNoDraws',
              label: t('tournament.setup.format.overtime.disabledNoDraws'),
            },
          ]}
        />
        <Typography variant="body2" color="text.secondary">
          {t('tournament.overtime.modeHelper')}
        </Typography>
      </Box>

      {overtimeOption === 'enabled' && (
        <TextField
          label={t('tournament.overtime.segmentsLabel')}
          type="number"
          value={typeof overtimeSegments === 'number' ? overtimeSegments : ''}
          onChange={(event) => {
            const raw = event.target.value.trim();
            const parsed = Number(raw);
            onChange({
              overtimeSegments:
                raw === '' || !Number.isFinite(parsed) || parsed < 0 ? null : parsed,
            });
          }}
          disabled={disabled}
          slotProps={{ htmlInput: { min: 0, max: 10 } }}
          helperText={
            typeof overtimeSegments === 'number' && overtimeSegments > 0
              ? t('tournament.overtime.segmentsHelperValue', { count: overtimeSegments })
              : t('tournament.overtime.segmentsHelper')
          }
          sx={{ maxWidth: 360 }}
        />
      )}
    </Box>
  );
}
