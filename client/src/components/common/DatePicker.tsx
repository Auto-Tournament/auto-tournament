/**
 * The site's own date and time pickers (Claude Design "Tournament settings with
 * esports preset", Setup › Name and day): a field that opens a dark card with a
 * month calendar (orange selection, range shading, a dot on marked days) and/or
 * half-hour time slots, instead of the browser's native picker.
 *
 * Days are local dates as "YYYY-MM-DD"; times "HH:MM"; date-times ISO strings.
 */
import { useState } from 'react';
import { Box } from '@mui/material';
import { CalendarBlankIcon, ClockIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { timeLocale } from '../../utils/time';
import { tokens } from '../../theme/tokens';
import {
  Card,
  FieldButton,
  Footer,
  MonthCalendar,
  TimeSlots,
  dayOf,
  isoOf,
  parseDay,
  splitIso,
  useFormat,
} from './DatePickerParts';

export { dayOf, isoOf, parseDay, splitIso } from './DatePickerParts';

const { color } = tokens;

/**
 * One day, or a first and a last day picked on one calendar (`range`).
 * `marked` days get a dot, explained by `markedLegend`.
 */
export function DateRangeField({
  first,
  last,
  range = false,
  onChange,
  firstLabel,
  lastLabel,
  marked,
  markedLegend,
  disabled,
  testId = 'date-range',
}: {
  first: string;
  last: string;
  range?: boolean;
  onChange: (first: string, last: string) => void;
  firstLabel: string;
  lastLabel: string;
  marked?: string[];
  markedLegend?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<'first' | 'last'>('first');
  const end = range && last >= first ? last : first;
  const pick = (day: string) => {
    if (!range) return onChange(day, day);
    if (editing === 'last' && day >= first) {
      onChange(first, day);
      return setAnchor(null);
    }
    onChange(day, day > end ? day : end);
    setEditing('last');
  };
  const icon = <CalendarBlankIcon size={18} />;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
      <FieldButton
        label={firstLabel}
        text={fmt.day(first)}
        placeholder={t('common.datePicker.chooseDay')}
        open={Boolean(anchor) && editing === 'first'}
        icon={icon}
        disabled={disabled}
        testId={`${testId}-first`}
        onOpen={(el) => {
          setEditing('first');
          setAnchor(el);
        }}
      />
      {range && (
        <FieldButton
          label={lastLabel}
          text={fmt.day(end)}
          placeholder={t('common.datePicker.chooseDay')}
          open={Boolean(anchor) && editing === 'last'}
          icon={icon}
          disabled={disabled}
          testId={`${testId}-last`}
          onOpen={(el) => {
            setEditing('last');
            setAnchor(el);
          }}
        />
      )}
      <Card
        anchor={anchor}
        onClose={() => setAnchor(null)}
        label={t('common.datePicker.chooseDays')}
      >
        <MonthCalendar
          initial={parseDay(editing === 'last' ? end : first) ?? new Date()}
          selected={(day) => day === first || day === end}
          inRange={(day) => day > first && day < end}
          marked={marked}
          markedLegend={markedLegend}
          onPick={pick}
        />
        <Footer onToday={() => pick(dayOf(new Date()))} onDone={() => setAnchor(null)} />
      </Card>
    </Box>
  );
}

/** A day and a time in one field (sign-up opens and closes). `value` is ISO, '' for none. */
export function DateTimeField({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { day, time } = splitIso(value);
  const d = value ? new Date(value) : null;
  const text =
    d && !Number.isNaN(d.getTime())
      ? `${d.toLocaleDateString(timeLocale(i18n.language), { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
      : '';
  const set = (nextDay: string, nextTime: string) => onChange(isoOf(nextDay, nextTime || '18:00'));
  return (
    <>
      <FieldButton
        label={label}
        text={text}
        placeholder={t('common.datePicker.chooseDay')}
        open={Boolean(anchor)}
        width={240}
        icon={<CalendarBlankIcon size={18} />}
        disabled={disabled}
        testId={testId}
        onOpen={setAnchor}
      />
      <Card anchor={anchor} onClose={() => setAnchor(null)} label={label}>
        <MonthCalendar
          initial={parseDay(day) ?? new Date()}
          selected={(x) => x === day}
          onPick={(x) => set(x, time)}
        />
        <Box sx={{ mt: 1.25, pt: 1.25, borderTop: `1px solid ${color.rule}` }}>
          <TimeSlots value={time} onPick={(x) => set(day || dayOf(new Date()), x)} />
        </Box>
        <Footer onDone={() => setAnchor(null)} />
      </Card>
    </>
  );
}

/** A time of day, "HH:MM" ('' for none), from half-hour slots. */
export function TimeField({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <FieldButton
        label={label}
        text={value}
        placeholder={t('common.datePicker.chooseTime')}
        open={Boolean(anchor)}
        width={150}
        icon={<ClockIcon size={18} />}
        disabled={disabled}
        testId={testId}
        onOpen={setAnchor}
      />
      <Card anchor={anchor} onClose={() => setAnchor(null)} label={label}>
        <TimeSlots
          value={value}
          onPick={(x) => {
            onChange(x);
            setAnchor(null);
          }}
        />
      </Card>
    </>
  );
}
