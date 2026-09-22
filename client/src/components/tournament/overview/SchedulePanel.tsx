import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { EventPageScheduleItem } from '../../../types';

interface SchedulePanelProps {
  schedule: EventPageScheduleItem[];
}

/** Ordered schedule rows: time on the left, label on the right. */
export function SchedulePanel({ schedule }: SchedulePanelProps) {
  const { i18n } = useTranslation();
  // Captured once (not read during render) so highlighting "what's next"
  // stays a pure render: components must not call impure functions like
  // Date.now() directly in the render body.
  const [now] = useState(() => Date.now());

  if (schedule.length === 0) return null;

  const formatter = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // The row for the next thing that hasn't happened yet, if any – highlighted
  // like the design's "now" row.
  const nextIndex = schedule.findIndex((item) => new Date(item.at).getTime() >= now);

  return (
    <Box
      data-testid="overview-schedule"
      component="ul"
      sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 2 }}
    >
      {schedule.map((item, index) => {
        const isNext = index === nextIndex;
        const timeLabel = Number.isNaN(new Date(item.at).getTime())
          ? item.at
          : formatter.format(new Date(item.at));

        return (
          <Box
            key={`${item.at}-${index}`}
            component="li"
            sx={{
              display: 'grid',
              gridTemplateColumns: '6.5rem minmax(0, 1fr)',
              gap: 1.5,
              px: 2,
              py: 1,
              borderBottom: index === schedule.length - 1 ? 0 : 1,
              borderColor: 'divider',
            }}
          >
            <Typography
              component="time"
              variant="body2"
              color={isNext ? 'text.primary' : 'text.secondary'}
              fontWeight={isNext ? 600 : 400}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {timeLabel}
            </Typography>
            <Typography
              variant="body2"
              color={isNext ? 'text.primary' : 'text.secondary'}
              fontWeight={isNext ? 600 : 400}
            >
              {item.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
