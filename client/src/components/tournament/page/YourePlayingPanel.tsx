import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match, Tournament } from '../../../types';
import type { ViewerTeam } from '../../../hooks/usePublicTournamentOverview';
import { LiveChip, Panel } from '../../common/ui';
import { useIntegrationFor } from '../../../integrations/registry';
import { teamProfilePath } from '../../../paths';
import { tokens, textSize } from '../../../theme/tokens';
import { isLiveMatch, publicMatchLabel, teamCurrentMatch, teamLastResult } from './matchHelpers';

interface YourePlayingPanelProps {
  tournament: Tournament;
  team: ViewerTeam;
  /** The tournament's matches (public bracket), to find this team's. */
  matches: Match[];
}

/**
 * "You're playing": the signed-in player's team in this tournament, where it
 * stands, and the way into its match.
 *
 * While the match is loaded or live, the game module's join panel
 * (`matchPanels.teamView`; CS2: the server and the Connect button) is shown
 * here, as on the team's match page. The module asks its own connect route
 * and shows an address only to a player on the match, so the core passes the
 * slug and nothing about servers. A game with no join panel gets the link to
 * the match page, where its result is reported.
 */
export function YourePlayingPanel({ tournament, team, matches }: YourePlayingPanelProps) {
  const { t } = useTranslation();
  const integration = useIntegrationFor(tournament);
  const ConnectPanel = integration.matchPanels.teamView;

  const current = teamCurrentMatch(matches, team.id);
  const last = current ? null : teamLastResult(matches, team.id);
  const opponent = current ? (current.team1?.id === team.id ? current.team2 : current.team1) : null;

  let chip: ReactNode;
  if (current?.status === 'live') {
    chip = <LiveChip label={t('overviewPage.yourTeam.state.live')} />;
  } else if (current?.status === 'loaded') {
    chip = <LiveChip label={t('overviewPage.yourTeam.state.loaded')} />;
  } else if (current) {
    chip = <Chip size="small" label={t('overviewPage.yourTeam.state.upNext')} />;
  } else if (tournament.status === 'completed') {
    chip = <Chip size="small" label={t('overviewPage.yourTeam.state.finished')} />;
  } else if (
    tournament.status === 'in_progress' &&
    tournament.type === 'single_elimination' &&
    last?.winner &&
    last.winner.id !== team.id
  ) {
    chip = <Chip size="small" label={t('overviewPage.yourTeam.state.eliminated')} />;
  } else if (tournament.status === 'in_progress') {
    chip = <Chip size="small" label={t('overviewPage.yourTeam.state.waiting')} />;
  } else {
    chip = <Chip size="small" label={t('overviewPage.yourTeam.state.registered')} />;
  }

  const line = current
    ? t('overviewPage.yourTeam.versus', {
        team: team.name,
        opponent: opponent?.name ?? t('overviewPage.yourTeam.tbd'),
        stage: publicMatchLabel(current, tournament),
      })
    : t('overviewPage.yourTeam.onRoster', { team: team.name });

  const showConnect = !!current && !!ConnectPanel && isLiveMatch(current);

  return (
    <Panel
      component="section"
      aria-labelledby="youre-playing-title"
      data-testid="overview-your-team"
      sx={{ p: 3, display: 'grid', gap: 2 }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="h6" component="h3" id="youre-playing-title">
          {t('overviewPage.yourTeam.title')}
        </Typography>
        {chip}
      </Box>
      <Typography
        sx={{ color: tokens.color.ink2, fontSize: textSize.sm }}
        data-testid="overview-your-team-line"
      >
        {line}
      </Typography>

      {showConnect && current && ConnectPanel && (
        <ConnectPanel matchSlug={current.slug} viewerCanJoin matchStatus={current.status} />
      )}

      {current ? (
        <Button
          component={RouterLink}
          to={`/team/${team.id}`}
          variant={showConnect ? 'outlined' : 'contained'}
          data-testid="overview-your-match"
        >
          {showConnect
            ? t('overviewPage.yourTeam.openMatch')
            : t('overviewPage.yourTeam.goToMatch')}
        </Button>
      ) : (
        <Button
          component={RouterLink}
          to={teamProfilePath(team.id)}
          variant="outlined"
          data-testid="overview-your-team-link"
        >
          {t('overviewPage.yourTeam.viewTeam')}
        </Button>
      )}
    </Panel>
  );
}
