import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, Container, Link, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameMark } from '../components/common/GameMark';
import { LiveChip, PageHead, Panel, panelSx, Row, RowList, SectionHead } from '../components/common/ui';
import { useAuth } from '../contexts/AuthContext';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentList } from '../hooks/useTournamentList';
import { fetchMyGames, type GameSummary } from '../components/games/gamesApi';
import { api } from '../utils/api';
import { eliminationRoundCount, getRoundLabel } from '../utils/matchUtils';
import { formatBadge, tournamentAction, tournamentWhen } from '../utils/tournamentSummary';
import { paths, tournamentTabPath } from '../paths';
import { tokens, radii, textSize } from '../theme/tokens';

const { color } = tokens;

interface ViewerTeam {
  id: string;
  name: string;
  tag?: string;
}

/** A quiet line in a panel, for a section with nothing in it yet. */
function EmptyLine({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <Panel role="status" data-testid={testId} sx={{ px: 3, py: 2.5, color: color.muted, fontSize: textSize.sm }}>
      {children}
    </Panel>
  );
}

/**
 * Same "connect" URI the team match page builds (see
 * `components/team/MatchInfoCard.tsx`), duplicated here rather than shared
 * because that component is off-limits while it's being rebuilt elsewhere.
 */
function steamConnectUri(server: { host: string; port: number; password?: string }): string {
  const address = `${server.host}:${server.port}`;
  const encodedPassword = server.password ? encodeURIComponent(server.password) : '';
  const params = server.password
    ? `+password%20${encodedPassword};%20+connect%20${address}`
    : `+connect%20${address}`;
  return `steam://run/730//${params}`;
}


/**
 * Home: the signed-in player's own landing page — their games, next match,
 * tournaments they're in, and open tournaments for the games they play.
 *
 * Built against `useTournamentList`, which returns 0 or 1 tournaments today
 * (this instance's single tournament row). 3.1 swaps that hook for the
 * plural tournaments endpoint; this page does not change.
 */
export default function Home() {
  const { t, i18n } = useTranslation();
  const { playerSteamId } = useAuth();
  const [playerName, setPlayerName] = useState('');
  const [myGames, setMyGames] = useState<GameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [myTeam, setMyTeam] = useState<ViewerTeam | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);

  const { tournaments, loading: tournamentsLoading } = useTournamentList();
  const {
    team: myTeamMatchTeam,
    match,
    hasMatch,
    standing,
    matchHistory,
    loading: matchLoading,
  } = useTeamMatchData(myTeam?.id ?? undefined);

  useEffect(() => {
    document.title = pageTitle(t('home.title'));
  }, [t]);

  useEffect(() => {
    if (!playerSteamId) return;
    let cancelled = false;
    void api
      .get<{ success: boolean; player?: { name: string } }>(`/api/players/${playerSteamId}/summary`)
      .then((res) => {
        if (!cancelled && res.success && res.player) setPlayerName(res.player.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [playerSteamId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setGamesLoading(true);
      try {
        const mine = await fetchMyGames();
        if (!cancelled) setMyGames(mine?.games ?? []);
      } finally {
        if (!cancelled) setGamesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [playerSteamId]);

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
        const res = await api.get<{ success: boolean; team: ViewerTeam | null }>(
          `/api/players/${playerSteamId}/team`
        );
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

  const myGameSlugs = useMemo(() => new Set(myGames.map((g) => g.slug)), [myGames]);

  // Today there's exactly one tournament, so "mine" is just "is my team on
  // its roster". 3.1's plural endpoint makes this a real filter across many.
  const currentTournament = tournaments[0] ?? null;
  const teamInCurrentTournament =
    !!myTeam && !!currentTournament && (hasMatch || matchHistory.length > 0 || !!standing);

  const myTournaments = useMemo(() => {
    if (!currentTournament || !myTeam) return [];
    // Membership signal: a match now, match history, or a standing all imply
    // the team is on this tournament's roster. Absent all three (e.g. the
    // tournament hasn't started and this team was never entered) we can't
    // tell from today's per-team endpoints alone, so we don't show it.
    if (!teamInCurrentTournament) return [];
    return [currentTournament];
  }, [currentTournament, myTeam, teamInCurrentTournament]);

  // Before any games are picked there is nothing to filter by, so every open
  // tournament is shown rather than none (the section used to be empty until
  // the player picked their games).
  const noGamesPicked = !gamesLoading && myGameSlugs.size === 0;
  const openForYourGames = useMemo(() => {
    const myTournamentIds = new Set(myTournaments.map((tour) => tour.id));
    return tournaments.filter(
      (tour) =>
        !myTournamentIds.has(tour.id) &&
        (tour.status === 'setup' || tour.status === 'ready') &&
        (noGamesPicked || (tour.game && myGameSlugs.has(tour.game)))
    );
  }, [tournaments, myTournaments, myGameSlugs, noGamesPicked]);

  const tournamentState = (tournament: (typeof tournaments)[number]) => {
    if (tournament.status === 'completed') {
      return {
        label: t('home.tournaments.finished'),
        detail:
          standing && standing.totalTeams
            ? t('home.tournaments.placement', {
                position: standing.position,
                total: standing.totalTeams,
              })
            : undefined,
        color: 'default' as const,
      };
    }
    if (hasMatch) {
      return { label: t('home.tournaments.playingNow'), detail: undefined, color: 'success' as const };
    }
    const lastResult = matchHistory[matchHistory.length - 1];
    if (tournament.status === 'in_progress' && lastResult && !lastResult.won) {
      return { label: t('home.tournaments.eliminated'), detail: undefined, color: 'default' as const };
    }
    return { label: t('home.tournaments.waiting'), detail: undefined, color: 'default' as const };
  };


  const loading = tournamentsLoading || teamLoading || gamesLoading || (!!myTeam && matchLoading);
  const showNextMatch = !!myTeam && hasMatch && !!match;

  // The draft's line under the greeting ("One match today. Two tournaments
  // open for games you play."), from what this page already knows.
  const summary = [
    showNextMatch ? t('home.summary.match') : null,
    openForYourGames.length > 0
      ? t(noGamesPicked ? 'home.summary.openAll' : 'home.summary.open', { count: openForYourGames.length })
      : null,
  ].filter(Boolean);
  const summaryLine = summary.length > 0 ? summary.join(' ') : t('home.summary.none');

  const gameName = (slug: string | undefined): string | undefined =>
    slug ? myGames.find((game) => game.slug === slug)?.name : undefined;

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="home-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={playerName ? t('home.greeting', { name: playerName }) : t('home.greetingFallback')}
          subtitle={loading ? undefined : <span data-testid="home-summary">{summaryLine}</span>}
          actions={
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              aria-label={t('home.yourGames')}
            >
              {!gamesLoading &&
                myGames.map((game) => (
                  <Chip
                    key={game.id}
                    size="small"
                    variant="outlined"
                    label={game.name}
                    avatar={
                      <GameMark
                        name={game.name}
                        slug={game.slug}
                        iconUrl={game.appIconUrl}
                        neutral
                        size={20}
                      />
                    }
                    data-testid={`home-game-chip-${game.slug}`}
                  />
                ))}
              <Link
                component={RouterLink}
                to="/welcome/games?edit=1"
                variant="body2"
                underline="hover"
                data-testid="home-edit-games"
                sx={{ color: color.muted, '&:hover': { color: color.ink } }}
              >
                {t('home.editGames')}
              </Link>
            </Stack>
          }
        />

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('home.loading')} />
          </Box>
        ) : (
          <Stack spacing={{ xs: 5, md: 8 }}>
            {showNextMatch && match && (
              <Box
                component="section"
                aria-label={t('home.nextMatch')}
                data-testid="home-next-match"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto' },
                  gap: 3,
                  alignItems: 'center',
                  px: { xs: 3, md: 4 },
                  py: 3,
                  borderRadius: radii.lg,
                  bgcolor: color.paper2,
                  border: `1px solid ${color.accent}`,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  {match.status === 'live' ? (
                    <LiveChip label={t(`home.matchStatus.${match.status}`)} />
                  ) : (
                    <Chip size="small" label={t(`home.matchStatus.${match.status}`)} />
                  )}
                  <Typography variant="h4" component="p" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                    {myTeamMatchTeam?.name ?? myTeam?.name}
                    <Typography component="span" variant="body1" color="text.secondary" sx={{ mx: 1 }}>
                      {t('home.vs')}
                    </Typography>
                    {match.opponent?.name ?? t('home.tbd')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: color.ink2 }}>
                    {[
                      currentTournament?.name,
                      getRoundLabel(
                        match.round,
                        currentTournament
                          ? eliminationRoundCount(currentTournament.teamCount, currentTournament.type)
                          : undefined
                      ),
                      formatBadge(match.matchFormat),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    component={RouterLink}
                    to={`/team/${myTeam?.id}`}
                    variant="outlined"
                    data-testid="home-open-match"
                  >
                    {t('home.openMatch')}
                  </Button>
                  {match.server && (
                    <Button
                      component="a"
                      href={steamConnectUri(match.server)}
                      variant="contained"
                      data-testid="home-connect-server"
                    >
                      {t('home.connectToServer')}
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            <Box component="section" aria-labelledby="home-mine-title">
              <SectionHead id="home-mine-title" title={t('home.yourTournaments.title')} />
              {myTournaments.length === 0 ? (
                <EmptyLine testId="home-tournaments-empty">{t('home.yourTournaments.empty')}</EmptyLine>
              ) : (
                <RowList data-testid="home-tournaments-list">
                  {myTournaments.map((tournament) => {
                    const state = tournamentState(tournament);
                    return (
                      <Row
                        key={tournament.id}
                        columns={{ xs: 'auto minmax(0, 1fr)', sm: 'auto minmax(0, 1fr) auto' }}
                        data-testid={`home-tournament-${tournament.id}`}
                      >
                        <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h6" component="h3" sx={{ fontSize: textSize.lg }}>
                            <Link
                              component={RouterLink}
                              to={tournamentTabPath(tournament.id)}
                              underline="hover"
                              color="inherit"
                            >
                              {tournament.name}
                            </Link>
                          </Typography>
                          <Typography variant="body2" sx={{ color: color.muted }}>
                            {[
                              myTeam?.name,
                              t(`tournament.typeSelector.types.${tournament.type}.label`),
                              formatBadge(tournament.format),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Typography>
                        </Box>
                        <Box
                          sx={{
                            gridColumn: { xs: 2, sm: 'auto' },
                            display: 'grid',
                            gap: 0.5,
                            justifyItems: { xs: 'start', sm: 'end' },
                          }}
                        >
                          {state.color === 'success' ? (
                            <LiveChip label={state.label} />
                          ) : (
                            <Chip size="small" label={state.label} />
                          )}
                          {state.detail && (
                            <Box component="small" sx={{ color: color.muted, fontSize: textSize.xs }}>
                              {state.detail}
                            </Box>
                          )}
                        </Box>
                      </Row>
                    );
                  })}
                </RowList>
              )}
            </Box>

            <Box component="section" aria-labelledby="home-picks-title">
              <SectionHead
                id="home-picks-title"
                title={noGamesPicked ? t('home.openForYourGames.titleAll') : t('home.openForYourGames.title')}
                link={{ to: paths.browse, label: t('home.openForYourGames.browseAll') }}
              />
              {openForYourGames.length === 0 ? (
                <EmptyLine testId="home-open-empty">
                  {noGamesPicked ? t('home.openForYourGames.emptyAll') : t('home.openForYourGames.empty')}
                </EmptyLine>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
                    gap: 2,
                  }}
                >
                  {openForYourGames.map((tournament) => {
                    const when = tournamentWhen(t, tournament, i18n.language);
                    const action = tournamentAction(tournament);
                    const name = gameName(tournament.game);
                    return (
                      <Box
                        key={tournament.id}
                        component={RouterLink}
                        to={action.to}
                        data-testid={`home-pick-${tournament.id}`}
                        sx={{
                          ...panelSx,
                          display: 'grid',
                          gap: 1.5,
                          alignContent: 'start',
                          p: 3,
                          color: color.ink,
                          textDecoration: 'none',
                          '&:hover': { borderColor: color.muted },
                          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
                          <Box
                            component="span"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: textSize.sm, minWidth: 0 }}
                          >
                            <GameMark name={name ?? tournament.game ?? tournament.name} slug={tournament.game} size={24} />
                            {name}
                          </Box>
                          {when.kind === 'text' && <Chip size="small" label={when.text} />}
                        </Box>
                        <Typography variant="h6" component="h3">
                          {tournament.name}
                        </Typography>
                        <Typography variant="body2" sx={{ color: color.muted }}>
                          {[
                            t(`tournament.typeSelector.types.${tournament.type}.label`),
                            formatBadge(tournament.format),
                            t('browsePage.teamsCount', { count: tournament.teamCount }),
                          ].join(' · ')}
                        </Typography>
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 1.5,
                            mt: 0.5,
                            pt: 2,
                            borderTop: `1px solid ${color.rule}`,
                          }}
                        >
                          <Box component="span" sx={{ fontSize: textSize.xs, color: color.live }}>
                            {playerSteamId ? `✓ ${t('home.openForYourGames.steamLinked')}` : ''}
                          </Box>
                          <Box
                            component="span"
                            sx={{
                              px: 1.5,
                              py: 0.5,
                              borderRadius: radii.pill,
                              bgcolor: color.accent,
                              color: color.accentInk,
                              fontSize: textSize.sm,
                              fontWeight: 600,
                            }}
                          >
                            {t(`browsePage.actions.${action.key}`)}
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
