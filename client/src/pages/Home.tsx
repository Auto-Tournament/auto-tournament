import { pageTitle } from '../utils/pageTitle';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  Grid,
  Link,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { GameMark } from '../components/common/GameMark';
import { useAuth } from '../contexts/AuthContext';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentList } from '../hooks/useTournamentList';
import { fetchMyGames, type GameSummary } from '../components/games/gamesApi';
import { api } from '../utils/api';
import { MATCH_FORMATS } from '../constants/tournament';
import { eliminationRoundCount, getRoundLabel } from '../utils/matchUtils';
import { radii } from '../theme/tokens';

interface ViewerTeam {
  id: string;
  name: string;
  tag?: string;
}

/** "bo3" -> "Bo3". Falls back to the MATCH_FORMATS label when it doesn't fit. */
function formatBadge(format: string): string {
  const known = MATCH_FORMATS.find((f) => f.value === format);
  if (!known) return format;
  return format.length >= 2 ? format[0].toUpperCase() + format.slice(1) : known.label;
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
  const { t } = useTranslation();
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

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="home-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'flex-end' }}
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="h4" fontWeight={700}>
              {playerName ? t('home.greeting', { name: playerName }) : t('home.greetingFallback')}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {!gamesLoading &&
              myGames.map((game) => (
                <Chip
                  key={game.id}
                  size="small"
                  variant="outlined"
                  label={game.name}
                  avatar={<GameMark name={game.name} slug={game.slug} coverUrl={game.coverUrl} size={20} />}
                  data-testid={`home-game-chip-${game.slug}`}
                />
              ))}
            <Link
              component={RouterLink}
              to="/welcome/games?edit=1"
              variant="body2"
              underline="hover"
              data-testid="home-edit-games"
            >
              {t('home.editGames')}
            </Link>
          </Stack>
        </Stack>

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={5}>
            {showNextMatch && match && (
              <Card
                variant="outlined"
                data-testid="home-next-match"
                sx={{
                  p: { xs: 2, md: 3 },
                  borderColor: 'primary.main',
                  bgcolor: 'background.surface1',
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  spacing={2}
                >
                  <Box>
                    <Chip
                      size="small"
                      color={match.status === 'live' ? 'success' : 'default'}
                      label={t(`home.matchStatus.${match.status}`)}
                      sx={{ mb: 1, fontWeight: 600 }}
                    />
                    <Typography variant="h5" fontWeight={700}>
                      {myTeamMatchTeam?.name ?? myTeam?.name}
                      <Typography component="span" variant="body1" color="text.secondary" sx={{ mx: 1 }}>
                        {t('home.vs')}
                      </Typography>
                      {match.opponent?.name ?? t('home.tbd')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[currentTournament?.name, getRoundLabel(
                        match.round,
                        currentTournament
                          ? eliminationRoundCount(currentTournament.teamCount, currentTournament.type)
                          : undefined
                      ), formatBadge(match.matchFormat)]
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
                </Stack>
              </Card>
            )}

            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
                <Typography variant="h5" fontWeight={700}>
                  {t('home.yourTournaments.title')}
                </Typography>
              </Stack>
              {myTournaments.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid="home-tournaments-empty">
                  {t('home.yourTournaments.empty')}
                </Typography>
              ) : (
                <List
                  disablePadding
                  sx={{ border: 1, borderColor: 'divider', borderRadius: radii.lg, overflow: 'hidden' }}
                  data-testid="home-tournaments-list"
                >
                  {myTournaments.map((tournament) => {
                    const state = tournamentState(tournament);
                    return (
                      <ListItem
                        key={tournament.id}
                        component={RouterLink}
                        to={`/tournament/${tournament.id}`}
                        divider
                        data-testid={`home-tournament-${tournament.id}`}
                        sx={{
                          display: 'flex',
                          gap: 2,
                          alignItems: 'center',
                          color: 'text.primary',
                          textDecoration: 'none',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={36} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600} noWrap>
                            {tournament.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {[
                              t(`tournament.typeSelector.types.${tournament.type}.label`),
                              formatBadge(tournament.format),
                            ].join(' · ')}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Chip size="small" color={state.color} label={state.label} sx={{ fontWeight: 600 }} />
                          {state.detail && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                              {state.detail}
                            </Typography>
                          )}
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
                <Typography variant="h5" fontWeight={700}>
                  {noGamesPicked ? t('home.openForYourGames.titleAll') : t('home.openForYourGames.title')}
                </Typography>
                <Link component={RouterLink} to="/browse" variant="body2" underline="hover">
                  {t('home.openForYourGames.browseAll')}
                </Link>
              </Stack>
              {openForYourGames.length === 0 ? (
                <Alert severity="info" data-testid="home-open-empty">
                  {noGamesPicked ? t('home.openForYourGames.emptyAll') : t('home.openForYourGames.empty')}{' '}
                  <Link component={RouterLink} to="/browse">
                    {t('home.openForYourGames.browseAll')}
                  </Link>
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  {openForYourGames.map((tournament) => (
                    <Grid key={tournament.id} size={{ xs: 12, sm: 6, md: 4 }}>
                      <Card
                        variant="outlined"
                        component={RouterLink}
                        to={`/tournament/${tournament.id}`}
                        sx={{
                          p: 2,
                          display: 'block',
                          textDecoration: 'none',
                          color: 'text.primary',
                          height: '100%',
                          '&:hover': { borderColor: 'text.secondary' },
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                          <GameMark name={tournament.game ?? tournament.name} slug={tournament.game} size={24} />
                          <Typography variant="body2" color="text.secondary">
                            {t('games.picker.supported')}
                          </Typography>
                        </Stack>
                        <Typography variant="h6" fontWeight={700}>
                          {tournament.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                          {[
                            t(`tournament.typeSelector.types.${tournament.type}.label`),
                            formatBadge(tournament.format),
                          ].join(' · ')}
                        </Typography>
                        <Typography variant="caption" color="success.main" fontWeight={600}>
                          {t('home.openForYourGames.steamLinked')}
                        </Typography>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </Box>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
