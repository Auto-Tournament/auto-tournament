import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container } from '@mui/material';
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
import { api, apiErrorMessage } from '../utils/api';
import { paths, teamManagePath } from '../paths';
import ConfirmDialog from '../components/modals/ConfirmDialog';

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
  const navigate = useNavigate();
  const { isAuthenticated, playerSteamId } = useAuth();
  const { team, hasMatch, match, tournament, standing, recentResults, loading, notFound, error } =
    useTeamProfileData(teamId);

  // The team's logo, and the viewer's place on it: the owner and captains
  // get Manage, a member gets Leave.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [own, setOwn] = useState<{ role: 'owner' | 'captain' | 'member'; uid: string } | null>(
    null
  );
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    api
      .get<{ success: boolean; team?: { logoUrl: string | null } }>(
        `/api/team-directory/${encodeURIComponent(teamId)}`
      )
      .then((res) => !cancelled && setLogoUrl(res.team?.logoUrl ?? null))
      .catch(() => undefined);
    if (playerSteamId) {
      api
        .get<{
          success: boolean;
          accountUid: string;
          owned: { id: string } | null;
          memberOf: Array<{ id: string; role: 'captain' | 'member' }>;
        }>('/api/team-directory/mine')
        .then((res) => {
          if (cancelled) return;
          const role =
            res.owned?.id === teamId ? 'owner' : res.memberOf.find((m) => m.id === teamId)?.role;
          setOwn(role ? { role, uid: res.accountUid } : null);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [teamId, playerSteamId]);

  const ownActions = own ? (
    own.role === 'member' ? (
      <Button
        variant="outlined"
        size="small"
        color="error"
        onClick={() => setLeaving(true)}
        data-testid="team-profile-leave"
      >
        {t('teamProfile.leave')}
      </Button>
    ) : (
      <Button
        variant="outlined"
        size="small"
        component={RouterLink}
        to={teamManagePath(teamId ?? '')}
        data-testid="team-profile-manage"
      >
        {t('teamProfile.manage')}
      </Button>
    )
  ) : undefined;

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
            logoUrl={logoUrl}
            actions={ownActions}
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
          {leaveError && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {leaveError}
            </Alert>
          )}
        </Box>
      </Container>
      <ConfirmDialog
        open={leaving}
        title={t('teamProfile.leaveTitle')}
        message={t('teamProfile.leaveConfirm', { name: team?.name ?? '' })}
        confirmLabel={t('teamProfile.leave')}
        confirmColor="error"
        onCancel={() => setLeaving(false)}
        onConfirm={async () => {
          setLeaving(false);
          try {
            await api.delete(
              `/api/team-directory/${encodeURIComponent(teamId ?? '')}/members/${encodeURIComponent(own?.uid ?? '')}`
            );
            navigate(paths.browseTeams);
          } catch (err) {
            setLeaveError(apiErrorMessage(err, t('teamProfile.leaveFailed')));
          }
        }}
      />
    </Box>
  );
}
