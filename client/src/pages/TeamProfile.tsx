import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { TeamHeader } from '../components/team/profile/TeamHeader';
import { RosterList } from '../components/team/profile/RosterList';
import { TeamTournaments } from '../components/team/profile/TeamTournaments';
import { useTeamProfileData } from '../hooks/useTeamProfileData';
import { useAuth } from '../contexts/AuthContext';

/**
 * Public team profile (`/t/team/:teamId`).
 *
 * Distinct from `/team/:teamId` (`TeamMatch`), which is the team's live
 * match/server page used during play by players and Auto Tournament CS2 flows — this
 * page never touches that route or its behaviour. It is a read-only overview
 * anyone can open: crest/name, roster with ratings, and the current
 * tournament's status plus recent results.
 */
export default function TeamProfile() {
  const { teamId } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { team, hasMatch, match, tournament, standing, recentResults, loading, notFound, error } =
    useTeamProfileData(teamId);

  useEffect(() => {
    document.title = team?.name
      ? t('teamProfile.pageTitle', { name: team.name })
      : t('teamProfile.roster.title');
  }, [team, t]);

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Box display="flex" alignItems="center" justifyContent="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="md">
          <Box py={6}>
            <Alert severity="error" data-testid="team-profile-not-found">
              {t('teamProfile.notFound')}
            </Alert>
          </Box>
        </Container>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="team-profile-page">
      <TopNavBar />
      <Container maxWidth="md">
        <Box py={6}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            <TeamHeader team={team} canEdit={isAuthenticated} />
            <RosterList players={team?.players ?? []} />
            <TeamTournaments
              hasMatch={hasMatch}
              match={match}
              tournament={tournament}
              standing={standing}
              recentResults={recentResults}
            />
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
