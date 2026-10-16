import { Link as RouterLink } from 'react-router-dom';
import { fmtTime } from '../utils/time';
import { useIntegrationFor } from '../integrations/registry';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TournamentResults } from '../components/tournament/results/TournamentResults';
import { RegisteredPanel } from '../components/tournament/signup/RegisteredPanel';
import { CheckInPanel } from '../components/tournament/signup/CheckInPanel';
import { ShuffleJoin } from '../components/tournament/signup/ShuffleJoin';
import { signupPhase, useTournamentSignup, viewerRegistration } from '../hooks/useTournamentSignup';
import { api } from '../utils/api';
import { mono, radii, tokens } from '../theme/tokens';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { tournamentTabPath } from '../paths';
import { TabLoading } from '../components/tournament/page/TabState';
import {
  HowMatchesPlayed,
  KeyDateTiles,
  MapPoolTiles,
  ScheduleList,
  SignUpHero,
  TeamsByRating,
} from '../components/tournament/overview/PreStartOverview';
import { ShuffleStandings } from '../components/tournament/overview/PlayersLeaderboard';
import { matchPagePath } from '../paths';
import { OverviewLive } from '../components/tournament/overview/OverviewLive';

/**
 * The tournament page's Overview tab, kept to what a quick look needs (the
 * drafts' board 1): the key dates in one bar, the map pool and the teams as
 * two compact cards, and the schedule as a calendar. The format and the
 * organizer's description sit in the header above; rules have their own tab.
 * While matches run, the live strip and "You're playing" come first.
 */
export default function TournamentOverview() {
  const { t } = useTranslation();
  const page = useTournamentPage();
  const { tournament, teams, players, viewerTeam } = page;
  const bracket = usePublicBracket(tournament.id);
  const { matches } = bracket;
  const RulesView = useIntegrationFor(tournament).tournamentRulesView;
  const isShuffle = tournament.type === 'shuffle';
  const maps = tournament.maps ?? [];
  // The organizer's schedule, and each round's start time (Manage › Schedule) with when its veto opens.
  const matchTimes = (
    tournament.settings as
      | {
          matchTimes?: { mode?: string; rounds?: Record<string, string>; vetoLeadMinutes?: number };
        }
      | undefined
  )?.matchTimes;
  const lastRound = Math.max(0, ...matches.map((m) => m.round ?? 0));
  const roundTimes =
    matchTimes?.mode === 'times'
      ? Object.entries(matchTimes.rounds ?? {})
          .filter(([, at]) => Number.isFinite(Date.parse(at)))
          .map(([round, at]) => {
            const opens = new Date(Date.parse(at) - (matchTimes.vetoLeadMinutes ?? 5) * 60_000);
            const name =
              /elimination/.test(tournament.type ?? '') && Number(round) === lastRound
                ? t('overviewPage.finalRound')
                : t('overviewPage.roundN', { n: Number(round) });
            return {
              at,
              label: t('overviewPage.roundStarts', {
                round: name,
                time: fmtTime(opens),
              }),
            };
          })
      : [];
  const schedule = [...(tournament.settings?.schedule ?? []), ...roundTimes];
  const signup = useTournamentSignup(tournament.id);
  // The calendar shows the check-in window too (gold), when there is one and
  // the organizer did not put it in the schedule themselves.
  const calendar =
    signup.window?.checkInOpensAt &&
    signup.window.checkInClosesAt &&
    !schedule.some((s) => /check/i.test(s.label))
      ? [
          ...schedule,
          {
            at: signup.window.checkInOpensAt,
            end: signup.window.checkInClosesAt,
            label: t('overviewPage.checkInWindow'),
            kind: 'checkin' as const,
          },
        ]
      : schedule;
  // eslint-disable-next-line react-hooks/purity -- the phase only needs to be right when the page renders
  const phase = signupPhase(signup.window, Date.now());
  // A finished tournament takes nobody new, whatever its registrationOpen still says (NTLAN,
  // 2026-10-16: "Bli med" stayed on after the last round).
  const over = tournament.status === 'completed';
  const joinOpen = phase === 'open' && !over;
  const registration = viewerRegistration(signup);
  const canManage = Boolean(
    registration && signup.eligibleTeams.some((team) => team.id === registration.teamId)
  );
  const spotsLeft = signup.window?.maxTeams
    ? signup.window.maxTeams - tournament.teamIds.length
    : null;
  const canSignUp =
    !isShuffle &&
    tournament.status === 'setup' &&
    phase === 'open' &&
    !registration &&
    (spotsLeft === null || spotsLeft > 0);

  // Once it is over, the overview is the results.
  if (tournament.status === 'completed' && !isShuffle) {
    return (
      <TournamentResults
        tournament={bracket.tournament ? { ...tournament, ...bracket.tournament } : tournament}
        teams={teams}
        players={players}
        matches={matches}
      />
    );
  }

  // While it runs, a format with fixed teams gets the drafts' live overview:
  // the status hero, the schedule or bracket, the round, the table, the players.
  if (tournament.status === 'in_progress' && !isShuffle) {
    if (bracket.loading) return <TabLoading label={t('overviewPage.loading')} />;
    return (
      <Box data-testid="public-tournament-overview">
        <OverviewLive
          tournament={
            bracket.tournament
              ? {
                  ...tournament,
                  ...bracket.tournament,
                  teams: bracket.tournament.teams ?? tournament.teams,
                }
              : tournament
          }
          matches={matches}
          totalRounds={bracket.totalRounds}
          roundRobinStandings={bracket.roundRobinStandings}
          swissStandings={bracket.swissStandings}
          groupStandings={bracket.groupStandings}
          viewerTeamId={viewerTeam?.id ?? null}
        />
      </Box>
    );
  }

  // Before it starts (the drafts' "Before it starts" board): the key dates,
  // where the viewer stands, the schedule, how matches are played, the map
  // pool and the teams.
  if (tournament.status === 'setup' || tournament.status === 'ready') {
    const { viewerHasSteamIdentity } = page;
    return (
      <Stack spacing={3} data-testid="public-tournament-overview">
        <KeyDateTiles tournament={tournament} signup={signup.window} />
        {isShuffle && signup.players ? (
          <ShuffleJoin
            tournamentId={tournament.id}
            players={signup.players}
            steamId={signup.steamId}
            open={joinOpen}
            started={false}
            spots={
              signup.window?.maxTeams ? signup.window.maxTeams * (tournament.teamSize ?? 5) : null
            }
            onChange={signup.reload}
          />
        ) : registration && phase === 'checkIn' && signup.window ? (
          <CheckInPanel
            tournament={tournament}
            window={signup.window}
            registration={registration}
            registrations={signup.registrations}
            steamId={signup.steamId}
            onCheckIn={async () => {
              await api.post(`/api/tournament-signup/${tournament.id}/check-in`, {});
              await signup.reload();
            }}
          />
        ) : registration ? (
          <RegisteredPanel
            tournament={tournament}
            window={signup.window}
            registration={registration}
            registrations={signup.registrations}
            canManage={canManage}
            onWithdraw={async () => {
              await api.delete(
                `/api/tournament-signup/${tournament.id}/registration/${registration.teamId}`
              );
              await signup.reload();
            }}
          />
        ) : (
          <SignUpHero
            tournament={tournament}
            signup={signup.window}
            canSignUp={canSignUp}
            hasSteam={viewerHasSteamIdentity}
            onRoster={!!viewerTeam || signup.eligibleTeams.length > 0}
          />
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
          <ScheduleList tournament={tournament} schedule={calendar} />
          {RulesView && (
            <HowMatchesPlayed
              tournament={tournament}
              rulesView={<RulesView tournament={tournament} compact />}
            />
          )}
        </Box>
        <MapPoolTiles maps={maps} />
        {!isShuffle && (
          <TeamsByRating
            teams={(tournament.teams ?? []).map((tm) => ({
              id: tm.id,
              name: tm.name,
              tag: tm.tag,
            }))}
            registrations={signup.registrations}
            viewerTeamId={viewerTeam?.id ?? registration?.teamId ?? null}
            to={tournamentTabPath(tournament.id, 'teams')}
          />
        )}
      </Stack>
    );
  }

  // A running or finished shuffle (the drafts' shuffle board): the status hero,
  // the map rounds, this round and the earlier ones, the standings.
  const done = matches.filter((m) => m.status === 'completed');
  const openRounds = matches.filter((m) => m.status !== 'completed').map((m) => m.round);
  const currentRound = openRounds.length
    ? Math.min(...openRounds)
    : Math.max(0, ...matches.map((m) => m.round)) + 1;
  const earlierRounds = [...new Set(done.map((m) => m.round))]
    .filter((r) => r < currentRound)
    .sort((a, b) => b - a);
  const earlier = earlierRounds.map((r) => (
    <Box key={r} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: '0.8125rem', color: tokens.color.muted }}>
        {t('liveOverview.round', { n: r })}
      </Typography>
      {done
        .filter((m) => m.round === r)
        .map((m) => (
          <Box
            key={m.slug}
            component={RouterLink}
            to={matchPagePath(m.slug)}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
              gap: 1.5,
              alignItems: 'center',
              px: 2,
              py: 1.25,
              borderRadius: radii.md,
              bgcolor: tokens.color.paper,
              color: tokens.color.muted,
              textDecoration: 'none',
              fontSize: '0.9375rem',
            }}
          >
            <Box
              component="span"
              sx={{
                minWidth: 0,
                color: m.winner?.id && m.winner.id === m.team1?.id ? tokens.color.live : 'inherit',
                fontWeight: m.winner?.id === m.team1?.id ? 600 : 400,
              }}
            >
              {m.team1?.name}
            </Box>
            <Box component="span" sx={{ ...mono, fontSize: '0.875rem' }}>
              {m.mapResults?.length === 1
                ? `${m.mapResults[0].team1Score} – ${m.mapResults[0].team2Score}`
                : `${m.team1Score ?? 0} – ${m.team2Score ?? 0}`}
            </Box>
            <Box
              component="span"
              sx={{
                minWidth: 0,
                textAlign: 'right',
                color: m.winner?.id && m.winner.id === m.team2?.id ? tokens.color.live : 'inherit',
                fontWeight: m.winner?.id === m.team2?.id ? 600 : 400,
              }}
            >
              {m.team2?.name}
            </Box>
          </Box>
        ))}
    </Box>
  ));
  return (
    <Stack spacing={3} data-testid="public-tournament-overview">
      {signup.players && (
        <ShuffleJoin
          tournamentId={tournament.id}
          players={signup.players}
          steamId={signup.steamId}
          open={joinOpen}
          started
          spots={
            signup.window?.maxTeams ? signup.window.maxTeams * (tournament.teamSize ?? 5) : null
          }
          onChange={signup.reload}
          earlier={earlier}
          side={
            <ShuffleStandings
              tournamentId={tournament.id}
              viewerSteamId={signup.steamId}
              allTo={tournamentTabPath(tournament.id, 'standings')}
            />
          }
        />
      )}
    </Stack>
  );
}
