import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, Container, Link, Typography } from '@mui/material';
import { PlayCircleIcon, TrophyIcon } from '@phosphor-icons/react';
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

/** A tournament's picture: its banner, else a plain panel. */
function bannerSx(tour: TournamentSummary) {
  return tour.bannerUrl
    ? { backgroundImage: `url(${tour.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center 40%' }
    : { bgcolor: color.paper2 };
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
 * shows its podium.
 */
export default function Home() {
  const { t, i18n } = useTranslation();
  const { playerSteamId } = useAuth();
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

  const playCard = matchmakingAvailable ? (
    <Box
      component={RouterLink}
      to={paths.play}
      data-testid="home-play"
      sx={{ p: 2.75, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 1.75, justifyContent: 'center', '&:hover': { borderColor: color.muted } }}
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
  ) : null;

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

            {hero ? (
              <Box component="section" aria-labelledby="home-live-title">
                <SectionTitle
                  id="home-live-title"
                  title={quiet ? t('home.quiet.title') : t('home.live.title')}
                  aside={quiet ? undefined : t('home.live.count', { count: live.length })}
                />
                <Box
                  data-testid="home-tournaments-list"
                  sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: quiet ? 'minmax(0, 1fr)' : 'minmax(0, 1.65fr) minmax(0, 1fr)' }, gap: 2.5 }}
                >
                  <Box
                    component={RouterLink}
                    to={tournamentTabPath(hero.id)}
                    data-testid={`home-tournament-${hero.id}`}
                    sx={{ minHeight: { xs: 260, md: quiet ? 400 : 460 }, borderRadius: '26px', overflow: 'hidden', display: 'flex', color: color.ink, textDecoration: 'none', ...bannerSx(hero) }}
                  >
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', p: { xs: 2.5, md: 3.5 }, background: hero.bannerUrl ? 'linear-gradient(to top, rgba(16,9,8,1) 18%, rgba(16,9,8,0.35) 70%, rgba(16,9,8,0.1))' : undefined }}>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.75 }}>
                        {hero.isLive ? <LiveChip label={t('home.live.chip')} /> : hero.registrationOpen ? <Pill tone="accent">{t('home.signup.open')}</Pill> : null}
                        <Pill>{t(`tournament.typeSelector.types.${hero.type}.label`)}</Pill>
                        <Pill>{formatBadge(hero.format)}</Pill>
                      </Box>
                      <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '2rem', md: quiet ? '3.25rem' : '2.75rem' }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.04 }}>
                        {hero.name}
                      </Typography>
                      {hero.description && (
                        <Typography sx={{ mt: 1, color: color.ink2, maxWidth: 640, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {hero.description}
                        </Typography>
                      )}
                      <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', color: color.ink2 }}>
                        {hero.isLive
                          ? t('home.teams', { count: hero.teamCount })
                          : [when(hero.startsAt), hero.maxEntries ? `${hero.entries ?? 0} / ${hero.maxEntries}` : t('home.teams', { count: hero.teamCount })].filter(Boolean).join(' · ')}
                        {!hero.isLive && (
                          <Box component="span" sx={{ px: 2.5, py: 1.25, borderRadius: radii.pill, bgcolor: color.accent, color: color.accentInk, fontWeight: 600 }}>
                            {hero.registrationOpen ? t('home.signup.cta') : t('home.signup.view')}
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </Box>

                  {!quiet && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                      {live.slice(1, 3).map((tour) => (
                        <Box
                          key={tour.id}
                          component={RouterLink}
                          to={tournamentTabPath(tour.id)}
                          data-testid={`home-tournament-${tour.id}`}
                          sx={{ flex: 1, minHeight: 180, borderRadius: '26px', overflow: 'hidden', display: 'flex', color: color.ink, textDecoration: 'none', ...bannerSx(tour) }}
                        >
                          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', p: 2.75, background: tour.bannerUrl ? 'linear-gradient(to top, rgba(16,9,8,1) 25%, rgba(16,9,8,0.4))' : undefined }}>
                            <Box sx={{ mb: 1.25 }}>
                              <LiveChip label={t('home.live.chip')} />
                            </Box>
                            <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.625rem', fontWeight: 700 }}>{tour.name}</Typography>
                            <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>{t('home.teams', { count: tour.teamCount })}</Typography>
                          </Box>
                        </Box>
                      ))}
                      {playCard}
                    </Box>
                  )}
                </Box>
              </Box>
            ) : (
              <Typography data-testid="home-tournaments-empty" sx={{ color: color.muted }}>
                {t('home.none')}
              </Typography>
            )}

            {quiet && (restUpcoming.length > 0 || playCard) && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: playCard ? 'minmax(0, 2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }, gap: 2.5 }}>
                {restUpcoming.length > 0 ? (
                  <Box component="section" aria-labelledby="home-more-title">
                    <SectionTitle id="home-more-title" title={t('home.quiet.more')} link={{ to: paths.browse, label: t('home.allTournaments') }} />
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      {restUpcoming.slice(0, 4).map((tour) => (
                        <Box key={tour.id} component={RouterLink} to={tournamentTabPath(tour.id)} data-testid={`home-pick-${tour.id}`} sx={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr) auto', gap: 2, alignItems: 'center', p: 1.5, borderRadius: '20px', bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none' }}>
                          <Box sx={{ height: 64, borderRadius: '12px', ...bannerSx(tour), ...(tour.bannerUrl ? {} : { bgcolor: color.paper3 }) }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.1875rem', fontWeight: 600 }}>{tour.name}</Typography>
                            <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                              {[formatBadge(tour.format), when(tour.startsAt), tour.maxEntries ? `${tour.entries ?? 0} / ${tour.maxEntries}` : null].filter(Boolean).join(' · ')}
                            </Typography>
                          </Box>
                          <Box component="span" sx={{ px: 2.25, py: 1.25, borderRadius: radii.pill, bgcolor: color.paper3, fontWeight: 600, fontSize: '0.875rem' }}>
                            {tour.registrationOpen ? t('home.signup.short') : t('home.signup.view')}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Box />
                )}
                {playCard}
              </Box>
            )}

            {!quiet && restUpcoming.length > 0 && (
              <Box component="section" aria-labelledby="home-signup-title">
                <SectionTitle id="home-signup-title" title={t('home.signup.title')} aside={t('home.signup.aside')} link={{ to: paths.browse, label: t('home.allTournaments') }} />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
                  {restUpcoming.slice(0, 3).map((tour) => (
                    <Box key={tour.id} component={RouterLink} to={tournamentTabPath(tour.id)} data-testid={`home-pick-${tour.id}`} sx={{ borderRadius: radii.lg, overflow: 'hidden', bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'flex', flexDirection: 'column' }}>
                      <Box sx={{ height: 120, ...bannerSx(tour), ...(tour.bannerUrl ? {} : { bgcolor: color.paper3 }) }} />
                      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>{tour.name}</Typography>
                        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                          {[formatBadge(tour.format), when(tour.startsAt)].filter(Boolean).join(' · ')}
                        </Typography>
                        {tour.maxEntries ? <Progress value={tour.entries ?? 0} max={tour.maxEntries} /> : null}
                        <Box component="span" sx={{ alignSelf: 'flex-start', px: 2.25, py: 1.25, borderRadius: radii.pill, bgcolor: tour.registrationOpen ? color.accent : color.paper3, color: tour.registrationOpen ? color.accentInk : color.ink, fontWeight: 600, fontSize: '0.875rem' }}>
                          {tour.registrationOpen ? t('home.signup.cta') : t('home.signup.view')}
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {quiet && finished[0] ? (
              <LastTime tournament={finished[0]} />
            ) : (
              finished.length > 0 && (
                <Box component="section" aria-labelledby="home-champions-title">
                  <SectionTitle id="home-champions-title" title={t('home.champions.title')} aside={t('home.champions.aside')} link={{ to: paths.browse, label: t('home.champions.all') }} />
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
                    {finished.slice(0, 3).map((tour) => (
                      <Box key={tour.id} component={RouterLink} to={tournamentTabPath(tour.id, 'standings')} data-testid={`home-champion-${tour.id}`} sx={{ p: 2.25, borderRadius: '20px', bgcolor: color.paper2, border: `1px solid ${color.rule}`, color: color.ink, textDecoration: 'none', display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 1.75, alignItems: 'center' }}>
                        <Box sx={{ width: 48, height: 48, borderRadius: '14px', bgcolor: color.paper3, color: color.medalGold, display: 'grid', placeItems: 'center' }}>
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
                  </Box>
                </Box>
              )
            )}
          </>
        )}
      </Container>
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
        link={{ to: tournamentTabPath(tournament.id, 'standings'), label: t('home.lastTime.results') }}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: 1.25, md: 2.5 }, alignItems: 'end' }}>
        {place(second, t('home.lastTime.second'), 120, color.medalSilver)}
        {place(first ?? tournament.winner, t('home.lastTime.champion'), 160, color.medalGold, true)}
        {place(third, t('home.lastTime.third'), 100, color.medalBronze)}
      </Box>
    </Box>
  );
}
