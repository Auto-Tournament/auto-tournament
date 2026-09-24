import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Row, RowList } from '../components/common/ui';
import { GameMark } from '../components/common/GameMark';
import { TeamNameLink } from '../components/team/TeamNameLink';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty } from '../components/tournament/page/TabState';
import { tournamentTabPath } from '../paths';
import { tokens, textSize, fontMono } from '../theme/tokens';

const { color } = tokens;

/**
 * The tournament page's Teams tab: every team entered, in seed order, with
 * its record so far. A team's name opens its public profile. Shuffle
 * tournaments draw new teams every round, so they list players on Standings
 * instead.
 */
export default function TournamentTeamsTab() {
  const { t } = useTranslation();
  const { tournament, teams: standings, viewerTeam } = useTournamentPage();

  if (tournament.type === 'shuffle') {
    return (
      <TabEmpty
        title={t('overviewPage.teamsTab.shuffleTitle')}
        description={t('overviewPage.teamsTab.shuffleDescription')}
        data-testid="public-teams-shuffle"
      >
        <Box sx={{ mt: 1 }}>
          <Button
            component={RouterLink}
            to={tournamentTabPath(tournament.id, 'standings')}
            variant="outlined"
            size="small"
          >
            {t('overviewPage.tabs.standings')}
          </Button>
        </Box>
      </TabEmpty>
    );
  }

  const byId = new Map((tournament.teams ?? []).map((team) => [team.id, team]));
  const recordById = new Map(standings.map((standing) => [standing.teamId, standing]));
  const teams = tournament.teamIds
    .map((id) => byId.get(id))
    .filter((team): team is NonNullable<typeof team> => !!team);

  if (teams.length === 0) {
    return (
      <TabEmpty
        title={t('overviewPage.teamsTab.emptyTitle')}
        description={t('overviewPage.teamsTab.emptyDescription')}
        data-testid="public-teams-empty"
      />
    );
  }

  const played = tournament.status !== 'setup' && tournament.status !== 'ready';

  return (
    <RowList data-testid="public-teams" aria-label={t('overviewPage.tabs.teams')}>
      {teams.map((team, index) => {
        const record = recordById.get(team.id);
        const isViewers = viewerTeam?.id === team.id;
        return (
          <Row
            key={team.id}
            data-testid={`public-team-${team.id}`}
            columns="2.25rem auto minmax(0, 1fr) auto"
          >
            <Box sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}>
              #{index + 1}
            </Box>
            <GameMark name={team.tag || team.name} slug={team.id} size={32} />
            <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TeamNameLink teamId={team.id} name={team.name} noWrap sx={{ fontWeight: 600 }} />
              {team.tag && (
                <Box
                  component="span"
                  sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.muted }}
                >
                  {team.tag}
                </Box>
              )}
              {isViewers && <Chip size="small" label={t('overviewPage.teamsTab.yours')} />}
            </Box>
            <Box
              sx={{
                fontFamily: fontMono,
                fontSize: textSize.sm,
                color: color.ink2,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {played && record
                ? t('overviewPage.teamsTab.record', {
                    wins: record.matchWins ?? 0,
                    losses: record.matchLosses ?? 0,
                  })
                : null}
            </Box>
          </Row>
        );
      })}
    </RowList>
  );
}
