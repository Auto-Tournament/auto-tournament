import { Box, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KeyDatesBar } from '../components/tournament/overview/KeyDatesBar';
import { MapPoolCard } from '../components/tournament/overview/MapPoolCard';
import { TeamsPreviewCard } from '../components/tournament/overview/TeamsPreviewCard';
import { ScheduleCalendar } from '../components/tournament/overview/ScheduleCalendar';
import { LiveStrip } from '../components/tournament/overview/LiveStrip';
import { YourePlayingPanel } from '../components/tournament/page/YourePlayingPanel';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { isLiveMatch } from '../components/tournament/page/matchHelpers';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { compareMatchOrder } from '../utils/matchUtils';
import { tournamentTabPath } from '../paths';

/**
 * The tournament page's Overview tab, kept to what a quick look needs (the
 * drafts' board 1): the key dates in one bar, the map pool and the teams as
 * two compact cards, and the schedule as a calendar. The format and the
 * organizer's description sit in the header above; rules have their own tab.
 * While matches run, the live strip and "You're playing" come first.
 */
export default function TournamentOverview() {
  const { t } = useTranslation();
  const { tournament, teams, viewerTeam } = useTournamentPage();
  const { matches } = usePublicBracket(tournament.id);
  const liveMatches = matches.filter(isLiveMatch).sort(compareMatchOrder);
  const isShuffle = tournament.type === 'shuffle';
  const maps = tournament.maps ?? [];
  const schedule = tournament.settings?.schedule ?? [];

  return (
    <Stack spacing={{ xs: 3, md: 3.5 }} data-testid="public-tournament-overview">
      <LiveStrip
        matches={liveMatches}
        linkLabel={t('overviewPage.allMatches')}
        linkTo={tournamentTabPath(tournament.id, 'matches')}
      />

      {viewerTeam && <YourePlayingPanel tournament={tournament} team={viewerTeam} matches={matches} />}

      <KeyDatesBar tournament={tournament} />

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

      {schedule.length > 0 && (
        <ScheduleCalendar
          schedule={schedule}
          tournamentName={tournament.name}
          tournamentId={tournament.id}
        />
      )}
    </Stack>
  );
}
