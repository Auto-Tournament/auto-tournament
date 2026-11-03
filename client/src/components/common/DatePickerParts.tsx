/**
 * Parts of the site's own date and time pickers (DatePicker.tsx).
 *
 * The site's own date and time pickers (Claude Design "Tournament settings with
 * esports preset", Setup › Name and day): a field that opens a dark card with a
 * month calendar (orange selection, range shading, a dot on marked days) and/or
 * half-hour time slots, instead of the browser's native picker.
 *
 * Days are local dates as "YYYY-MM-DD"; times "HH:MM"; date-times ISO strings.
 */
import { useState, type ReactNode } from 'react';
import { Box, ButtonBase, Popover, Typography } from '@mui/material';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { mono, radii, tokens, withAlpha } from '../../theme/tokens';
import { dayOf, parseDay } from '../../utils/localDay';

export { dayOf, isoOf, parseDay, splitIso } from '../../utils/localDay';

const { color } = tokens;
const pad = (n: number) => String(n).padStart(2, '0');

const SLOTS = Array.from(
  { length: 48 },
  (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`
);

export function useFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  return {
    day: (day: string) => {
      const d = parseDay(day);
      return d
        ? d.toLocaleDateString(lang, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';
    },
    month: (d: Date) => d.toLocaleDateString(lang, { month: 'long', year: 'numeric' }),
    weekdays: Array.from({ length: 7 }, (_, i) =>
      // 2024-01-01 was a Monday: the calendar starts on Monday.
      new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: 'narrow' })
    ),
  };
}

const fieldSx = (open: boolean, width: number) =>
  ({
    width,
    height: 48,
    boxSizing: 'border-box',
    borderRadius: '12px',
    border: open ? `2px solid ${color.accent}` : `1px solid ${withAlpha(color.ink, 0.23)}`,
    bgcolor: color.paper2,
    color: color.ink,
    px: 1.75,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 1,
    font: 'inherit',
    fontSize: 15,
    textAlign: 'left',
  }) as const;

/** The closed field: a small label over the value, and an icon. */
export function FieldButton({
  label,
  text,
  placeholder,
  open,
  width = 220,
  icon,
  disabled,
  testId,
  onOpen,
}: {
  label: string;
  text: string;
  placeholder: string;
  open: boolean;
  width?: number;
  icon: ReactNode;
  disabled?: boolean;
  testId?: string;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <ButtonBase
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      data-testid={testId}
      onClick={(e) => onOpen(e.currentTarget)}
      sx={{ ...fieldSx(open, width), opacity: disabled ? 0.5 : 1 }}
    >
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box component="span" sx={{ fontSize: 11, color: color.ink2 }}>
          {label}
        </Box>
        <Box component="span" sx={{ color: text ? color.ink : color.muted, whiteSpace: 'nowrap' }}>
          {text || placeholder}
        </Box>
      </Box>
      {icon}
    </ButtonBase>
  );
}

export function Card({
  anchor,
  onClose,
  label,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': label,
          sx: {
            mt: 1,
            p: 1.75,
            width: 340,
            boxSizing: 'border-box',
            borderRadius: '16px',
            border: `1px solid ${color.rule}`,
            bgcolor: color.paper2,
            backgroundImage: 'none',
            boxShadow: `0 18px 40px ${color.shadow}`,
          },
        },
      }}
    >
      {children}
    </Popover>
  );
}

const cellBg = (sel: boolean, range: boolean) => {
  if (sel) return color.accent;
  return range ? withAlpha(color.accent, 0.18) : 'transparent';
};
const cellInk = (sel: boolean, own: boolean) => {
  if (sel) return color.accentInk;
  return own ? color.ink : color.muted;
};

/** A month grid starting on Monday. */
export function MonthCalendar({
  selected,
  inRange,
  marked,
  markedLegend,
  onPick,
  initial,
}: {
  selected: (day: string) => boolean;
  inRange?: (day: string) => boolean;
  marked?: string[];
  markedLegend?: string;
  onPick: (day: string) => void;
  initial: Date;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const lead = (month.getDay() + 6) % 7;
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i)
  );
  const rows = cells.slice(35).some((d) => d.getMonth() === month.getMonth())
    ? cells
    : cells.slice(0, 35);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const arrow = { width: 36, height: 36, borderRadius: '10px', color: color.ink2 } as const;
  return (
    <Box>
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}
      >
        <ButtonBase
          aria-label={t('common.datePicker.previousMonth')}
          onClick={() => shift(-1)}
          sx={arrow}
        >
          <CaretLeftIcon size={16} />
        </ButtonBase>
        <Typography sx={{ fontWeight: 600, fontSize: 15, textTransform: 'capitalize' }}>
          {fmt.month(month)}
        </Typography>
        <ButtonBase
          aria-label={t('common.datePicker.nextMonth')}
          onClick={() => shift(1)}
          sx={arrow}
        >
          <CaretRightIcon size={16} />
        </ButtonBase>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '2px',
          textAlign: 'center',
        }}
      >
        {fmt.weekdays.map((w, i) => (
          <Box
            key={i}
            component="span"
            aria-hidden
            sx={{ ...mono, fontSize: 11, color: color.muted, py: 0.75 }}
          >
            {w}
          </Box>
        ))}
        {rows.map((d) => {
          const day = dayOf(d);
          const own = d.getMonth() === month.getMonth();
          const sel = own && selected(day);
          const range = own && !sel && inRange?.(day);
          return (
            <ButtonBase
              key={day}
              aria-label={fmt.day(day)}
              aria-pressed={sel}
              onClick={() => onPick(day)}
              data-testid={`date-picker-day-${day}`}
              sx={{
                position: 'relative',
                height: 40,
                borderRadius: '10px',
                fontSize: 14,
                fontWeight: sel ? 700 : 400,
                bgcolor: cellBg(sel, Boolean(range)),
                color: cellInk(sel, own),
              }}
            >
              {d.getDate()}
              {marked?.includes(day) && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 5,
                    width: 5,
                    height: 5,
                    ml: '-2.5px',
                    borderRadius: '999px',
                    bgcolor: color.warning,
                  }}
                />
              )}
            </ButtonBase>
          );
        })}
      </Box>
      {marked && marked.length > 0 && markedLegend && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 1.25,
            fontSize: 12,
            color: color.ink2,
          }}
        >
          <Box
            component="span"
            aria-hidden
            sx={{ width: 6, height: 6, borderRadius: '999px', bgcolor: color.warning }}
          />
          {markedLegend}
        </Box>
      )}
    </Box>
  );
}

export function Footer({ onToday, onDone }: { onToday?: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        mt: 1.25,
        pt: 1.25,
        borderTop: `1px solid ${color.rule}`,
      }}
    >
      {onToday ? (
        <ButtonBase
          onClick={onToday}
          sx={{ height: 36, px: 1.5, borderRadius: radii.pill, color: color.ink2, fontSize: 13 }}
        >
          {t('common.datePicker.today')}
        </ButtonBase>
      ) : (
        <span />
      )}
      <ButtonBase
        onClick={onDone}
        sx={{
          height: 36,
          px: 2,
          borderRadius: radii.pill,
          bgcolor: color.accent,
          color: color.accentInk,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {t('common.datePicker.done')}
      </ButtonBase>
    </Box>
  );
}

export function TimeSlots({ value, onPick }: { value: string; onPick: (time: string) => void }) {
  const { t } = useTranslation();
  const slots = value && !SLOTS.includes(value) ? [...SLOTS, value].sort() : SLOTS;
  return (
    <Box
      role="listbox"
      aria-label={t('common.datePicker.time')}
      // Scrolled so the chosen time (else 18:00) is in view.
      ref={(el: HTMLDivElement | null) => {
        const at = el?.querySelector<HTMLElement>('[aria-selected="true"]') ?? el?.children[36];
        if (el && at instanceof HTMLElement) el.scrollTop = at.offsetTop - el.offsetTop - 48;
      }}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0.5,
        maxHeight: 176,
        overflowY: 'auto',
      }}
    >
      {slots.map((slot) => (
        <ButtonBase
          key={slot}
          role="option"
          aria-selected={slot === value}
          onClick={() => onPick(slot)}
          data-testid={`time-picker-${slot}`}
          sx={{
            ...mono,
            height: 36,
            borderRadius: '10px',
            fontSize: 13,
            bgcolor: slot === value ? color.accent : 'transparent',
            color: slot === value ? color.accentInk : color.ink,
          }}
        >
          {slot}
        </ButtonBase>
      ))}
    </Box>
  );
}
