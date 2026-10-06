import { Navigate, Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KeyDatesBar } from '../components/tournament/overview/KeyDatesBar';
import { MapPoolCard } from '../components/tournament/overview/MapPoolCard';
import { TeamsPreviewCard } from '../components/tournament/overview/TeamsPreviewCard';
import { ScheduleCalendar } from '../components/tournament/overview/ScheduleCalendar';
import { LiveStrip } from '../components/tournament/overview/LiveStrip';
import { TournamentResults } from '../components/tournament/results/TournamentResults';
import { RegisteredPanel } from '../components/tournament/signup/RegisteredPanel';
import { CheckInPanel } from '../components/tournament/signup/CheckInPanel';
import { signupPhase, useTournamentSignup, viewerRegistration } from '../hooks/useTournamentSignup';
import { api } from '../utils/api';
import { fontDisplay, radii, tokens } from '../theme/tokens';
import { YourePlayingPanel } from '../components/tournament/page/YourePlayingPanel';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { isLiveMatch } from '../components/tournament/page/matchHelpers';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { compareMatchOrder } from '../utils/matchUtils';
import { tournamentTabPath, yourMatchFirst } from '../paths';

/**
 * The tournament page's Overview tab, kept to what a quick look needs (the
 * drafts' board 1): the key dates in one bar, the map pool and the teams as
 * two compact cards, and the schedule as a calendar. The format and the
 * organizer's description sit in the header above; rules have their own tab.
 * While matches run, the live strip and "You're playing" come first.
 */
export default function TournamentOverview() {
  const { t } = useTranslation();
  const { tournament, teams, players, viewerTeam } = useTournamentPage();
  const { matches } = usePublicBracket(tournament.id);
  const liveMatches = matches.filter(isLiveMatch).sort(compareMatchOrder);
  const isShuffle = tournament.type === 'shuffle';
  const maps = tournament.maps ?? [];
  const schedule = tournament.settings?.schedule ?? [];
  const signup = useTournamentSignup(tournament.id);
  // The calendar shows the check-in window too (gold), when there is one and
  // the organizer did not put it in the schedule themselves.
  const calendar =
    signup.window?.checkInOpensAt && signup.window.checkInClosesAt && !schedule.some((s) => /check/i.test(s.label))
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
  const registration = viewerRegistration(signup);
  const canManage = Boolean(registration && signup.eligibleTeams.some((team) => team.id === registration.teamId));
  const spotsLeft = signup.window?.maxTeams ? signup.window.maxTeams - tournament.teamIds.length : null;
  const canSignUp =
    tournament.status === 'setup' && phase === 'open' && !registration && (spotsLeft === null || spotsLeft > 0);

  // While it runs, a player in it belongs on "Your match".
  if (yourMatchFirst(tournament.status, Boolean(viewerTeam))) {
    return <Navigate to={tournamentTabPath(tournament.id, 'match')} replace />;
  }
  // Once it is over, the overview is the results.
  if (tournament.status === 'completed' && !isShuffle) {
    return <TournamentResults tournament={tournament} teams={teams} players={players} />;
  }

  return (
    <Stack spacing={{ xs: 3, md: 3.5 }} data-testid="public-tournament-overview">
      <LiveStrip
        matches={liveMatches}
        linkLabel={t('overviewPage.allMatches')}
        linkTo={tournamentTabPath(tournament.id, 'matches')}
      />

      {viewerTeam && !(registration && tournament.status === 'setup') && (
        <YourePlayingPanel tournament={tournament} team={viewerTeam} matches={matches} />
      )}

      {registration && tournament.status === 'setup' && phase === 'checkIn' && signup.window ? (
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
      ) : registration && tournament.status === 'setup' ? (
        <RegisteredPanel
          tournament={tournament}
          window={signup.window}
          registration={registration}
          registrations={signup.registrations}
          canManage={canManage}
          onWithdraw={async () => {
            await api.delete(`/api/tournament-signup/${tournament.id}/registration/${registration.teamId}`);
            await signup.reload();
          }}
        />
      ) : (
        <KeyDatesBar
          tournament={tournament}
          signup={signup.window}
          action={
            canSignUp ? (
              <Button
                component={RouterLink}
                to={tournamentTabPath(tournament.id, 'signup')}
                variant="contained"
                data-testid="overview-sign-up"
                sx={{ borderRadius: radii.pill, px: 3.25, py: 1.75, fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {t('signup.cta')}
              </Button>
            ) : undefined
          }
        />
      )}

      {(maps.length > 0 || !isShuffle) && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <MapPoolCard maps={maps} />
          {!isShuffle && (
            <TeamsPreviewCard teams={teams} to={tournamentTabPath(tournament.id, 'teams')} />
          )}
        </Box>
      )}

      {calendar.length > 0 ? (
        <ScheduleCalendar
          schedule={calendar}
          tournamentName={tournament.name}
          tournamentId={tournament.id}
        />
      ) : (
        <Box component="section" aria-labelledby="overview-schedule-empty" data-testid="overview-schedule-empty">
          <Typography id="overview-schedule-empty" component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600, mb: 1.5 }}>
            {t('overviewPage.schedule')}
          </Typography>
          <Box sx={{ border: `1px dashed ${tokens.color.rule}`, borderRadius: radii.lg, p: 3, color: tokens.color.muted }}>
            {t('overviewPage.scheduleSoon')}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
