import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Stack,
  Button,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { TeamHeader } from '../components/team/TeamHeader';
import { CurrentMatchDisplayCard } from '../components/team/CurrentMatchDisplayCard';
import { TeamStatsCard } from '../components/team/TeamStatsCard';
import { TeamMatchHistoryCard } from '../components/team/TeamMatchHistory';
import { PlayerRosterCard } from '../components/team/PlayerRosterCard';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentStatus } from '../hooks/useTournamentStatus';
import { TournamentRulesAccordion } from '../components/tournament/TournamentRulesAccordion';
import { useAuth } from '../contexts/AuthContext';
import { TopNavBar } from '../components/layout/TopNavBar';
import { useTranslation } from 'react-i18next';
import { getTeamProfileUrl } from '../utils/teamLinks';
import { integrationFor } from '../integrations/registry';
import { ModuleNotInstalledNotice } from '../components/common/ModuleNotInstalledNotice';

export default function TeamMatch() {
  const { teamId } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const {
    team,
    match,
    hasMatch,
    matchHistory,
    stats,
    standing,
    loading,
    error,
    tournamentStatus,
  } = useTeamMatchData(teamId);
  const { tournament } = useTournamentStatus();
  const tournamentName = tournament?.name ?? null;
  const { playerSteamId } = useAuth();

  const matchFormat = (match?.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1';

  // Game-specific parts of this page (3.0 phase D, PR D7). Resolved from the
  // match, falling back to the tournament so a team with no match right now
  // still gets them. CS2 fills neither slot, so nothing is rendered for it.
  const integration = integrationFor(match ?? tournament);
  const ReportPanel = integration.matchPanels.reportView;
  const TeamAdminPanel = integration.teamAdminPanel;

  /**
   * The match the report panel is about: the current one, the last one this
   * page saw, or the last one this team finished.
   *
   * The fallbacks are not a nicety. This page only ever shows a *live or
   * upcoming* match, and answering a report moves the match straight out of
   * that set — a confirm completes it, a dispute parks it as `needs_decision`.
   * With `match` alone the card a captain had just acted on vanished the
   * instant their answer landed, leaving nothing to say what happened; after a
   * dispute, with no completed match to fall back to, neither side could see
   * that the match was now waiting on an admin.
   *
   * The panel refuses a match it has no business showing (404 for one that is
   * gone, 409 for one another game owns), so a stale slug costs nothing.
   */
  // Adjusted during render rather than in an effect, so the panel never blinks
  // out for a frame between the match going and the remembered slug arriving.
  const [lastSeenSlug, setLastSeenSlug] = useState<string | null>(null);
  if (match?.slug && match.slug !== lastSeenSlug) setLastSeenSlug(match.slug);
  const reportSlug = match?.slug ?? lastSeenSlug ?? matchHistory[0]?.slug ?? null;

  useEffect(() => {
    if (team?.name) {
      document.title = team.name;
    } else {
      document.title = t('teamPage.pageTitle');
    }
  }, [team, t]);

  const getRoundLabel = (round: number) => {
    if (round === 1) return t('rounds.round1');
    if (round === 2) return t('rounds.round2');
    if (round === 3) return t('rounds.quarterfinals');
    if (round === 4) return t('rounds.semifinals');
    if (round === 5) return t('rounds.finals');
    return t('rounds.roundN', { n: round });
  };

  const rulesFormat = matchFormat;
  const rulesMaxRounds = match?.config?.maxRounds ?? tournament?.maxRounds;
  const rulesOvertimeMode = match?.config?.overtimeMode ?? tournament?.overtimeMode;
  const rulesOvertimeSegments = match?.config?.overtimeSegments ?? tournament?.overtimeSegments;

  if (loading) {
    return (
      <Box
        minHeight="100vh"
        display="flex"
        flexDirection="column"
        bgcolor="transparent"
      >
        <TopNavBar />
        <Box flex={1} display="flex" alignItems="center" justifyContent="center">
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="md">
          <Box py={6}>
            <Alert severity="error">{error}</Alert>
          </Box>
        </Container>
      </Box>
    );
  }

  const tournamentIsActive = tournamentStatus === 'in_progress';
  const tournamentIsCompleted = tournamentStatus === 'completed';
  const teamHasPlayed = !!(stats && stats.totalMatches > 0);

  if (!hasMatch) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="md">
          <Stack spacing={3} py={6}>
            <TeamHeader team={team} hideSoundControls />
            {teamId && (
              <Box display="flex" justifyContent="flex-end">
                <Button
                  size="small"
                  variant="text"
                  component={RouterLink}
                  to={getTeamProfileUrl(teamId)}
                  data-testid="team-match-view-profile-link"
                >
                  {t('teamPage.viewTeamProfile')}
                </Button>
              </Box>
            )}

            {playerSteamId && (
              <Card>
                <CardContent
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('teamPage.wantYourStats')}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    component={RouterLink}
                    to={`/player/${playerSteamId}`}
                  >
                    {t('teamPage.openMyPlayerPage')}
                  </Button>
                </CardContent>
              </Card>
            )}

            <TournamentRulesAccordion
              format={rulesFormat}
              maxRounds={rulesMaxRounds}
              overtimeMode={rulesOvertimeMode}
              overtimeSegments={rulesOvertimeSegments}
            />

            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <SportsEsportsIcon
                  sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }}
                />
                {tournamentIsCompleted ? (
                  <>
                    <Typography variant="h6" color="text.primary" mt={1} gutterBottom>
                      {t('teamPage.tournamentFinished')}
                    </Typography>
                    {teamHasPlayed && standing && (
                      <Typography variant="body1" color="text.secondary" mt={1}>
                        {t('teamPage.finalPlacement', {
                          position: standing.position,
                          total: standing.totalTeams,
                        })}
                      </Typography>
                    )}
                  </>
                ) : tournamentIsActive ? (
                  <>
                    <Typography variant="body1" color="text.secondary" mt={2}>
                      {t('teamPage.noMatchNow')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {t('teamPage.noMatchNowHint')}
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="body1" color="text.secondary" mt={2}>
                      {t('teamPage.noMatchesYet')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {t('teamPage.noMatchesYetHint')}
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>

            {reportSlug && ReportPanel && (
              <ReportPanel matchSlug={reportSlug} matchStatus={match?.status} />
            )}

            <PlayerRosterCard team={team} />
            {TeamAdminPanel && teamId && <TeamAdminPanel teamId={teamId} />}
            <TeamStatsCard stats={stats} standing={standing} />
            <TeamMatchHistoryCard matchHistory={matchHistory} teamId={teamId} />
          </Stack>
        </Container>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" bgcolor="transparent">
      <TopNavBar />
      <Container maxWidth="md">
        <Box py={6}>
          <Stack spacing={3}>
            {tournamentName && (
              <Typography
                component="h1"
                variant="h3"
                fontWeight={800}
                textAlign="center"
                color="text.primary"
              >
                {tournamentName}
              </Typography>
            )}

            <TeamHeader team={team} hideSoundControls />
            {teamId && (
              <Box display="flex" justifyContent="flex-end">
                <Button
                  size="small"
                  variant="text"
                  component={RouterLink}
                  to={getTeamProfileUrl(teamId)}
                  data-testid="team-match-view-profile-link"
                >
                  {t('teamPage.viewTeamProfile')}
                </Button>
              </Box>
            )}

            <TournamentRulesAccordion
              format={rulesFormat}
              maxRounds={rulesMaxRounds}
              overtimeMode={rulesOvertimeMode}
              overtimeSegments={rulesOvertimeSegments}
            />

            {match && (
              <CurrentMatchDisplayCard
                match={match}
                team={team}
                getRoundLabel={getRoundLabel}
                playerSteamId={playerSteamId}
                labels={{
                  title: t('teamPage.currentMatch'),
                  versus: t('teamPage.versus'),
                  goToPlayerPage: t('teamPage.goToPlayerPage'),
                  manualMatch: t('teamPage.manualMatch'),
                }}
              />
            )}

            <ModuleNotInstalledNotice integration={integration} />

            {reportSlug && ReportPanel && (
              <ReportPanel matchSlug={reportSlug} matchStatus={match?.status} />
            )}

            <PlayerRosterCard team={team} />
            {TeamAdminPanel && teamId && <TeamAdminPanel teamId={teamId} />}
            <TeamStatsCard stats={stats} standing={standing} />
            <TeamMatchHistoryCard matchHistory={matchHistory} teamId={teamId} />
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
