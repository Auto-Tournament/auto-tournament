import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { SectionHead } from '../components/common/ui';
import { TeamHeader } from '../components/team/profile/TeamHeader';
import { RosterList } from '../components/team/profile/RosterList';
import { TeamTournaments } from '../components/team/profile/TeamTournaments';
import { useTeamProfileData } from '../hooks/useTeamProfileData';
import { useIntegration } from '../integrations/registry';
import { useAuth } from '../contexts/AuthContext';
import { pageTitle } from '../utils/pageTitle';

/**
 * Public team profile (`/t/team/:teamId`), the 3.0 draft's `team.html`: the
 * club's header, then two columns — the roster, and the tournament the team
 * is in with its latest results.
 *
 * Distinct from `/team/:teamId` (`TeamMatch`), the team's match page (veto,
 * server, connect) used during play. This is the read-only overview anyone
 * can open. What the roster says about each member's game account (CS2:
 * Steam linked) is the game module's, through `rosterMemberStatus`.
 */
export default function TeamProfile() {
  const { teamId } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { team, hasMatch, match, tournament, standing, recentResults, loading, notFound, error } =
    useTeamProfileData(teamId);

  // The team's game is its tournament's.
  const integration = useIntegration(tournament?.game);
  const MemberStatus = integration.rosterMemberStatus;

  useEffect(() => {
    document.title = pageTitle(
      team?.name ? t('teamProfile.pageTitle', { name: team.name }) : t('teamProfile.roster.title')
    );
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
        <Container maxWidth="lg">
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
      <Container maxWidth="lg">
        <Box sx={{ py: { xs: 4, md: 6 } }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}
          <TeamHeader
            team={team}
            canEdit={isAuthenticated}
            game={
              tournament?.game && tournament.gameName
                ? { slug: tournament.game, name: tournament.gameName }
                : null
            }
          />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
              gap: 4,
              mt: 6,
              alignItems: 'start',
            }}
          >
            <Box component="section" aria-labelledby="team-roster">
              <SectionHead id="team-roster" title={t('teamProfile.roster.title')} />
              <RosterList players={team?.players ?? []} MemberStatus={MemberStatus} />
            </Box>

            <Box component="section" aria-labelledby="team-tournaments">
              <SectionHead id="team-tournaments" title={t('teamProfile.tournaments.title')} />
              <TeamTournaments
                teamId={teamId ?? ''}
                hasMatch={hasMatch}
                match={match}
                tournament={tournament}
                standing={standing}
                recentResults={recentResults}
              />
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
