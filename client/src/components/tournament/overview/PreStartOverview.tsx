/**
 * The Overview before a tournament starts (the drafts' "Before it starts"
 * board): the key dates as tiles, the status hero for where the viewer stands
 * (sign up, signed up with what to fix, check-in, or shuffle join), the
 * schedule as a list with Add to calendar, how matches are played, the map
 * pool and the teams by rating.
 */
import { useMemo, type ReactNode } from 'react';
import { fmtDayTime, fmtLongDay, fmtTime, fmtWeekdayTime } from '../../../utils/time';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import { layoutSchedule, scheduleToIcs } from '../../../utils/scheduleCalendar';
import { tournamentTabPath } from '../../../paths';
import { tokens, fontDisplay, mono, radii, textSize } from '../../../theme/tokens';
import { StartCountdown } from '../StartCountdown';
import { InfoTile, MapTile, SectionTitle, StatusHero, TeamLogo, panel } from '../ui/draftUi';
import type { useTournamentSignup } from '../../../hooks/useTournamentSignup';

const { color } = tokens;

type Signup = ReturnType<typeof useTournamentSignup>;

/** The facts row: when it starts, when sign-up closes, check-in, team spots. */
export function KeyDateTiles({
  tournament,
  signup,
}: {
  tournament: Tournament;
  signup: Signup['window'] | null;
}) {
  const { t } = useTranslation();
  const startsAt = tournament.settings?.startsAt ? new Date(tournament.settings.startsAt) : null;
  const firstScheduled = (tournament.settings?.schedule ?? [])
    .map((s) => new Date(s.at))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const start = startsAt ?? firstScheduled ?? null;
  const tiles: Array<{ key: string; label: string; value: ReactNode; note?: ReactNode }> = [];
  if (start)
    tiles.push({
      key: 'starts',
      label: t('overviewPage.keyDates.starts'),
      value: fmtDayTime(start),
    });
  if (signup?.registrationOpen && signup.registrationClosesAt) {
    tiles.push({
      key: 'signupCloses',
      label: t('signup.keyDates.closes'),
      value: fmtDayTime(signup.registrationClosesAt),
    });
  }
  if (signup?.checkInOpensAt && signup.checkInClosesAt) {
    tiles.push({
      key: 'checkIn',
      label: t('signup.keyDates.checkIn'),
      value: `${fmtTime(signup.checkInOpensAt)}–${fmtTime(signup.checkInClosesAt)}`,
      note: fmtDayTime(signup.checkInOpensAt).split(',')[0],
    });
  }
  if (tournament.type !== 'shuffle') {
    const max = signup?.maxTeams ?? null;
    const left = max !== null ? Math.max(max - tournament.teamIds.length, 0) : null;
    tiles.push({
      key: 'teams',
      label: max !== null ? t('signup.keyDates.spots') : t('overviewPage.keyDates.teams'),
      value:
        max !== null
          ? `${tournament.teamIds.length} ${t('signup.keyDates.of', { max })}`
          : String(tournament.teamIds.length),
      note:
        left !== null
          ? left > 0
            ? t('signup.keyDates.left', { count: left })
            : t('signup.keyDates.full')
          : undefined,
    });
  }
  if (tiles.length === 0) return null;
  return (
    <Box
      data-testid="overview-key-dates"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: 'repeat(auto-fit, minmax(12rem, 1fr))',
        },
        gap: 1.5,
        '& > :first-of-type:nth-last-of-type(odd)': { gridColumn: { xs: '1 / -1', sm: 'auto' } },
      }}
    >
      {tiles.map((tile) => (
        <Box key={tile.key} data-testid={`overview-key-${tile.key}`}>
          <InfoTile label={tile.label} value={tile.value} note={tile.note} />
        </Box>
      ))}
    </Box>
  );
}

/** The hero for a viewer who is not signed up: sign up, what it takes, when it starts. */
export function SignUpHero({
  tournament,
  signup,
  canSignUp,
  hasSteam,
  onRoster,
}: {
  tournament: Tournament;
  signup: Signup['window'] | null;
  canSignUp: boolean;
  hasSteam: boolean;
  onRoster: boolean;
}) {
  const { t } = useTranslation();
  const startsAt = tournament.settings?.startsAt
    ? new Date(tournament.settings.startsAt).getTime()
    : null;
  const max = signup?.maxTeams ?? null;
  const left = max !== null ? Math.max(max - tournament.teamIds.length, 0) : null;
  const open = !!signup?.registrationOpen;
  const req = [
    {
      ok: hasSteam,
      text: hasSteam
        ? t('overviewPage.requirements.steamLinkedOk')
        : t('overviewPage.requirements.steamLinkedNeutral'),
    },
    {
      ok: onRoster,
      text: onRoster
        ? t('overviewPage.requirements.onRosterOk')
        : t('overviewPage.requirements.onRosterNeutral'),
    },
  ];
  return (
    <StatusHero
      eyebrow={
        open
          ? signup?.registrationClosesAt
            ? t('preStart.openCloses', { when: fmtWeekdayTime(signup.registrationClosesAt) })
            : t('preStart.open')
          : t('preStart.closed')
      }
      eyebrowColor={open ? color.accent : color.muted}
      ring={canSignUp ? color.accent : color.rule}
      title={
        canSignUp
          ? t('signup.cta')
          : open && left === 0
            ? t('preStart.fullTitle')
            : t('preStart.notOpenTitle')
      }
      body={
        left !== null && left > 0
          ? t('preStart.spotsLeft', { count: left, max })
          : t('preStart.byOrganizer')
      }
      side={
        <>
          {startsAt && (
            <InfoTile
              label={t('preStart.startsIn')}
              value={<StartCountdown at={startsAt} color={color.ink} />}
              note={fmtDayTime(startsAt)}
            />
          )}
          {canSignUp && (
            <Button
              component={RouterLink}
              to={tournamentTabPath(tournament.id, 'signup')}
              variant="contained"
              data-testid="overview-sign-up"
              sx={{
                minHeight: 56,
                borderRadius: radii.pill,
                fontWeight: 700,
                fontSize: '1.0625rem',
              }}
            >
              {t('signup.cta')}
            </Button>
          )}
        </>
      }
    >
      <Box
        component="ul"
        aria-label={t('overviewPage.requirements.title')}
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {req.map((r) => (
          <Box
            component="li"
            key={r.text}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: '0.9375rem' }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: r.ok ? color.live : color.rule,
                color: color.accentInk,
                fontWeight: 700,
                fontSize: textSize.sm,
              }}
            >
              {r.ok ? '✓' : '·'}
            </Box>
            <Box component="span" sx={{ color: r.ok ? color.ink : color.ink2 }}>
              {r.text}
            </Box>
          </Box>
        ))}
      </Box>
    </StatusHero>
  );
}

/** The schedule as a list (time, what, where), with Add to calendar. */
export function ScheduleList({
  tournament,
  schedule,
}: {
  tournament: Tournament;
  schedule: Array<{ at: string; label: string; end?: string }>;
}) {
  const { t } = useTranslation();
  const layout = useMemo(() => layoutSchedule(schedule), [schedule]);
  const ics = useMemo(
    () =>
      layout
        ? `data:text/calendar;charset=utf-8,${encodeURIComponent(scheduleToIcs(tournament.name, layout, `t${tournament.id}`))}`
        : null,
    [layout, tournament.name, tournament.id]
  );
  const sorted = [...schedule].sort((a, b) => a.at.localeCompare(b.at));
  if (sorted.length === 0) {
    return (
      <Box
        component="section"
        aria-labelledby="overview-schedule-empty-title"
        data-testid="overview-schedule-empty"
        sx={{ ...panel, flex: '999 1 520px' }}
      >
        <SectionTitle id="overview-schedule-empty-title" title={t('overviewPage.schedule')} />
        <Typography sx={{ color: color.muted }}>{t('overviewPage.scheduleSoon')}</Typography>
      </Box>
    );
  }
  const days = new Set(sorted.map((s) => new Date(s.at).toDateString()));
  return (
    <Box
      component="section"
      aria-labelledby="overview-schedule-title"
      data-testid="overview-schedule"
      sx={{ ...panel, flex: '999 1 520px' }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <SectionTitle id="overview-schedule-title" title={t('overviewPage.schedule')} />
        {ics && (
          <Button
            component="a"
            href={ics}
            download={`${tournament.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'schedule'}.ics`}
            variant="outlined"
            sx={{ minHeight: 40, borderRadius: radii.pill }}
          >
            {t('overviewPage.addToCalendar')}
          </Button>
        )}
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {sorted.map((s) => (
          <Box
            component="li"
            key={`${s.at}-${s.label}`}
            data-testid="schedule-event"
            sx={{
              display: 'grid',
              gridTemplateColumns: '92px minmax(0,1fr)',
              gap: 1.5,
              alignItems: 'baseline',
              py: 1.5,
              borderTop: `1px solid ${color.rule}`,
            }}
          >
            <Typography
              component="span"
              sx={{ ...mono, fontSize: '1.125rem', whiteSpace: 'nowrap' }}
            >
              {fmtTime(s.at)}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
              <Typography component="span" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
              {(days.size > 1 || s.end) && (
                <Typography component="span" sx={{ fontSize: textSize.sm, color: color.muted }}>
                  {[days.size > 1 ? fmtLongDay(s.at) : null, s.end ? `– ${fmtTime(s.end)}` : null]
                    .filter(Boolean)
                    .join(' ')}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** The map pool as picture tiles (the drafts), every map named. */
export function MapPoolTiles({ maps }: { maps: string[] }) {
  const { t } = useTranslation();
  if (maps.length === 0) {
    return (
      <Box
        data-testid="overview-map-pool-empty"
        sx={{ ...panel, border: `1px dashed ${color.rule}`, bgcolor: 'transparent' }}
      >
        <SectionTitle title={t('overviewPage.mapPoolSoonTitle')} />
        <Typography sx={{ color: color.muted }}>{t('overviewPage.mapPoolSoon')}</Typography>
      </Box>
    );
  }
  return (
    <Box
      component="section"
      aria-labelledby="overview-map-pool-title"
      data-testid="overview-map-pool"
      sx={panel}
    >
      <SectionTitle
        id="overview-map-pool-title"
        title={t('overviewPage.mapPoolCount', { count: maps.length })}
        note={t('overviewPage.mapPoolNote')}
      />
      {/* Even rows, no map alone on the last one: 7 maps are 4 + 3, phones 2 a row. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: `repeat(${Math.min(maps.length, maps.length <= 5 ? maps.length : Math.ceil(maps.length / Math.ceil(maps.length / 5)))}, minmax(0, 1fr))`,
          },
          gap: 1,
        }}
      >
        {maps.map((m) => (
          <MapTile key={m} map={m} aspect="16 / 9" />
        ))}
      </Box>
    </Box>
  );
}

/** The teams entered so far, by rating, with the viewer's team marked. */
export function TeamsByRating({
  teams,
  registrations,
  viewerTeamId,
  to,
}: {
  teams: Array<{ id: string; name: string; tag?: string }>;
  registrations: Array<{ teamId: string; teamName?: string; rating?: number | null }>;
  viewerTeamId: string | null;
  to: string;
}) {
  const { t } = useTranslation();
  const rating = new Map(registrations.map((r) => [r.teamId, r.rating ?? null]));
  const rows = teams
    .map((tm) => ({ ...tm, rating: rating.get(tm.id) ?? null }))
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  if (rows.length === 0) return null;
  const mine = rows.findIndex((r) => r.id === viewerTeamId);
  return (
    <Box
      component="section"
      aria-labelledby="overview-teams-title"
      data-testid="overview-teams"
      sx={{ ...panel, flex: '1 1 100%' }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <SectionTitle
          id="overview-teams-title"
          title={
            rows.some((r) => r.rating !== null)
              ? t('signup.ladder.title')
              : t('overviewPage.facts.teams')
          }
        />
        <Typography sx={{ fontSize: textSize.sm, color: mine >= 0 ? color.accent : color.ink2 }}>
          {mine >= 0
            ? t('signup.ladder.yourPlace', { place: mine + 1, count: rows.length })
            : t('overviewPage.facts.teamsValue', { count: rows.length })}
        </Typography>
      </Box>
      <Box
        component="ol"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}
      >
        {rows.map((r, i) => (
          <Box
            component="li"
            key={r.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(0,1fr) auto',
              gap: 1.5,
              alignItems: 'center',
              px: 1.5,
              py: 1,
              borderRadius: radii.sm,
              bgcolor: r.id === viewerTeamId ? color.paper3 : 'transparent',
            }}
          >
            <Typography component="span" sx={{ ...mono, color: color.muted }}>
              {i + 1}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <TeamLogo team={r} size="sm" />
              <Typography
                component="span"
                sx={{ fontWeight: r.id === viewerTeamId ? 700 : 500, overflowWrap: 'anywhere' }}
              >
                {r.name}
              </Typography>
            </Box>
            <Typography component="span" sx={{ ...mono, fontSize: textSize.sm, color: color.ink2 }}>
              {r.rating ?? ''}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box
        component={RouterLink}
        to={to}
        sx={{ alignSelf: 'flex-end', fontSize: '0.875rem', color: color.accent }}
      >
        {t('overviewPage.tabs.teams')}
      </Box>
    </Box>
  );
}

export function HowMatchesPlayed({
  tournament,
  rulesView,
}: {
  tournament: Tournament;
  rulesView: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="section"
      aria-labelledby="overview-how-title"
      data-testid="overview-rules-line"
      sx={{ ...panel, flex: '1 1 300px' }}
    >
      <SectionTitle id="overview-how-title" title={t('overviewPage.howItsPlayed')} />
      <Box sx={{ color: color.ink2, fontSize: '0.9375rem' }}>{rulesView}</Box>
      <Box
        component={RouterLink}
        to={tournamentTabPath(tournament.id, 'rules')}
        sx={{ fontSize: '0.875rem', color: color.accent, fontFamily: fontDisplay }}
      >
        {t('preStart.allRules')}
      </Box>
    </Box>
  );
}
