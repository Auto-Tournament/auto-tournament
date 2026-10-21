import { useEffect, useState } from 'react';
import { TeamDiscordLink } from '../addons/discord/TeamDiscordLink';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { LiveChip, Panel, SectionHead } from '../components/common/ui';
import { OpponentName, versusLine } from '../components/team/MatchRowLinks';
import { TeamRecentMatches, type TeamRecentMatch } from '../components/team/TeamRecentMatches';
import { TeamHeader } from '../components/team/profile/TeamHeader';
import { RosterList, type RosterPlayer } from '../components/team/profile/RosterList';
import { TeamTournaments } from '../components/team/profile/TeamTournaments';
import { useTeamProfileData } from '../hooks/useTeamProfileData';
import {
  useInstalledIntegrations,
  useIntegration,
  useIntegrationFor,
} from '../integrations/registry';
import { TeamStatStrip, type TeamProfileNumbers } from '../components/team/profile/TeamStatStrip';
import { useAuth } from '../contexts/AuthContext';
import { pageTitle } from '../utils/pageTitle';
import { api, apiErrorMessage } from '../utils/api';
import { matchPagePath, paths, teamManagePath } from '../paths';
import { NextMatchCard } from '../components/match/NextMatchCard';
import { ModuleNotInstalledNotice } from '../components/common/ModuleNotInstalledNotice';
import ConfirmDialog from '../components/modals/ConfirmDialog';

/**
 * Public team profile (`/team/:teamId`), the 3.0 draft's `team.html`: the
 * club's header, then two columns — the roster, and the tournament the team
 * is in with its latest results.
 *
 * The team's match is played in its match room (`/match/:slug`), which the
 * next-match card links to; the game module's team admin panel (manual
 * reporting: captains) is here. What the roster says about each member's game account (CS2:
 * Steam linked) is the game module's, through `rosterMemberStatus`.
 */
export default function TeamProfile() {
  const { teamId } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, playerSteamId } = useAuth();
  const { team, hasMatch, match, tournament, standing, recentResults, loading, notFound, error } =
    useTeamProfileData(teamId);
  // The game module behind the team's match, else its tournament: its admin
  // control on a team (manual reporting: captains), or a notice while it is
  // missing or still loading.
  const matchIntegration = useIntegrationFor(match ?? tournament ?? { game: null });
  const TeamAdminPanel = matchIntegration.teamAdminPanel;

  // The team's logo, and the viewer's place on it: the owner and captains
  // get Manage, a member gets Leave.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [recentMatches, setRecentMatches] = useState<TeamRecentMatch[]>([]);
  const [numbers, setNumbers] = useState<TeamProfileNumbers | null>(null);
  const [members, setMembers] = useState<RosterPlayer[] | null>(null);
  const [teamGame, setTeamGame] = useState<{ slug: string; name: string } | null>(null);
  const gameViews = useInstalledIntegrations()
    .map((integration) => integration.teamProfileView)
    .filter((view): view is NonNullable<typeof view> => Boolean(view));
  const [own, setOwn] = useState<{ role: 'owner' | 'captain' | 'member'; uid: string } | null>(
    null
  );
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    api
      .get<
        {
          success: boolean;
          team: {
            logoUrl: string | null;
            bannerUrl?: string | null;
            game: string | null;
            gameName?: string | null;
          };
          recentMatches?: TeamRecentMatch[];
          members: Array<{
            steamId: string;
            name: string;
            avatar: string | null;
            rating: number | null;
            role: 'owner' | 'captain' | 'member';
            position: string | null;
            lineup: 'starter' | 'sub';
            matches: number;
            kd: number | null;
            adr: number | null;
            monthDelta: number | null;
          }>;
        } & TeamProfileNumbers
      >(`/api/team-directory/${encodeURIComponent(teamId)}/profile`)
      .then((res) => {
        if (cancelled) return;
        setLogoUrl(res.team?.logoUrl ?? null);
        setBannerUrl(res.team?.bannerUrl ?? null);
        setRecentMatches(res.recentMatches ?? []);
        setTeamGame(
          res.team?.game ? { slug: res.team.game, name: res.team.gameName ?? res.team.game } : null
        );
        setNumbers({
          rating: res.rating,
          record: res.record,
          rounds: res.rounds,
          monthDelta: res.monthDelta,
          trophies: res.trophies,
        });
        setMembers(
          res.members.map((m) => ({
            steamId: m.steamId,
            name: m.name,
            avatar: m.avatar ?? undefined,
            elo: m.rating ?? undefined,
            role: m.role,
            position: m.position,
            lineup: m.lineup,
            matches: m.matches,
            kd: m.kd,
            adr: m.adr,
            monthDelta: m.monthDelta,
          }))
        );
      })
      .catch(() => undefined);
    if (playerSteamId) {
      api
        .get<{
          success: boolean;
          accountUid: string;
          owned: Array<{ id: string }>;
          memberOf: Array<{ id: string; role: 'captain' | 'member' }>;
        }>('/api/team-directory/mine')
        .then((res) => {
          if (cancelled) return;
          const role = res.owned.some((o) => o.id === teamId)
            ? 'owner'
            : res.memberOf.find((m) => m.id === teamId)?.role;
          setOwn(role ? { role, uid: res.accountUid } : null);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [teamId, playerSteamId]);

  const ownActions = own ? (
    <>
      <TeamDiscordLink teamId={teamId ?? ''} />
      {own.role === 'member' ? (
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
      )}
    </>
  ) : undefined;

  // The team's game is its tournament's, else the one it plays (or last played).
  const integration = useIntegration(tournament?.game ?? teamGame?.slug);
  const MemberStatus = integration.rosterMemberStatus;

  const positionLabel = integration.teamPositions
    ? (position: string) =>
        t(`teamPositions.${position}`, { ns: integration.id, defaultValue: position })
    : undefined;
  const playingNow = hasMatch && (match?.status === 'live' || match?.status === 'loaded');

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
            bannerUrl={bannerUrl}
            players={members ? members.length : team?.players?.length}
            owner={members?.find((m) => m.role === 'owner')?.name ?? null}
            rating={numbers?.rating ?? null}
            actions={ownActions}
            game={
              tournament?.game && tournament.gameName
                ? { slug: tournament.game, name: tournament.gameName }
                : teamGame
            }
          />

          {playingNow && teamId && (
            <Panel
              data-testid="team-profile-playing-now"
              sx={{
                mt: 3,
                px: 2.5,
                py: 1.75,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <LiveChip label={t('teamProfile.playingNow')} />
              <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>
                {tournament?.name}
                {tournament?.name && match?.opponent?.name ? ' · ' : null}
                {match?.opponent?.name
                  ? versusLine(
                      t,
                      'teamProfile.tournaments.versus',
                      'opponent',
                      <OpponentName id={match.opponent.id} name={match.opponent.name} />
                    )
                  : null}
              </Typography>
              <Button
                variant="contained"
                size="small"
                component={RouterLink}
                to={match?.slug ? matchPagePath(match.slug) : paths.matchNow}
                data-testid="team-profile-watch-match"
              >
                {t('teamProfile.watchMatch')}
              </Button>
            </Panel>
          )}

          {/* The next match, before it is live: a link to its match room (the veto is there). */}
          {!playingNow && teamId && (
            <Box sx={{ mt: 3 }}>
              <NextMatchCard teamId={teamId} />
            </Box>
          )}

          {/* The game module's part of the team page: an admin control (manual
              reporting: captains), or a notice while the module is missing or loading. */}
          {teamId && (
            <Box sx={{ mt: 3, display: 'grid', gap: 2 }}>
              {/* Says "missing" or, while it may still arrive, "loading". */}
              <ModuleNotInstalledNotice integration={matchIntegration} />
              {TeamAdminPanel && <TeamAdminPanel teamId={teamId} />}
            </Box>
          )}

          {numbers && <TeamStatStrip numbers={numbers} />}

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
              <RosterList
                players={members ?? team?.players ?? []}
                MemberStatus={MemberStatus}
                positionLabel={positionLabel}
              />
            </Box>

            {/* Each game's own numbers for the team (CS2: map strength). */}
            {teamId && gameViews.map((View, i) => <View key={i} teamId={teamId} />)}

            <Box component="section" aria-labelledby="team-matches">
              <SectionHead id="team-matches" title={t('teamProfile.matches.title')} />
              <TeamRecentMatches matches={recentMatches} />
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
            navigate(paths.communityTeams);
          } catch (err) {
            setLeaveError(apiErrorMessage(err, t('teamProfile.leaveFailed')));
          }
        }}
      />
    </Box>
  );
}
