import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { FlagCheckeredIcon, PlayCircleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import { tokens, fontDisplay, radii } from '../../../theme/tokens';

const { color } = tokens;

interface Cell {
  key: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
}

/** First and last schedule rows as times, or when it started and finished. */
function startAndEnd(tournament: Tournament): { start: number | null; end: number | null } {
  const scheduled = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (scheduled.length > 0) {
    const end = scheduled[scheduled.length - 1];
    return { start: scheduled[0], end: end === scheduled[0] ? null : end };
  }
  return {
    start: tournament.started_at ? tournament.started_at * 1000 : null,
    end: tournament.completed_at ? tournament.completed_at * 1000 : null,
  };
}

/**
 * The bar under the tournament header with what you need at a glance: when it
 * starts, when the last item on the schedule is, and how many teams are in.
 * Each cell is an icon, a short label and one value; a cell without data is
 * left out, and the bar is left out when it would be empty.
 */
export function KeyDatesBar({ tournament, action }: { tournament: Tournament; action?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { start, end } = startAndEnd(tournament);
  const dayAndTime = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const cells: Cell[] = [];
  if (start !== null) {
    cells.push({
      key: 'starts',
      icon: <PlayCircleIcon size={22} color={color.accent} />,
      label: t('overviewPage.keyDates.starts'),
      value: dayAndTime.format(start),
    });
  }
  if (end !== null) {
    cells.push({
      key: 'ends',
      icon: <FlagCheckeredIcon size={22} color={color.muted} />,
      label: t('overviewPage.keyDates.lastOnSchedule'),
      value: dayAndTime.format(end),
    });
  }
  if (tournament.type !== 'shuffle') {
    cells.push({
      key: 'teams',
      icon: <UsersThreeIcon size={22} color={color.accent} />,
      label: t('overviewPage.keyDates.teams'),
      value: String(tournament.teamIds.length),
    });
  }
  if (cells.length === 0 && !action) return null;

  return (
    <Box
      data-testid="overview-key-dates"
      sx={{
        p: { xs: 2, md: '20px 24px' },
        borderRadius: radii.lg,
        bgcolor: color.paper2,
        border: `1px solid ${color.accent}`,
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: `repeat(${Math.max(cells.length, 1)}, minmax(0, 1fr))${action ? ' auto' : ''}`,
        },
        alignItems: 'center',
        gap: { xs: 2, sm: 2.5 },
      }}
    >
      {cells.map((cell, index) => (
        <Box
          key={cell.key}
          data-testid={`overview-key-${cell.key}`}
          sx={{
            display: 'flex',
            gap: 1.75,
            alignItems: 'center',
            minWidth: 0,
            ...(index > 0 && { pl: { sm: 2.75 }, borderLeft: { sm: `1px solid ${color.rule}` } }),
          }}
        >
          <Box sx={{ display: 'flex', flex: 'none' }} aria-hidden>
            {cell.icon}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{cell.label}</Typography>
            <Typography
              sx={{ fontFamily: fontDisplay, fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.25 }}
            >
              {cell.value}
            </Typography>
          </Box>
        </Box>
      ))}
      {action}
    </Box>
  );
}
