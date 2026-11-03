/**
 * The Schedule step's start (Claude Design, Setup › Schedule): a round's day
 * among the tournament's days, and "Start automatically at …" with the
 * reminders before the start (moved here from Name and day).
 */
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { timeLocale } from '../../../utils/time';
import { SwitchRow } from '../../common/ui';
import { parseDay } from '../../common/DatePicker';
import { radii, tokens } from '../../../theme/tokens';
import type { StartForm } from './startForm';

const REMINDER_CHOICES = [60, 30, 15, 5];

/** A round's day, from the days picked in step 2. */
export function RoundDaySelect({
  days,
  value,
  onChange,
  label,
  disabled,
  testId,
}: {
  days: string[];
  value: string;
  onChange: (day: string) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  const { i18n } = useTranslation();
  const name = (day: string) =>
    parseDay(day)?.toLocaleDateString(timeLocale(i18n.language), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) ?? day;
  const options = days.includes(value) || !value ? days : [value, ...days];
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      disabled={disabled || options.length < 2}
      onChange={(e) => onChange(e.target.value)}
      sx={{ width: 170 }}
      slotProps={{ htmlInput: { 'data-testid': testId } }}
    >
      {options.map((day) => (
        <MenuItem key={day} value={day}>
          {name(day)}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** "Start automatically at 18:00" and the reminders before the start. */
export function ScheduleStart({
  value,
  onChange,
  startTime,
  disabled,
}: {
  value: StartForm;
  onChange: (next: StartForm) => void;
  /** The start ("HH:MM"), '' while it has none. */
  startTime: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<StartForm>) => onChange({ ...value, ...patch });
  return (
    <Box
      data-testid="setup-schedule-start"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        px: 2,
        py: 1.75,
        borderRadius: radii.md,
        bgcolor: tokens.color.paper3,
      }}
    >
      <SwitchRow
        label={
          startTime
            ? t('tournament.setup.schedule.autoStart', { time: startTime })
            : t('tournament.setup.schedule.autoStartNoTime')
        }
        checked={value.autoStart && Boolean(startTime)}
        disabled={disabled || !startTime}
        onChange={(e) => set({ autoStart: e.target.checked })}
        data-testid="event-auto-start"
      />
      <Typography variant="body2" color="text.secondary">
        {t('tournament.setup.schedule.autoStartOff')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('tournament.setup.schedule.reminders')}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {REMINDER_CHOICES.map((m) => {
          const on = value.startReminders.includes(m);
          return (
            <Chip
              key={m}
              label={t('tournament.eventPage.reminderMinutes', { count: m })}
              color={on ? 'primary' : 'default'}
              variant={on ? 'filled' : 'outlined'}
              disabled={disabled || !startTime}
              onClick={() =>
                set({
                  startReminders: on
                    ? value.startReminders.filter((x) => x !== m)
                    : [...value.startReminders, m].sort((a, b) => b - a),
                })
              }
            />
          );
        })}
      </Stack>
    </Box>
  );
}
