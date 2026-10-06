import { useMemo } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { CalendarPlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { EventPageScheduleItem } from '../../../types';
import { layoutSchedule, scheduleToIcs } from '../../../utils/scheduleCalendar';
import { tokens, fontDisplay, mono, radii, withAlpha } from '../../../theme/tokens';

const { color } = tokens;
const ROW = 40;
const HOUR = 60 * 60 * 1000;

interface ScheduleCalendarProps {
  schedule: EventPageScheduleItem[];
  /** For the calendar file's event titles. */
  tournamentName: string;
  tournamentId: number;
}

/**
 * The schedule as a calendar: a column per day side by side, an hour grid down
 * the left, and each item as a block from its time until the next item. Easier
 * to read at a glance than a list of times. "Add to calendar" downloads it as
 * an .ics file.
 */
export function ScheduleCalendar({ schedule, tournamentName, tournamentId }: ScheduleCalendarProps) {
  const { t, i18n } = useTranslation();
  const layout = useMemo(() => layoutSchedule(schedule), [schedule]);
  const icsHref = useMemo(
    () =>
      layout
        ? `data:text/calendar;charset=utf-8,${encodeURIComponent(
            scheduleToIcs(tournamentName, layout, `t${tournamentId}`)
          )}`
        : null,
    [layout, tournamentName, tournamentId]
  );
  if (!layout) return null;

  const { days, firstHour, lastHour } = layout;
  const rows = lastHour - firstHour;
  const dayLabel = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const hourLabel = (hour: number) => time.format(new Date(2026, 0, 1, hour));

  return (
    <Box component="section" aria-labelledby="overview-schedule-title" data-testid="overview-schedule">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5 }}>
        <Typography
          id="overview-schedule-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
          {t('overviewPage.schedule')}
        </Typography>
        {icsHref && (
          <Link
            href={icsHref}
            download={`${tournamentName.replace(/[^\w-]+/g, '-').toLowerCase() || 'schedule'}.ics`}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.875rem', color: color.ink2 }}
          >
            <CalendarPlusIcon size={16} aria-hidden />
            {t('overviewPage.addToCalendar')}
          </Link>
        )}
      </Box>

      <Box
        sx={{
          p: { xs: 2, md: '20px 24px' },
          borderRadius: radii.lg,
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          overflowX: 'auto',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(${days.length}, minmax(180px, 1fr))`,
            columnGap: 2,
          }}
        >
          <span />
          {days.map((day) => (
            <Typography
              key={day.key}
              component="h3"
              sx={{ ...mono, fontSize: '0.75rem', color: color.ink2, pb: 1.25, textTransform: 'uppercase' }}
            >
              {dayLabel.format(day.midnight)}
            </Typography>
          ))}

          <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column' }}>
            {Array.from({ length: rows }, (_, i) => (
              <Typography key={i} sx={{ ...mono, height: ROW, fontSize: '0.75rem', color: color.muted }}>
                {hourLabel(firstHour + i)}
              </Typography>
            ))}
          </Box>

          {days.map((day) => (
            <Box
              key={day.key}
              component="ol"
              sx={{
                position: 'relative',
                height: rows * ROW,
                listStyle: 'none',
                m: 0,
                p: 0,
                backgroundImage: `repeating-linear-gradient(to bottom, ${color.rule} 0 1px, transparent 1px ${ROW}px)`,
              }}
            >
              {day.events.map((event, index) => {
                const top = ((event.start - day.midnight) / HOUR - firstHour) * ROW + 2;
                const height = Math.max(((event.end - event.start) / HOUR) * ROW - 4, 30);
                const accent = event.isCheckIn ? color.medalGold : event.isLast ? color.sideT : color.accent;
                const width = `calc(${100 / event.lanes}% - ${event.lanes > 1 ? 4 : 0}px)`;
                return (
                  <Box
                    key={index}
                    component="li"
                    data-testid="schedule-event"
                    sx={{
                      position: 'absolute',
                      top,
                      height,
                      left: `calc(${(100 / event.lanes) * event.lane}% + ${event.lane > 0 ? 4 : 0}px)`,
                      width,
                      boxSizing: 'border-box',
                      borderRadius: '10px',
                      px: 1.25,
                      py: 0.75,
                      // Solid, so the hour lines do not show through the block.
                      background: `linear-gradient(${withAlpha(accent, 0.16)}, ${withAlpha(accent, 0.16)}), ${color.paper2}`,
                      borderLeft: `3px solid ${accent}`,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: height < 50 ? 'row' : 'column',
                      justifyContent: height < 50 ? 'space-between' : 'flex-start',
                      alignItems: height < 50 ? 'center' : 'stretch',
                      gap: 0.25,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: event.isCheckIn ? color.medalGold : event.isLast ? color.sideT : color.ink,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: height < 50 ? 'nowrap' : 'normal',
                      }}
                    >
                      {event.label}
                    </Typography>
                    <Typography sx={{ ...mono, fontSize: '0.75rem', color: color.muted, flex: 'none' }}>
                      {time.format(event.start)} – {time.format(event.end)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
