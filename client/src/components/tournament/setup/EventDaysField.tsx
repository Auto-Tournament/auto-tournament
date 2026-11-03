/**
 * Name and day's "Day" (Claude Design, Setup › Name and day): one day, or a
 * first and a last day. The start time is set on Schedule.
 */
import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { DateRangeField, dayOf, parseDay } from '../../common/DatePicker';
import { onDays, playDaysOf, usePlayWindows } from '../../../hooks/usePlayWindows';
import { OverlapNotice } from './OverlapNotice';
import { daysOf, type StartForm } from './startForm';

export function EventDaysField({
  value,
  onChange,
  disabled,
  tournamentId,
}: {
  value: StartForm;
  onChange: (next: StartForm) => void;
  disabled?: boolean;
  /** The tournament being set up (left out of the overlap check). */
  tournamentId?: number;
}) {
  const { t, i18n } = useTranslation();
  // Days another tournament on this site plays: a dot, and a heads-up when picked.
  const others = usePlayWindows(tournamentId);
  const clash = onDays(others, daysOf(value));
  const lang = i18n.language || 'en';
  const hhmm = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  // Kept apart from the dates: picking the first day can leave last = first for a moment.
  const [several, setSeveralOn] = useState(
    Boolean(value.firstDay) && value.lastDay > value.firstDay
  );
  const setSeveral = (on: boolean) => {
    setSeveralOn(on);
    const first = value.firstDay || dayOf(new Date());
    const next = new Date(`${first}T12:00:00`);
    next.setDate(next.getDate() + 1);
    onChange({ ...value, firstDay: first, lastDay: on ? dayOf(next) : first });
  };
  return (
    <Box
      data-testid="setup-event-days"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      <Typography component="h2" variant="h6" fontWeight={600}>
        {t('tournament.setup.days.title')}
      </Typography>
      <SegmentedControl
        label={t('tournament.setup.days.title')}
        value={several ? 'several' : 'one'}
        onChange={(v) => setSeveral(v === 'several')}
        disabled={disabled}
        testId="setup-days-span"
        options={[
          { value: 'one', label: t('tournament.setup.days.one') },
          { value: 'several', label: t('tournament.setup.days.several') },
        ]}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.75, alignItems: 'flex-start' }}>
        <DateRangeField
          first={value.firstDay}
          last={value.lastDay}
          range={several}
          onChange={(first, last) => onChange({ ...value, firstDay: first, lastDay: last })}
          firstLabel={
            several ? t('tournament.setup.days.firstDay') : t('tournament.setup.days.day')
          }
          lastLabel={t('tournament.setup.days.lastDay')}
          marked={playDaysOf(others)}
          markedLegend={t('tournament.setup.days.markedLegend')}
          disabled={disabled}
          testId="setup-days"
        />
        {clash && (
          <OverlapNotice
            title={t('tournament.setup.overlap.headsUp', {
              name: clash.name,
              day: parseDay(clash.day)?.toLocaleDateString(lang, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
            })}
            body={t('tournament.setup.overlap.headsUpBody', {
              from: hhmm(clash.start),
              to: hhmm(clash.end),
            })}
            to={`/tournament/${clash.id}`}
            linkText={t('tournament.setup.overlap.openOther', { name: clash.name })}
          />
        )}
      </Box>
    </Box>
  );
}
