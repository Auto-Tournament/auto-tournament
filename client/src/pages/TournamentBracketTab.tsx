import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import BracketsViewerVisualization from '../components/visualizations/BracketsViewerVisualization';
import SwissView from '../components/visualizations/SwissView';
import { ChampionBanner } from '../components/tournament/ChampionBanner';
import { BracketResults } from '../components/tournament/results/BracketResults';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty, TabError, TabLoading } from '../components/tournament/page/TabState';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { matchPagePath, tournamentTabPath } from '../paths';
import { CardBracket } from '../components/tournament/page/CardBracket';
import { GroupTables, type GroupStandingSet } from '../components/tournament/GroupTables';
import { fontDisplay, tokens } from '../theme/tokens';
import type { Match, Tournament } from '../types';

/**
 * The tournament page's Bracket tab: the same bracket, Swiss or round robin
 * view the admins see, read-only, from the public bracket route. A shuffle
 * tournament has no bracket tree: its teams change every round, so the tab
 * points at Matches and Standings instead.
 */
export default function TournamentBracketTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tournament, viewerTeam } = useTournamentPage();
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
      {tournament.type === 'groups' ? (
        <GroupsBracket
          matches={bracket.matches}
          groups={bracket.groupStandings}
          tournament={tournament}
          teams={
            new Map((bracket.tournament?.teams ?? tournament.teams ?? []).map((tm) => [tm.id, tm]))
          }
          viewerTeamId={viewerTeam?.id ?? null}
        />
      ) : tournament.type === 'swiss' ? (
        <SwissView
          onMatchClick={(m) => m.slug && navigate(matchPagePath(m.slug))}
          matches={bracket.matches}
          teams={bracket.tournament?.teams ?? tournament.teams ?? []}
          standings={bracket.swissStandings}
          totalRounds={bracket.totalRounds}
        />
      ) : tournament.type === 'single_elimination' || tournament.type === 'double_elimination' ? (
        <CardBracket
          matches={bracket.matches}
          tournamentType={tournament.type}
          format={tournament.format}
          yourTeamId={viewerTeam?.id ?? null}
        />
      ) : (
        <BracketsViewerVisualization
          onMatchClick={(m) => m.slug && navigate(matchPagePath(m.slug))}
          matches={bracket.matches}
          tournamentType={tournament.type}
          rankingTeamIds={bracket.roundRobinStandings.map((standing) => standing.teamId)}
        />
      )}
      <BracketResults
        matches={bracket.matches}
        tournamentId={tournament.id}
        yourTeamId={viewerTeam?.id ?? null}
      />
    </Box>
  );
}

/**
 * Groups, then playoffs: the group tables, then the playoffs as a bracket
 * (its rounds numbered from one; empty slots until the groups are played).
 */
function GroupsBracket({
  matches,
  groups,
  tournament,
  teams,
  viewerTeamId,
}: {
  matches: Match[];
  groups: GroupStandingSet[];
  tournament: Tournament;
  teams: Map<string, { name: string; tag?: string }>;
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const settings = (tournament.settings ?? {}) as {
    advancePerGroup?: number;
    playoffType?: string;
    playoffFormat?: string;
  };
  const playoffs = matches.filter((m) => /(^|-)po-/.test(m.slug ?? ''));
  const offset = Math.min(...playoffs.map((m) => m.round)) - 1;
  const renumbered = playoffs.map((m) => ({ ...m, round: m.round - offset }));
  const started = playoffs.some((m) => m.team1 || m.team2);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <GroupTables
        groups={groups}
        teams={teams}
        advancePerGroup={Number(settings.advancePerGroup) === 2 ? 2 : 1}
        viewerTeamId={viewerTeamId}
      />
      <Box
        component="section"
        aria-labelledby="groups-playoffs"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography
          id="groups-playoffs"
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
        >
          {t('groups.playoffs')}
        </Typography>
        {!started && (
          <Typography sx={{ color: tokens.color.muted }}>{t('groups.playoffsSoon')}</Typography>
        )}
        {renumbered.length > 0 && (
          <CardBracket
            matches={renumbered}
            tournamentType={
              settings.playoffType === 'double_elimination'
                ? 'double_elimination'
                : 'single_elimination'
            }
            format={settings.playoffFormat ?? tournament.format}
            yourTeamId={viewerTeamId}
          />
        )}
      </Box>
    </Box>
  );
}
