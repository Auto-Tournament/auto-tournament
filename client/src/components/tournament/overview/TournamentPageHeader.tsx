import { tournamentArtSx, tournamentArtUrl } from '../../../utils/tournamentArt';
import { fmtDate, fmtDayTime, fmtTime } from '../../../utils/time';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Typography } from '@mui/material';
import { ColumnsIcon, TreeStructureIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTournamentPause } from '../../../hooks/useTournamentPause';
import type { Tournament } from '../../../types';
import { GameMark } from '../../common/GameMark';
import { StartCountdown } from '../StartCountdown';
import { useSetupGames } from '../setup/games';
import { seriesLabel, typeLabel } from '../../../utils/tournamentSummary';
import { manageTournamentPath, tournamentTabPath, type TournamentTab } from '../../../paths';
import { tokens, textSize, fontDisplay, radii, withAlpha } from '../../../theme/tokens';

const { color } = tokens;

interface TournamentPageHeaderProps {
  tournament: Tournament;
  /** Core's tab, or a module tab's path. */
  tab: string;
  /** The tabs this tournament shows, in order. */
  tabs: readonly TournamentTab[];
  /** Modules' tabs after core's (CS2: Highlights): the path under the tournament and the label. */
  moduleTabs?: ReadonlyArray<{ path: string; label: string }>;
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
  const startsAt = tournament.settings?.startsAt
    ? new Date(tournament.settings.startsAt).getTime()
    : NaN;
  if (Number.isFinite(startsAt) && !tournament.started_at) {
    // The organizer's start time (with its countdown below the title).
    start = startsAt;
    end = scheduled.length > 0 ? Math.max(startsAt, scheduled[scheduled.length - 1]) : null;
  } else if (scheduled.length > 0) {
    start = scheduled[0];
    end = scheduled[scheduled.length - 1];
  } else if (tournament.started_at) {
    start = tournament.started_at * 1000;
    end = tournament.completed_at ? tournament.completed_at * 1000 : null;
  }
  if (start === null) return null;

  if (end === null || end === start) return fmtDayTime(start, language);

  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const endLabel = sameDay ? fmtTime(end, language) : fmtDayTime(end, language);
  return `${fmtDayTime(start, language)} – ${endLabel}`;
}

/** A small rounded tag in the hero card: game, format, series. */
function HeroPill({
  icon,
  children,
  testId,
}: {
  icon?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
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

/** The banner (or the picked map) as the background, or the plain page colour without one. */
function bannerSx(tournament: Tournament) {
  return tournamentArtSx(tournament, { fallback: false });
}

const tabLinkSx = {
  px: 2,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: radii.pill,
  color: color.ink2,
  fontSize: '0.875rem',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  flex: 'none',
  '&:hover': { color: color.ink, bgcolor: color.paper3 },
  '&[aria-current="page"]': { color: color.ink, bgcolor: color.paper3, fontWeight: 600 },
  '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
} as const;

/**
 * The top of the tournament page, the same before, during and after it runs:
 * the banner wide across the page with a dark card on it (status, game,
 * format and series pills, the H1, the organizer's description), the tabs on it.
 */
export function TournamentPageHeader({
  tournament,
  tab,
  tabs,
  moduleTabs = [],
  showManage,
}: TournamentPageHeaderProps) {
  const { t } = useTranslation();
  const isLive = tournament.status === 'in_progress';
  const paused = !!useTournamentPause(tournament.id, isLive)?.pausedAt;
  const description = tournament.settings?.description?.trim();

  const typeName = typeLabel(t, tournament.type);
  const seriesName = seriesLabel(tournament.format);

  let statusLabel = t('overviewPage.status.setup');
  if (isLive) {
    statusLabel = paused ? t('runState.pausedShort') : t('overviewPage.status.inProgress');
  } else if (tournament.status === 'completed') {
    statusLabel = tournament.completed_at
      ? t('overviewPage.status.finishedOn', { date: fmtDate(tournament.completed_at) })
      : t('overviewPage.status.completed');
  }

  const tabsRow = (
    <Box
      component="nav"
      aria-label={t('overviewPage.tabs.label')}
      data-testid="tournament-tabs"
      sx={{
        display: 'flex',
        gap: 0.5,
        flexWrap: { xs: 'nowrap', sm: 'wrap' },
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      {tabs
        .filter((key) => key !== 'rules')
        .map((key) => (
          <Box
            key={key}
            component={RouterLink}
            to={tournamentTabPath(tournament.id, key)}
            aria-current={key === tab ? 'page' : undefined}
            data-testid={`tournament-tab-${key}`}
            sx={tabLinkSx}
          >
            {key === 'overview' && tournament.status === 'completed'
              ? t('overviewPage.tabs.results')
              : t(`overviewPage.tabs.${key}`)}
          </Box>
        ))}
      {moduleTabs.map(({ path, label }) => (
        <Box
          key={path}
          component={RouterLink}
          to={`${tournamentTabPath(tournament.id)}/${path}`}
          aria-current={path === tab ? 'page' : undefined}
          data-testid={`tournament-tab-${path}`}
          sx={tabLinkSx}
        >
          {label}
        </Box>
      ))}
      {/* Rules last, after the modules' tabs (the drafts' fixed order). */}
      {tabs.includes('rules') && (
        <Box
          component={RouterLink}
          to={tournamentTabPath(tournament.id, 'rules')}
          aria-current={tab === 'rules' ? 'page' : undefined}
          data-testid="tournament-tab-rules"
          sx={tabLinkSx}
        >
          {t('overviewPage.tabs.rules')}
        </Box>
      )}
      {showManage && (
        <Box
          component={RouterLink}
          to={manageTournamentPath(tournament.id)}
          data-testid="tournament-tab-manage-pill"
          sx={tabLinkSx}
        >
          {t('overviewPage.tabs.manage')}
        </Box>
      )}
    </Box>
  );

  return (
    <Box component="header" data-testid="tournament-header">
      {showManage && (
        // The IA boards: this page is what players see; running it is in Manage.
        <Container maxWidth="lg" sx={{ pt: 2 }}>
          <Box
            data-testid="tournament-admin-banner"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 1.5,
              px: 2,
              py: 1.5,
              borderRadius: radii.md,
              bgcolor: color.paper3,
              border: `1px solid ${color.rule}`,
            }}
          >
            <Typography sx={{ fontSize: textSize.md, color: color.ink2 }}>
              {t('overviewPage.adminBanner')}
            </Typography>
            <Box
              component={RouterLink}
              to={manageTournamentPath(tournament.id)}
              data-testid="tournament-tab-manage"
              sx={{
                px: 2,
                minHeight: 36,
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: radii.pill,
                border: `2px solid ${color.rule}`,
                color: color.ink,
                fontSize: textSize.md,
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: color.paper2 },
              }}
            >
              {t('overviewPage.manageTournament')}
            </Box>
          </Box>
        </Container>
      )}
      {/* Every state the same (board "Before it starts"): the banner, the status,
          game and format pills, the name, the organizer's description, the tabs. */}
      <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 4 } }}>
        <Box
          data-testid="tournament-hero"
          data-has-banner={tournament.bannerUrl ? 'true' : 'false'}
          sx={{
            ...bannerSx(tournament),
            position: 'relative',
            overflow: 'hidden',
            borderRadius: radii.lg,
            minHeight: 220,
          }}
        >
          <Box
            sx={{
              position: 'relative',
              minHeight: 220,
              p: { xs: 2.5, md: 3.5 },
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: 2.5,
              background: tournamentArtUrl(tournament, { fallback: false })
                ? // Dark behind the title, so it reads over any picture (a banner may carry its
                  // own text); the art shows on the right.
                  `linear-gradient(to right, ${withAlpha(color.paper, 0.95)} 0%, ${withAlpha(color.paper, 0.9)} 50%, ${withAlpha(color.paper, 0.3)} 100%), linear-gradient(to top, ${withAlpha(color.paper, 0.85)}, ${withAlpha(color.paper, 0)} 70%)`
                : 'none',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                maxWidth: '62ch',
                minWidth: 0,
              }}
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Box
                  component="span"
                  data-testid="tournament-status"
                  sx={{
                    px: 1.5,
                    py: 0.5,
                    borderRadius: radii.pill,
                    bgcolor: color.ink,
                    color: color.accentInk,
                    fontSize: textSize.sm,
                    fontWeight: 600,
                  }}
                >
                  {statusLabel}
                </Box>
                <GamePill game={tournament.game} />
                <HeroPill icon={<TreeStructureIcon size={14} />}>{typeName}</HeroPill>
                {seriesName && tournament.type !== 'shuffle' && (
                  <HeroPill icon={<ColumnsIcon size={14} />}>{seriesName}</HeroPill>
                )}
                {tournament.type === 'shuffle' && tournament.teamSize ? (
                  <HeroPill icon={<ColumnsIcon size={14} />}>
                    {`${tournament.teamSize}v${tournament.teamSize}`}
                  </HeroPill>
                ) : null}
              </Box>
              <Typography
                id="tournament-title"
                component="h1"
                sx={{
                  m: 0,
                  fontFamily: fontDisplay,
                  fontSize: { xs: '1.75rem', md: '2.125rem' },
                  fontWeight: 700,
                  lineHeight: 1.15,
                  overflowWrap: 'anywhere',
                }}
              >
                {tournament.name}
              </Typography>
              {tournament.settings?.startsAt && !tournament.started_at && (
                <Typography sx={{ fontSize: textSize.md }} data-testid="tournament-starts">
                  <StartCountdown
                    at={new Date(tournament.settings.startsAt).getTime()}
                    color={color.accent}
                  />
                </Typography>
              )}
              {description && (
                <Typography
                  data-testid="overview-about"
                  sx={{
                    color: color.ink2,
                    fontSize: '1rem',
                    lineHeight: 1.55,
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
            {tabsRow}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
