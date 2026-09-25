import { useCallback, useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Alert,
  CircularProgress,
  Container,
  Stack,
  Button,
  Chip,
  Typography,
} from '@mui/material';
import { MatchInfoCard } from '../components/team/MatchInfoCard';
import { useTeamMatchData } from '../hooks/useTeamMatchData';
import { useTournamentStatus } from '../hooks/useTournamentStatus';
import { TopNavBar } from '../components/layout/TopNavBar';
import { useTranslation } from 'react-i18next';
import { useRoundLabel } from '../hooks/useRoundLabel';
import { getTeamProfileUrl } from '../utils/teamLinks';
import { pageTitle } from '../utils/pageTitle';
import { useIntegrationFor } from '../integrations/registry';
import { LiveChip, PageHead, Panel } from '../components/common/ui';
import { fontDisplay, textSize, tokens } from '../theme/tokens';
import {
  ModuleNotInstalledNotice,
  ModulePendingNotice,
} from '../components/common/ModuleNotInstalledNotice';

/**
 * The team's match page (`/team/:teamId`): the match it plays now or next,
 * and how to play it — the pre-match phase (CS2: the map veto), the server
 * and connect, and reporting the result where the game cannot. Home's "Open
 * match" and the tournament's "Your team" land here.
 *
 * The next match is the drafts' next-match card: status, "Team vs Opponent",
 * and where it is played. The roster, stats and history are the team
 * profile's (`/t/team/:teamId`), which the header links to.
 */
export default function TeamMatch() {
  const { teamId } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const {
    team,
    match,
    hasMatch,
    matchHistory,
    standing,
    loading,
    error,
    tournamentStatus,
    loadTeamMatch,
  } = useTeamMatchData(teamId);
  const { tournament } = useTournamentStatus();
  const tournamentName = tournament?.name ?? null;
  const getRoundLabel = useRoundLabel();

  const matchFormat = (match?.matchFormat as 'bo1' | 'bo3' | 'bo5') || 'bo1';

  // Game-specific parts of this page (3.0 phase D, PR D7). Resolved from the
  // match, falling back to the tournament so a team with no match right now
  // still gets them. CS2 fills neither slot, so nothing is rendered for it.
  const integration = useIntegrationFor(match ?? tournament);
  const ReportPanel = integration.matchPanels.reportView;
  const TeamAdminPanel = integration.teamAdminPanel;
  // The match card below is the module's pre-match phase and connect panel;
  // a game with neither (manual reporting) has only the report panel.
  const playsThroughModule = Boolean(integration.preMatchView || integration.matchPanels.teamView);

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
    document.title = pageTitle(
      team?.name ? t('teamPage.pageTitleFor', { name: team.name }) : t('teamPage.pageTitle')
    );
  }, [team, t]);

  // The pre-match phase is over: read the match again once the API has
  // settled what it decided.
  const handleVetoComplete = useCallback(() => {
    window.setTimeout(() => {
      void loadTeamMatch(true);
    }, 1000);
  }, [loadTeamMatch]);

  if (loading) {
    return (
      <Box minHeight="100vh" display="flex" flexDirection="column" bgcolor="transparent">
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
        <Container maxWidth="lg">
          <Box py={6}>
            <Alert severity="error">{error}</Alert>
          </Box>
        </Container>
      </Box>
    );
  }

  const showMatch = hasMatch && !!match;
  const isLive = showMatch && (match.status === 'live' || match.status === 'loaded');
  const statusLabel = showMatch
    ? t(`home.matchStatus.${match.status}`, { defaultValue: match.status })
    : '';
  const roundLabel = showMatch
    ? match.round === 0
      ? t('teamPage.manualMatch')
      : getRoundLabel(match.round)
    : null;

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="team-match-page">
      <TopNavBar />
      <Container maxWidth="lg">
        <Box sx={{ py: { xs: 4, md: 6 } }}>
          <PageHead
            eyebrow={tournamentName ?? undefined}
            title={
              <>
                {team?.tag && (
                  <Box
                    component="span"
                    sx={{ color: tokens.color.accent, fontSize: '0.6em', mr: 1.5 }}
                  >
                    [{team.tag}]
                  </Box>
                )}
                {team?.name ?? t('teamPage.pageTitle')}
              </>
            }
            actions={
              teamId ? (
                <Button
                  size="small"
                  variant="outlined"
                  component={RouterLink}
                  to={getTeamProfileUrl(teamId)}
                  data-testid="team-match-view-profile-link"
                >
                  {t('teamPage.viewTeamProfile')}
                </Button>
              ) : undefined
            }
          />

          <Stack spacing={3}>
            {showMatch ? (
              <>
                {/* The next match (the drafts' next-match card). */}
                <Panel
                  component="section"
                  aria-label={t('teamPage.currentMatch')}
                  data-testid="team-match-next"
                  sx={{
                    borderColor: tokens.color.accent,
                    px: { xs: 2.5, md: 4 },
                    py: 3,
                  }}
                >
                  {isLive ? (
                    <LiveChip label={statusLabel} />
                  ) : (
                    <Chip size="small" label={statusLabel} />
                  )}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                      columnGap: 1.5,
                      mt: 1,
                    }}
                  >
                    <Typography
                      component="strong"
                      sx={{
                        fontFamily: fontDisplay,
                        fontWeight: 700,
                        fontSize: textSize['2xl'],
                        letterSpacing: '-0.03em',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {team?.name}
                    </Typography>
                    <Typography component="span" sx={{ color: tokens.color.muted }}>
                      {t('teamPage.versus')}
                    </Typography>
                    <Typography
                      component="strong"
                      sx={{
                        fontFamily: fontDisplay,
                        fontWeight: 700,
                        fontSize: textSize['2xl'],
                        letterSpacing: '-0.03em',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {match.opponent?.name ?? t('home.tbd')}
                    </Typography>
                  </Box>
                  <Typography sx={{ color: tokens.color.ink2, fontSize: textSize.sm, mt: 0.5 }}>
                    {[tournamentName, roundLabel, matchFormat.toUpperCase()]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Panel>

                <ModuleNotInstalledNotice integration={integration} />

                {/* Veto, server and connect: the game module's, by slug. */}
                {playsThroughModule && (
                  <MatchInfoCard
                    match={match}
                    team={team}
                    tournamentStatus={tournamentStatus}
                    vetoCompleted={match.veto?.status === 'completed'}
                    matchFormat={matchFormat}
                    onVetoComplete={handleVetoComplete}
                    getRoundLabel={getRoundLabel}
                  />
                )}
              </>
            ) : (
              <>
                <Panel data-testid="team-match-none" sx={{ px: 3, py: 3 }}>
                  <Typography fontWeight={600}>
                    {tournamentStatus === 'completed'
                      ? t('teamPage.tournamentFinished')
                      : tournamentStatus === 'in_progress'
                        ? t('teamPage.noMatchNow')
                        : t('teamPage.noMatchesYet')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {tournamentStatus === 'completed'
                      ? standing
                        ? t('teamPage.finalPlacement', {
                            position: standing.position,
                            total: standing.totalTeams,
                          })
                        : null
                      : tournamentStatus === 'in_progress'
                        ? t('teamPage.noMatchNowHint')
                        : t('teamPage.noMatchesYetHint')}
                  </Typography>
                </Panel>

                {/* Its slots are empty while its module may still be loading: say so. */}
                <ModulePendingNotice integration={integration} />
              </>
            )}

            {reportSlug && ReportPanel && (
              <ReportPanel matchSlug={reportSlug} matchStatus={match?.status} />
            )}

            {TeamAdminPanel && teamId && <TeamAdminPanel teamId={teamId} />}
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
