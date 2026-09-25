import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import BracketsViewerVisualization from '../components/visualizations/BracketsViewerVisualization';
import SwissView from '../components/visualizations/SwissView';
import { ChampionBanner } from '../components/tournament/ChampionBanner';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty, TabError, TabLoading } from '../components/tournament/page/TabState';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { tournamentTabPath } from '../paths';

/**
 * The tournament page's Bracket tab: the same bracket, Swiss or round robin
 * view the admins see, read-only, from the public bracket route. A shuffle
 * tournament has no bracket tree: its teams change every round, so the tab
 * points at Matches and Standings instead.
 */
export default function TournamentBracketTab() {
  const { t } = useTranslation();
  const { tournament } = useTournamentPage();
  const bracket = usePublicBracket(tournament.id);

  if (bracket.loading) return <TabLoading label={t('overviewPage.loading')} />;
  if (bracket.error) return <TabError message={t('overviewPage.bracketTab.loadError')} />;

  if (tournament.type === 'shuffle') {
    return (
      <TabEmpty
        title={t('overviewPage.bracketTab.shuffleTitle')}
        description={t('overviewPage.bracketTab.shuffleDescription')}
        data-testid="public-bracket-shuffle"
      >
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournament.id, 'matches')}
            variant="outlined"
            size="small"
          >
            {t('overviewPage.tabs.matches')}
          </Button>
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournament.id, 'standings')}
            variant="outlined"
            size="small"
          >
            {t('overviewPage.tabs.standings')}
          </Button>
        </Stack>
      </TabEmpty>
    );
  }

  if (bracket.matches.length === 0) {
    return (
      <TabEmpty
        title={t('overviewPage.bracketTab.emptyTitle')}
        description={t('overviewPage.bracketTab.emptyDescription')}
        data-testid="public-bracket-empty"
      />
    );
  }

  return (
    <Box data-testid="public-bracket">
      {bracket.tournament && (
        <Box sx={{ mb: 3 }}>
          <ChampionBanner tournament={bracket.tournament} />
        </Box>
      )}
      {tournament.type === 'swiss' ? (
        <SwissView
          matches={bracket.matches}
          teams={bracket.tournament?.teams ?? tournament.teams ?? []}
          standings={bracket.swissStandings}
          totalRounds={bracket.totalRounds}
        />
      ) : (
        <BracketsViewerVisualization
          matches={bracket.matches}
          tournamentType={tournament.type}
          rankingTeamIds={bracket.roundRobinStandings.map((standing) => standing.teamId)}
        />
      )}
    </Box>
  );
}
