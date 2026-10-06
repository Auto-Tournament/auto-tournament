import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Typography } from '@mui/material';
import { ColumnsIcon, TreeStructureIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import { GameMark } from '../../common/GameMark';
import { useSetupGames } from '../setup/games';
import { MATCH_FORMATS } from '../../../constants/tournament';
import { paths, tournamentTabPath, type TournamentTab } from '../../../paths';
import { tokens, textSize, fontDisplay, mono, radii, withAlpha } from '../../../theme/tokens';

const { color } = tokens;

interface TournamentPageHeaderProps {
  tournament: Tournament;
  tab: TournamentTab;
  /** The tabs this tournament shows, in order. */
  tabs: readonly TournamentTab[];
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

/** A small rounded tag in the hero card: game, format, series. */
function HeroPill({ icon, children, testId }: { icon?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        px: '11px',
        py: '5px',
        borderRadius: radii.pill,
        bgcolor: color.paper3,
        color: color.ink2,
        fontSize: textSize.sm,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

/**
 * The game the tournament is for: the module's own tile when it ships one,
 * a text mark otherwise, and the game's name.
 */
function GamePill({ game }: { game: string | undefined }) {
  const { games } = useSetupGames();
  const gameId = game || 'cs2';
  const known = games.find((entry) => entry.id === gameId);
  const name = known?.name ?? gameId;

  return (
    <HeroPill
      testId="tournament-game"
      icon={
        known?.icon ? (
          <Box
            component="img"
            src={known.icon}
            alt=""
            aria-hidden
            sx={{ width: 16, height: 16, borderRadius: '4px', display: 'block' }}
          />
        ) : (
          <GameMark name={name} slug={gameId} size={16} />
        )
      }
    >
      {name}
    </HeroPill>
  );
}

/** The banner as the background, or the plain page colour without one. */
function bannerSx(tournament: Tournament) {
  return tournament.bannerUrl
    ? {
        backgroundImage: `url("${tournament.bannerUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center 40%',
      }
    : { bgcolor: color.paper2 };
}

const tabLinkSx = {
  position: 'relative',
  py: 2,
  color: color.ink2,
  fontSize: textSize.md,
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
 * The top of the tournament page. Before and after the tournament runs: the
 * banner wide across the page with a dark card on it (game, format and series
 * pills, the H1, the organizer's description). While it runs the banner closes
 * to a strip with the name and a live mark, so the match gets the room. The
 * tabs sit under either.
 */
export function TournamentPageHeader({ tournament, tab, tabs, showManage }: TournamentPageHeaderProps) {
  const { t } = useTranslation();
  const isLive = tournament.status === 'in_progress';
  const description = tournament.settings?.description?.trim();

  const typeLabelKey = `tournament.typeSelector.types.${tournament.type}.label`;
  const typeLabel = t(typeLabelKey) === typeLabelKey ? tournament.type : t(typeLabelKey);
  const seriesLabel = MATCH_FORMATS.find((f) => f.value === tournament.format)?.label;

  return (
    <Box component="header" data-testid="tournament-header">
      <Box
        data-testid="tournament-hero"
        data-has-banner={tournament.bannerUrl ? 'true' : 'false'}
        sx={{
          ...bannerSx(tournament),
          height: isLive ? { xs: 96, md: 120 } : { xs: 320, md: 400 },
          display: 'flex',
          alignItems: isLive ? 'stretch' : 'flex-end',
          transition: `height ${tokens.duration.slow}ms ${tokens.ease.inOut}`,
        }}
      >
        {isLive ? (
          <Box sx={{ flex: 1, bgcolor: withAlpha(color.paper, 0.82), display: 'flex', alignItems: 'center' }}>
            <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              <Typography
                id="tournament-title"
                component="h1"
                sx={{
                  fontFamily: fontDisplay,
                  fontSize: { xs: '1.5rem', md: '1.875rem' },
                  fontWeight: 700,
                  m: 0,
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                }}
              >
                {tournament.name}
              </Typography>
              <Box
                component="span"
                data-testid="tournament-status"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  px: '10px',
                  py: '4px',
                  borderRadius: radii.pill,
                  bgcolor: withAlpha(color.live, 0.15),
                  color: color.live,
                  fontSize: textSize.xs,
                  whiteSpace: 'nowrap',
                  ...mono,
                }}
              >
                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color.live }} />
                {t('overviewPage.status.inProgress').toUpperCase()}
              </Box>
            </Container>
          </Box>
        ) : (
          <Container maxWidth="lg" sx={{ pb: { xs: 2, md: 4 } }}>
            <Box
              sx={{
                maxWidth: 760,
                p: { xs: '18px 20px', md: '24px 28px' },
                borderRadius: radii.lg,
                bgcolor: withAlpha(color.paper, 0.82),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <GamePill game={tournament.game} />
                <HeroPill icon={<TreeStructureIcon size={14} />}>{typeLabel}</HeroPill>
                {seriesLabel && tournament.type !== 'shuffle' && (
                  <HeroPill icon={<ColumnsIcon size={14} />}>{seriesLabel}</HeroPill>
                )}
              </Box>
              <Typography
                id="tournament-title"
                component="h1"
                sx={{
                  m: 0,
                  fontFamily: fontDisplay,
                  fontSize: { xs: '2.25rem', md: '3.25rem' },
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.02,
                  overflowWrap: 'anywhere',
                }}
              >
                {tournament.name}
              </Typography>
              {description && (
                <Typography
                  data-testid="overview-about"
                  sx={{
                    color: color.ink2,
                    fontSize: textSize.md,
                    whiteSpace: 'pre-wrap',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {description}
                </Typography>
              )}
            </Box>
          </Container>
        )}
      </Box>

      <Box sx={{ borderBottom: `1px solid ${color.rule}` }}>
        <Container maxWidth="lg">
          <Box
            component="nav"
            aria-label={t('overviewPage.tabs.label')}
            data-testid="tournament-tabs"
            sx={{ display: 'flex', gap: 3.5, overflowX: 'auto', scrollbarWidth: 'none' }}
          >
            {tabs.map((key) => (
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
        </Container>
      </Box>
    </Box>
  );
}
