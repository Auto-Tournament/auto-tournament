import { Box, Chip, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LiveChip, Row, RowList, SectionHead } from '../components/common/ui';
import { TeamNameLink } from '../components/team/TeamNameLink';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { TabEmpty, TabError, TabLoading } from '../components/tournament/page/TabState';
import {
  isLiveMatch,
  isUpcomingMatch,
  publicMatchLabel,
  seriesScore,
} from '../components/tournament/page/matchHelpers';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { compareMatchOrder } from '../utils/matchUtils';
import type { Match, Tournament } from '../types';
import { tokens, textSize, fontMono } from '../theme/tokens';

const { color } = tokens;

function MatchRow({
  match,
  tournament,
  viewerTeamId,
}: {
  match: Match;
  tournament: Tournament;
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const done = match.status === 'completed';
  const score = seriesScore(match);
  // A result set by hand can carry no score at all: the winner is still bold.
  const unscored = done && score.team1 === 0 && score.team2 === 0;
  const showScore = (done || isLiveMatch(match)) && !unscored;
  const isViewers =
    !!viewerTeamId && (match.team1?.id === viewerTeamId || match.team2?.id === viewerTeamId);

  const status =
    match.status === 'live' ? (
      <LiveChip label={t('overviewPage.matchesTab.status.live')} />
    ) : match.status === 'loaded' ? (
      <LiveChip label={t('overviewPage.matchesTab.status.loaded')} />
    ) : done ? (
      <Chip size="small" label={t('overviewPage.matchesTab.status.final')} />
    ) : (
      <Chip size="small" label={t('overviewPage.matchesTab.status.upcoming')} />
    );

  const team = (side: 'team1' | 'team2') => {
    const entry = match[side];
    const won = done && !!match.winner && entry?.id === match.winner.id;
    const lost = done && !!match.winner && !!entry && entry.id !== match.winner.id;
    return (
      <Box
        sx={{
          minWidth: 0,
          textAlign: side === 'team1' ? 'right' : 'left',
          fontWeight: won ? 600 : 400,
          color: lost ? color.muted : color.ink,
        }}
      >
        {entry ? (
          <TeamNameLink teamId={entry.id} name={entry.name} showTag={false} noWrap />
        ) : (
          <Box component="span" sx={{ color: color.muted }}>
            {t('overviewPage.yourTeam.tbd')}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Row
      data-testid={`public-match-${match.slug}`}
      columns={{
        xs: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        md: '9rem minmax(0, 1fr) auto minmax(0, 1fr) 7.5rem',
      }}
      sx={[{ px: { xs: 2, md: 3 } }, isViewers && { boxShadow: `inset 3px 0 0 ${color.accent}` }]}
    >
      <Box
        sx={{
          gridColumn: { xs: '1 / -1', md: 'auto' },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          fontFamily: fontMono,
          fontSize: textSize.xs,
          color: color.muted,
        }}
      >
        {publicMatchLabel(match, tournament)}
        <Box sx={{ display: { md: 'none' } }}>{status}</Box>
      </Box>
      {team('team1')}
      <Box
        sx={{
          fontFamily: fontMono,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          color: showScore ? color.ink : color.muted,
          whiteSpace: 'nowrap',
          px: 1,
        }}
      >
        {showScore
          ? `${score.team1} – ${score.team2}`
          : unscored
            ? '–'
            : t('overviewPage.matchesTab.vs')}
      </Box>
      {team('team2')}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>{status}</Box>
    </Row>
  );
}

function MatchSection({
  id,
  title,
  matches,
  tournament,
  viewerTeamId,
}: {
  id: string;
  title: string;
  matches: Match[];
  tournament: Tournament;
  viewerTeamId: string | null;
}) {
  if (matches.length === 0) return null;
  return (
    <Box component="section" aria-labelledby={`${id}-title`} data-testid={id}>
      <SectionHead id={`${id}-title`} title={title} />
      <RowList>
        {matches.map((match) => (
          <MatchRow
            key={match.id}
            match={match}
            tournament={tournament}
            viewerTeamId={viewerTeamId}
          />
        ))}
      </RowList>
    </Box>
  );
}

/**
 * The tournament page's Matches tab: live now, up next and results, as row
 * lists. Everyone sees it; the rows name teams and scores only (the public
 * bracket route carries nothing about servers).
 */
export default function TournamentMatchesTab() {
  const { t } = useTranslation();
  const { tournament, viewerTeam } = useTournamentPage();
  const { matches, loading, error } = usePublicBracket(tournament.id);

  if (loading) return <TabLoading label={t('overviewPage.loading')} />;
  if (error) return <TabError message={t('overviewPage.matchesTab.loadError')} />;

  const live = matches.filter(isLiveMatch).sort(compareMatchOrder);
  const upcoming = matches.filter(isUpcomingMatch).sort(compareMatchOrder);
  // Latest first: the result people come to check is the one that just ended.
  const results = matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || compareMatchOrder(b, a));

  if (live.length + upcoming.length + results.length === 0) {
    return (
      <TabEmpty
        title={t('overviewPage.matchesTab.emptyTitle')}
        description={t('overviewPage.matchesTab.emptyDescription')}
        data-testid="public-matches-empty"
      />
    );
  }

  const viewerTeamId = viewerTeam?.id ?? null;
  return (
    <Stack spacing={6} data-testid="public-matches">
      <MatchSection
        id="public-matches-live"
        title={t('overviewPage.matchesTab.live')}
        matches={live}
        tournament={tournament}
        viewerTeamId={viewerTeamId}
      />
      <MatchSection
        id="public-matches-upcoming"
        title={t('overviewPage.matchesTab.upcoming')}
        matches={upcoming}
        tournament={tournament}
        viewerTeamId={viewerTeamId}
      />
      <MatchSection
        id="public-matches-results"
        title={t('overviewPage.matchesTab.results')}
        matches={results}
        tournament={tournament}
        viewerTeamId={viewerTeamId}
      />
    </Stack>
  );
}
