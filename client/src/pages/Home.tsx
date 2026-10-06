import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, Container, Link, Typography } from '@mui/material';
import { CalendarBlankIcon, CalendarPlusIcon, PlayCircleIcon, TrophyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { LiveChip } from '../components/common/ui';
import { useAuth } from '../contexts/AuthContext';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentList, type TournamentSummary } from '../hooks/useTournamentList';
import { usePublicTournamentOverview } from '../hooks/usePublicTournamentOverview';
import { useMatchmaking } from '../components/matchmaking/matchmakingStore';
import { api } from '../utils/api';
import { eliminationRoundCount, getRoundLabel } from '../utils/matchUtils';
import { formatBadge } from '../utils/tournamentSummary';
import { paths, tournamentTabPath } from '../paths';
import { tokens, radii, fontDisplay, fontMono } from '../theme/tokens';
import { getMapImageUrl } from '../constants/maps';

const { color } = tokens;

interface ViewerTeam {
  id: string;
  name: string;
  tag?: string;
}

/**
 * Same "connect" URI as the match panel (`integrations/cs2/match/MatchServerPanel.tsx`).
 * steam://connect joins a CS2 that is already running; steam://run/730 only
 * passed its arguments when it started the game.
 */
function steamConnectUri(server: { host: string; ip?: string | null; port: number; password?: string }): string {
  // The IP when known: CS2 ignores steam://connect with a hostname.
  const address = `${server.ip || server.host}:${server.port}`;
  return server.password
    ? `steam://connect/${address}/${encodeURIComponent(server.password)}`
    : `steam://connect/${address}`;
}

const isUpcoming = (tour: TournamentSummary) => tour.status === 'setup' || tour.status === 'ready';

function SectionTitle({ id, title, aside, link }: { id: string; title: string; aside?: string; link?: { to: string; label: string } }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.75, flexWrap: 'wrap', mb: 2.25 }}>
      <Typography id={id} component="h2" sx={{ fontFamily: fontDisplay, fontSize: { xs: '1.375rem', md: '1.75rem' }, fontWeight: 600 }}>
        {title}
      </Typography>
      {aside && <Typography sx={{ color: color.muted }}>{aside}</Typography>}
      <Box sx={{ flex: 1 }} />
      {link && (
        <Link component={RouterLink} to={link.to} underline="hover" sx={{ color: color.ink2 }}>
          {link.label}
        </Link>
      )}
    </Box>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'scrim' | 'pick' }) {
  const styles = {
    accent: { bgcolor: color.accent, color: color.accentInk, fontWeight: 600 },
    pick: { bgcolor: color.paper3, color: color.pick },
    scrim: { bgcolor: 'rgba(16,9,8,0.84)', color: color.ink2 },
  }[tone ?? 'scrim'];
  return (
    <Box component="span" sx={{ px: 1.375, py: 0.625, borderRadius: radii.pill, fontSize: '0.8125rem', ...styles }}>
      {children}
    </Box>
  );
}

function Progress({ value, max, tone = color.accent }: { value: number; max?: number | null; tone?: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: color.rule, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: tone }} />
      </Box>
      <Box component="span" sx={{ fontFamily: fontMono, fontSize: '0.8125rem', color: color.ink2 }}>
        {max ? `${value} / ${max}` : value}
      </Box>
    </Box>
  );
}

/**
 * Home ("/"), the front page drafts' boards 1, 2 and 1m: your next match,
 * the tournaments live now (the featured one big), the ones taking sign-ups,
 * a way into matchmaking, and the latest champions. With nothing live, the
 * featured upcoming tournament takes the big card and the last finished one
 * shows its podium. Empty slots hold placeholders, so the layout is the same
 * on a new site as on a busy one; a tournament without a banner gets map art.
 */
export default function Home() {
  const { t, i18n } = useTranslation();
  const { playerSteamId, isAuthenticated: isAdmin } = useAuth();
  const [myTeam, setMyTeam] = useState<ViewerTeam | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);
  const { tournaments, loading: tournamentsLoading } = useTournamentList();
  const { available: matchmakingAvailable } = useMatchmaking();
  const { team: myTeamMatchTeam, match, hasMatch, loading: matchLoading } = useTeamMatchData(myTeam?.id ?? undefined);

  useEffect(() => {
    document.title = pageTitle(t('home.title'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!playerSteamId) {
        setMyTeam(null);
        setTeamLoading(false);
        return;
      }
      setTeamLoading(true);
      try {
        const res = await api.get<{ success: boolean; team: ViewerTeam | null }>(`/api/players/${playerSteamId}/team`);
        if (!cancelled) setMyTeam(res.team ?? null);
      } catch {
        if (!cancelled) setMyTeam(null);
      } finally {
        if (!cancelled) setTeamLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [playerSteamId]);

  const shown = useMemo(() => tournaments.filter((tour) => !tour.archived), [tournaments]);
  const live = useMemo(
    () => shown.filter((tour) => tour.isLive).sort((a, b) => Number(b.featured) - Number(a.featured)),
    [shown]
  );
  const upcoming = useMemo(
    () =>
      shown
        .filter(isUpcoming)
        .sort((a, b) => Number(b.featured) - Number(a.featured) || (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity)),
    [shown]
  );
  const finished = useMemo(
    () => tournaments.filter((tour) => tour.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [tournaments]
  );

  const showNextMatch = !!myTeam && hasMatch && !!match;
  const matchTournament = live[0] ?? null;
  const loading = tournamentsLoading || teamLoading || (!!myTeam && matchLoading);
  const quiet = live.length === 0;
  const hero = quiet ? upcoming[0] : live[0];
  const restUpcoming = quiet ? upcoming.slice(1) : upcoming;

  const when = (ms?: number) =>
    ms ? new Date(ms).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  // The page keeps one shape whatever is on (front page drafts, board 1):
  // the big card and its side column, three sign-up cards, three champions.
  // A slot with nothing to show holds a placeholder, so an empty site looks
  // like the same page waiting for its first tournament, not a blank one.
  const side = quiet ? restUpcoming.slice(0, 1) : [...live.slice(1, 2), ...(live.length < 2 ? restUpcoming.slice(0, 1) : [])];
  const signups = (quiet ? restUpcoming.slice(side.length) : restUpcoming.slice(live.length < 2 ? 1 : 0)).slice(0, 3);
  const champions = finished.slice(0, 3);

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="home-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 }, display: 'flex', flexDirection: 'column', gap: { xs: 4, md: 5.5 } }}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('home.loading')} />
          </Box>
        ) : (
          <>
            {showNextMatch && match && (
              <Box
                component="section"
                aria-labelledby="home-next-match-title"
                data-testid="home-next-match"
                sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'auto minmax(0, 1fr) auto' }, gap: { xs: 1.5, md: 3 }, alignItems: 'center', px: { xs: 2, md: 3 }, py: 2.5, borderRadius: radii.lg, bgcolor: 'rgba(255,106,61,0.14)', border: `1px solid ${color.accent}` }}
              >
                <Box>
                  <Typography id="home-next-match-title" sx={{ fontSize: '0.8125rem', color: color.accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('home.nextMatch')}
                  </Typography>
                  <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {myTeamMatchTeam?.name ?? myTeam?.name} {t('home.vs')} {match.opponent?.name ?? t('home.tbd')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', fontSize: '0.875rem', color: color.ink2 }}>
                  <Box component="span" sx={{ px: 1.5, py: 0.75, borderRadius: radii.pill, bgcolor: color.paper3 }}>
                    {[matchTournament?.name, getRoundLabel(match.round, matchTournament ? eliminationRoundCount(matchTournament.teamCount, matchTournament.type) : undefined), formatBadge(match.matchFormat)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Box>
                  {match.status === 'live' && <LiveChip label={t(`home.matchStatus.${match.status}`)} />}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button component={RouterLink} to={`/team/${myTeam?.id}`} variant="contained" data-testid="home-open-match">
                    {t('home.openMatch')}
                  </Button>
                  {match.server && (
                    <Button component="a" href={steamConnectUri(match.server)} variant="outlined" data-testid="home-connect-server">
                      {t('home.connectToServer')}
                    </Button>
                  )}
                </Box>
              </Box>
            )}

            <Box component="section" aria-labelledby="home-live-title">
              <SectionTitle
                id="home-live-title"
                title={quiet ? t('home.quiet.title') : t('home.live.title')}
                aside={quiet ? undefined : t('home.live.count', { count: live.length })}
                link={{ to: paths.browse, label: t('home.allTournaments') }}
              />
              <Box
                data-testid="home-tournaments-list"
                sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.65fr) minmax(0, 1fr)' }, gap: 2.5 }}
              >
                {hero ? (
                  <HeroCard tour={hero} when={when} />
                ) : (
                  <Box
                    data-testid="home-tournaments-empty"
                    sx={{ minHeight: { xs: 260, md: 440 }, borderRadius: '26px', overflow: 'hidden', display: 'flex', ...artSx(0) }}
                  >
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, p: { xs: 2.5, md: 3.5 }, background: SCRIM_GRADIENT }}>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Pill>{t('home.empty.soon')}</Pill>
                      </Box>
                      <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                        {t('home.empty.heroTitle')}
                      </Typography>
                      <Typography sx={{ color: color.ink2, maxWidth: 560 }}>{t('home.empty.heroHint')}</Typography>
                      {isAdmin && (
                        <Button component={RouterLink} to={paths.tournaments} variant="contained" sx={{ alignSelf: 'flex-start', mt: 1.5 }}>
                          {t('home.empty.create')}
                        </Button>
                      )}
                    </Box>
                  </Box>
                )}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {side[0] ? (
                    <SideCard tour={side[0]} when={when} />
                  ) : (
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, flex: 1, flexDirection: 'column' }}>
                      <Placeholder icon={<CalendarBlankIcon size={22} />} title={t('home.empty.nextTitle')} hint={t('home.empty.nextHint')} grow />
                    </Box>
                  )}
                  {matchmakingAvailable ? (
                    <Box
                      component={RouterLink}
                      to={paths.play}
                      data-testid="home-play"
                      sx={{ p: 2.75, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 1.75, '&:hover': { borderColor: color.muted } }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 44, height: 44, borderRadius: '12px', bgcolor: color.paper3, color: color.pick, display: 'grid', placeItems: 'center' }}>
                          <PlayCircleIcon size={22} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
                            {quiet ? t('home.play.quietTitle') : t('home.play.title')}
                          </Typography>
                          <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>{t('home.play.hint')}</Typography>
                        </Box>
                      </Box>
                      <Box component="span" sx={{ alignSelf: 'flex-start', px: 2.5, py: 1.25, borderRadius: radii.pill, bgcolor: quiet ? color.pick : color.paper3, color: quiet ? color.accentInk : color.ink, fontWeight: 600, fontSize: '0.875rem' }}>
                        {t('home.play.cta')}
                      </Box>
                    </Box>
                  ) : (
                    <Box
                      component={RouterLink}
                      to={paths.browsePlayers}
                      data-testid="home-browse"
                      sx={{ p: 2.75, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 1.75, '&:hover': { borderColor: color.muted } }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 44, height: 44, borderRadius: '12px', bgcolor: color.paper3, color: color.accent, display: 'grid', placeItems: 'center' }}>
                          <UsersThreeIcon size={22} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>{t('home.browse.title')}</Typography>
                          <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>{t('home.browse.hint')}</Typography>
                        </Box>
                      </Box>
                      <Box component="span" sx={{ alignSelf: 'flex-start', px: 2.5, py: 1.25, borderRadius: radii.pill, bgcolor: color.paper3, fontWeight: 600, fontSize: '0.875rem' }}>
                        {t('home.browse.cta')}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>

            <Box component="section" aria-labelledby="home-signup-title">
              <SectionTitle id="home-signup-title" title={t('home.signup.title')} aside={t('home.signup.aside')} link={{ to: paths.browse, label: t('home.allTournaments') }} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
                {signups.map((tour) => (
                  <Box key={tour.id} component={RouterLink} to={tournamentTabPath(tour.id)} data-testid={`home-pick-${tour.id}`} sx={{ borderRadius: radii.lg, overflow: 'hidden', bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'flex', flexDirection: 'column', '&:hover': { borderColor: color.muted } }}>
                    <Box sx={{ height: 120, ...artSx(tour.id, tour.bannerUrl) }} />
                    <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
                      <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>{tour.name}</Typography>
                      <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                        {[formatBadge(tour.format), when(tour.startsAt)].filter(Boolean).join(' · ')}
                      </Typography>
                      {tour.maxEntries ? <Progress value={tour.entries ?? 0} max={tour.maxEntries} /> : null}
                      <Box component="span" sx={{ mt: 'auto', alignSelf: 'flex-start', px: 2.25, py: 1.25, borderRadius: radii.pill, bgcolor: tour.registrationOpen ? color.accent : color.paper3, color: tour.registrationOpen ? color.accentInk : color.ink, fontWeight: 600, fontSize: '0.875rem' }}>
                        {tour.registrationOpen ? t('home.signup.cta') : t('home.signup.view')}
                      </Box>
                    </Box>
                  </Box>
                ))}
                {Array.from({ length: Math.max(0, 3 - signups.length) }, (_, i) => (
                  <Box key={`signup-slot-${i}`} sx={{ display: { xs: i === 0 && signups.length === 0 ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
                    <Placeholder
                      art={i + 1}
                      icon={<CalendarPlusIcon size={22} />}
                      title={i === 0 && signups.length === 0 ? t('home.empty.signupTitle') : t('home.empty.slotTitle')}
                      hint={i === 0 && signups.length === 0 ? t('home.empty.signupHint') : t('home.empty.slotHint')}
                      grow
                    />
                  </Box>
                ))}
              </Box>
            </Box>

            {quiet && finished[0] ? (
              <LastTime tournament={finished[0]} />
            ) : (
              <Box component="section" aria-labelledby="home-champions-title">
                <SectionTitle id="home-champions-title" title={t('home.champions.title')} aside={t('home.champions.aside')} link={{ to: paths.browse, label: t('home.champions.all') }} />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
                  {champions.map((tour) => (
                    <Box key={tour.id} component={RouterLink} to={tournamentTabPath(tour.id)} data-testid={`home-champion-${tour.id}`} sx={{ p: 2.25, borderRadius: '20px', bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 1.75, alignItems: 'center', '&:hover': { borderColor: color.muted } }}>
                      <Box sx={{ width: 48, height: 48, borderRadius: '14px', bgcolor: 'rgba(232,176,75,0.16)', color: color.medalGold, display: 'grid', placeItems: 'center' }}>
                        <TrophyIcon size={24} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }}>{tour.winner?.name ?? tour.name}</Typography>
                        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                          {tour.winner ? t('home.champions.won', { name: tour.name }) : t('home.champions.finished')}
                          {tour.completedAt ? ` · ${new Date(tour.completedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}` : ''}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                  {Array.from({ length: 3 - champions.length }, (_, i) => (
                    <Box
                      key={`champion-slot-${i}`}
                      sx={{ display: { xs: i === 0 && champions.length === 0 ? 'grid' : 'none', md: 'grid' }, p: 2.25, borderRadius: '20px', border: `1px dashed ${color.rule}`, gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 1.75, alignItems: 'center' }}
                    >
                      <Box sx={{ width: 48, height: 48, borderRadius: '14px', bgcolor: color.paper2, color: color.muted, display: 'grid', placeItems: 'center' }}>
                        <TrophyIcon size={24} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, color: color.ink2 }}>{t('home.empty.championTitle')}</Typography>
                        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('home.empty.championHint')}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Container>
    </Box>
  );
}

/** Map art for a tournament without a banner, picked by its id so it stays put. */
const FALLBACK_MAPS = ['de_ancient', 'de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_anubis', 'de_overpass'];
const SCRIM_GRADIENT = 'linear-gradient(to top, rgba(16,9,8,1) 18%, rgba(16,9,8,0.45) 70%, rgba(16,9,8,0.2))';

function artSx(seed: number, bannerUrl?: string | null) {
  const url = bannerUrl || getMapImageUrl(FALLBACK_MAPS[Math.abs(seed) % FALLBACK_MAPS.length]);
  return { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center 40%', bgcolor: color.paper3 };
}

type When = (ms?: number) => string | null;

/** The big card: the live (or next) tournament on its banner, else map art. */
function HeroCard({ tour, when }: { tour: TournamentSummary; when: When }) {
  const { t } = useTranslation();
  return (
    <Box
      component={RouterLink}
      to={tournamentTabPath(tour.id)}
      data-testid={`home-tournament-${tour.id}`}
      sx={{ minHeight: { xs: 260, md: 440 }, borderRadius: '26px', overflow: 'hidden', display: 'flex', color: color.ink, textDecoration: 'none', ...artSx(tour.id, tour.bannerUrl) }}
    >
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', p: { xs: 2.5, md: 3.5 }, background: SCRIM_GRADIENT }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.75 }}>
          {tour.isLive ? <LiveChip label={t('home.live.chip')} /> : tour.registrationOpen ? <Pill tone="accent">{t('home.signup.open')}</Pill> : null}
          <Pill>{t(`tournament.typeSelector.types.${tour.type}.label`)}</Pill>
          <Pill>{formatBadge(tour.format)}</Pill>
        </Box>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, overflowWrap: 'anywhere' }}>
          {tour.name}
        </Typography>
        {tour.description && (
          <Typography sx={{ mt: 1, color: color.ink2, maxWidth: 640, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {tour.description}
          </Typography>
        )}
        <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', color: color.ink2 }}>
          {tour.isLive
            ? [t('home.teams', { count: tour.teamCount }), tour.liveMatchCount ? t('home.live.matchesOn', { count: tour.liveMatchCount }) : null].filter(Boolean).join(' · ')
            : [when(tour.startsAt), tour.maxEntries ? `${tour.entries ?? 0} / ${tour.maxEntries}` : t('home.teams', { count: tour.teamCount })].filter(Boolean).join(' · ')}
          {!tour.isLive && (
            <Box component="span" sx={{ px: 2.5, py: 1.25, borderRadius: radii.pill, bgcolor: color.accent, color: color.accentInk, fontWeight: 600 }}>
              {tour.registrationOpen ? t('home.signup.cta') : t('home.signup.view')}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** The side column's tournament: another live one, or the next one up. */
function SideCard({ tour, when }: { tour: TournamentSummary; when: When }) {
  const { t } = useTranslation();
  return (
    <Box
      component={RouterLink}
      to={tournamentTabPath(tour.id)}
      data-testid={`home-tournament-${tour.id}`}
      sx={{ flex: 1, minHeight: 200, borderRadius: '26px', overflow: 'hidden', display: 'flex', color: color.ink, textDecoration: 'none', ...artSx(tour.id, tour.bannerUrl) }}
    >
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', p: 2.75, background: SCRIM_GRADIENT }}>
        <Box sx={{ mb: 1.25, display: 'flex', gap: 1 }}>
          {tour.isLive ? <LiveChip label={t('home.live.chip')} /> : <Pill tone={tour.registrationOpen ? 'accent' : undefined}>{tour.registrationOpen ? t('home.signup.open') : t('home.quiet.next')}</Pill>}
          <Pill>{formatBadge(tour.format)}</Pill>
        </Box>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.625rem', fontWeight: 700, overflowWrap: 'anywhere' }}>{tour.name}</Typography>
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {tour.isLive ? t('home.teams', { count: tour.teamCount }) : [when(tour.startsAt), t('home.teams', { count: tour.teamCount })].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
    </Box>
  );
}

/** A slot with nothing in it yet: dashed, quiet, the same size as what goes there. */
function Placeholder({ icon, title, hint, grow, art }: { icon: React.ReactNode; title: string; hint: string; grow?: boolean; art?: number }) {
  return (
    <Box
      sx={{
        flex: grow ? 1 : undefined,
        minHeight: 200,
        borderRadius: art !== undefined ? radii.lg : '26px',
        border: `1px dashed ${color.rule}`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {art !== undefined && <Box sx={{ height: 120, ...artSx(art), opacity: 0.25, filter: 'grayscale(1)' }} />}
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1, justifyContent: art !== undefined ? 'flex-start' : 'center', flex: 1 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: '12px', bgcolor: color.paper2, color: color.muted, display: 'grid', placeItems: 'center' }}>{icon}</Box>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.125rem', fontWeight: 600, color: color.ink2 }}>{title}</Typography>
        <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>{hint}</Typography>
      </Box>
    </Box>
  );
}

/** Between events: the last finished tournament's podium (board 2). */
function LastTime({ tournament }: { tournament: TournamentSummary }) {
  const { t, i18n } = useTranslation();
  const { teams } = usePublicTournamentOverview(String(tournament.id));
  const [first, second, third] = teams;
  const place = (team: { name: string } | null | undefined, label: string, height: number, tone: string, big = false) =>
    team ? (
      <Box sx={{ p: 2.5, height, boxSizing: 'border-box', borderRadius: '20px', bgcolor: big ? color.paper3 : color.paper2, border: `1px solid ${big ? tone : color.rule}`, borderTop: `4px solid ${tone}`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0.75 }}>
        <Typography sx={{ fontSize: '0.8125rem', color: tone, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: big ? '1.625rem' : '1.25rem', fontWeight: big ? 700 : 600 }}>{team.name}</Typography>
      </Box>
    ) : (
      <Box />
    );
  return (
    <Box component="section" aria-labelledby="home-last-title" data-testid="home-last-time">
      <SectionTitle
        id="home-last-title"
        title={t('home.lastTime.title')}
        aside={[tournament.name, tournament.completedAt ? new Date(tournament.completedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}
        link={{ to: tournamentTabPath(tournament.id), label: t('home.lastTime.results') }}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: 1.25, md: 2.5 }, alignItems: 'end' }}>
        {place(second, t('home.lastTime.second'), 120, color.medalSilver)}
        {place(first ?? tournament.winner, t('home.lastTime.champion'), 160, color.medalGold, true)}
        {place(third, t('home.lastTime.third'), 100, color.medalBronze)}
      </Box>
    </Box>
  );
}
