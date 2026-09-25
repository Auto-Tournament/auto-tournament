import { Link as RouterLink } from 'react-router-dom';
import { Box, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import { PageHead, LiveChip } from '../../common/ui';
import { GameMark } from '../../common/GameMark';
import { useSetupGames } from '../setup/games';
import { paths, TOURNAMENT_TABS, tournamentTabPath, type TournamentTab } from '../../../paths';
import { tokens, textSize } from '../../../theme/tokens';

const { color } = tokens;

interface TournamentPageHeaderProps {
  tournament: Tournament;
  tab: TournamentTab;
  /** Adds the Manage link on the right of the tabs. */
  showManage: boolean;
}

/**
 * "Sat 5 Apr, 14:00 – Sun 6 Apr, 20:00": the first and last schedule rows, or
 * when the tournament started and finished. Null when neither is known.
 */
export function tournamentDates(tournament: Tournament, language: string): string | null {
  const scheduled = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  let start: number | null = null;
  let end: number | null = null;
  if (scheduled.length > 0) {
    start = scheduled[0];
    end = scheduled[scheduled.length - 1];
  } else if (tournament.started_at) {
    start = tournament.started_at * 1000;
    end = tournament.completed_at ? tournament.completed_at * 1000 : null;
  }
  if (start === null) return null;

  const dayAndTime = new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (end === null || end === start) return dayAndTime.format(start);

  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const endLabel = sameDay
    ? new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(end)
    : dayAndTime.format(end);
  return `${dayAndTime.format(start)} – ${endLabel}`;
}

/**
 * The game the tournament is for: the module's own tile when it ships one,
 * a text mark otherwise, and the game's name (the drafts' `.game` badge).
 */
function GameBadge({ game }: { game: string | undefined }) {
  const { games } = useSetupGames();
  const gameId = game || 'cs2';
  const known = games.find((entry) => entry.id === gameId);
  const name = known?.name ?? gameId;

  return (
    <Box
      component="span"
      data-testid="tournament-game"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', whiteSpace: 'nowrap' }}
    >
      {known?.icon ? (
        <Box
          component="img"
          src={known.icon}
          alt=""
          aria-hidden
          sx={{ width: 24, height: 24, borderRadius: '6px', flex: 'none', display: 'block' }}
        />
      ) : (
        <GameMark name={name} slug={gameId} size={24} />
      )}
      {name}
    </Box>
  );
}

/** Status chip: live (green dot), upcoming or completed. */
function StatusChip({ status }: { status: Tournament['status'] }) {
  const { t } = useTranslation();
  if (status === 'in_progress') {
    return <LiveChip label={t('overviewPage.status.inProgress')} data-testid="tournament-status" />;
  }
  return (
    <Chip
      size="small"
      data-testid="tournament-status"
      label={
        status === 'completed' ? t('overviewPage.status.completed') : t('overviewPage.status.setup')
      }
    />
  );
}

const tabLinkSx = {
  position: 'relative',
  py: 1.5,
  color: color.ink2,
  fontSize: textSize.sm,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  '&:hover': { color: color.ink },
  '&[aria-current="page"]': { color: color.ink },
  '&[aria-current="page"]::after': {
    content: '""',
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '-1px',
    height: 2,
    bgcolor: color.accent,
  },
  '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 3 },
} as const;

/**
 * The top of the tournament page (the draft's `.t-head` and `.tabs`): game,
 * status, the page's H1, "organizer · dates · location", then the tabs.
 * Overview, Bracket, Matches, Teams and Standings are for everyone; Manage,
 * on the right, is for admins and opens the admin console.
 */
export function TournamentPageHeader({ tournament, tab, showManage }: TournamentPageHeaderProps) {
  const { t, i18n } = useTranslation();
  const settings = tournament.settings;
  const byline = [
    settings?.organizer?.trim(),
    tournamentDates(tournament, i18n.language),
    settings?.location?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box component="header">
      <PageHead
        titleId="tournament-title"
        title={tournament.name}
        eyebrow={
          <>
            <GameBadge game={tournament.game} />
            <StatusChip status={tournament.status} />
          </>
        }
        subtitle={byline || undefined}
        sx={{ mb: 0 }}
        data-testid="tournament-header"
      />

      <Box
        component="nav"
        aria-label={t('overviewPage.tabs.label')}
        data-testid="tournament-tabs"
        sx={{
          display: 'flex',
          gap: 3,
          mt: 4,
          borderBottom: `1px solid ${color.rule}`,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {TOURNAMENT_TABS.map((key) => (
          <Box
            key={key}
            component={RouterLink}
            to={tournamentTabPath(tournament.id, key)}
            aria-current={key === tab ? 'page' : undefined}
            data-testid={`tournament-tab-${key}`}
            sx={tabLinkSx}
          >
            {t(`overviewPage.tabs.${key}`)}
          </Box>
        ))}
        {showManage && (
          <Box
            component={RouterLink}
            to={paths.manage}
            data-testid="tournament-tab-manage"
            sx={[tabLinkSx, { ml: 'auto' }]}
          >
            {t('overviewPage.tabs.manage')}
          </Box>
        )}
      </Box>
    </Box>
  );
}
