/**
 * The Overview of a running tournament with fixed teams (the drafts' round
 * robin, Swiss, single and double elimination boards): the status hero, the
 * schedule (round cards) or the bracket, this round's matches with the earlier
 * rounds under them, the table on the side, and every player by rating.
 */
import { GroupTables, type GroupStandingSet } from '../GroupTables';
import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match, RoundRobinStanding, SwissStanding, Tournament } from '../../../types';
import { tournamentTabPath } from '../../../paths';
import { getMapDisplayName } from '../../../constants/maps';
import { textSize, tokens } from '../../../theme/tokens';
import { CardBracket } from '../page/CardBracket';
import { SectionTitle, panel } from '../ui/draftUi';
import { PlayersLeaderboard } from './PlayersLeaderboard';
import type { NextRoundEta } from '../../../hooks/usePublicBracket';
import { Hero } from './LiveHero';
import {
  MatchRow,
  NextRoundEtaLine,
  RoundStrip,
  SideTable,
  isElim,
  isLive,
  mapOf,
} from './LiveParts';

const { color } = tokens;

export function OverviewLive({
  tournament,
  matches,
  totalRounds,
  roundRobinStandings,
  swissStandings,
  groupStandings = [],
  nextRoundEta = null,
  viewerTeamId,
}: {
  tournament: Tournament;
  matches: Match[];
  totalRounds: number;
  roundRobinStandings: RoundRobinStanding[];
  swissStandings: SwissStanding[];
  /** Groups, then playoffs: each group's table. */
  groupStandings?: GroupStandingSet[];
  nextRoundEta?: NextRoundEta | null;
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const elim = isElim(tournament.type);
  const rounds = totalRounds || Math.max(0, ...matches.map((m) => m.round));
  const current = useMemo(() => {
    const open = matches.filter((m) => m.status !== 'completed').map((m) => m.round);
    return open.length ? Math.min(...open) : rounds;
  }, [matches, rounds]);
  const mine = (m: Match) =>
    !!viewerTeamId && (m.team1?.id === viewerTeamId || m.team2?.id === viewerTeamId);
  const thisRound = matches.filter((m) => m.round === current);
  const earlier = Array.from({ length: Math.max(0, current - 1) }, (_, i) => current - 1 - i)
    .map((r) => ({ r, list: matches.filter((m) => m.round === r && m.status === 'completed') }))
    .filter((g) => g.list.length);
  const roundMap = (list: Match[]) => list.map(mapOf).find(Boolean);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="overview-live">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Hero tournament={tournament} matches={matches} viewerTeamId={viewerTeamId} />
        <NextRoundEtaLine eta={nextRoundEta} />
      </Box>

      {elim ? (
        <Box
          component="section"
          aria-labelledby="overview-bracket"
          data-testid="overview-bracket"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
        >
          <SectionTitle id="overview-bracket" title={t('liveOverview.bracket')} />
          <Box sx={{ ...panel, overflowX: 'auto' }}>
            <CardBracket
              matches={matches}
              tournamentType={tournament.type}
              format={tournament.format}
              yourTeamId={viewerTeamId}
            />
          </Box>
        </Box>
      ) : (
        rounds > 0 && <RoundStrip matches={matches} totalRounds={rounds} />
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
        {!elim && (
          <Box
            component="section"
            aria-labelledby="overview-this-round"
            sx={{ ...panel, flex: '999 1 520px' }}
          >
            <SectionTitle
              id="overview-this-round"
              title={`${t('liveOverview.thisRound', { n: current })}${roundMap(thisRound) ? ` · ${getMapDisplayName(roundMap(thisRound) as string)}` : ''}`}
              note={t('liveOverview.liveCount', { count: thisRound.filter(isLive).length })}
            />
            {thisRound.map((m) => (
              <MatchRow key={m.slug} m={m} mine={mine(m)} yourTeamId={viewerTeamId} />
            ))}
            {earlier.length > 0 && (
              <>
                <Box sx={{ height: '1px', bgcolor: color.rule, my: 0.5 }} />
                <Typography
                  component="h3"
                  sx={{
                    m: 0,
                    fontSize: '0.875rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: color.muted,
                    fontWeight: 600,
                  }}
                >
                  {t('liveOverview.earlier')}
                </Typography>
                {earlier.map((g) => (
                  <Box key={g.r} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                      {t('liveOverview.round', { n: g.r })}
                      {roundMap(g.list)
                        ? ` · ${getMapDisplayName(roundMap(g.list) as string)}`
                        : ''}
                    </Typography>
                    {g.list.map((m) => (
                      <MatchRow key={m.slug} m={m} mine={mine(m)} yourTeamId={viewerTeamId} done />
                    ))}
                  </Box>
                ))}
              </>
            )}
          </Box>
        )}
        {tournament.type === 'groups' && groupStandings.length > 0 ? (
          <Box
            component="section"
            aria-labelledby="overview-groups"
            sx={{ ...panel, flex: '1 1 360px' }}
          >
            <SectionTitle id="overview-groups" title={t('liveOverview.standings')} />
            <GroupTables
              compact
              groups={groupStandings}
              teams={new Map((tournament.teams ?? []).map((tm) => [tm.id, tm]))}
              advancePerGroup={
                Number(
                  (tournament.settings as { advancePerGroup?: number } | undefined)?.advancePerGroup
                ) === 2
                  ? 2
                  : 1
              }
              viewerTeamId={viewerTeamId}
            />
          </Box>
        ) : (
          <SideTable
            tournament={tournament}
            matches={matches}
            rr={roundRobinStandings}
            swiss={swissStandings}
            viewerTeamId={viewerTeamId}
          />
        )}
      </Box>

      <PlayersLeaderboard
        tournamentId={tournament.id}
        viewerTeamId={viewerTeamId}
        limit={10}
        allTo={tournamentTabPath(tournament.id, 'standings')}
      />
    </Box>
  );
}
