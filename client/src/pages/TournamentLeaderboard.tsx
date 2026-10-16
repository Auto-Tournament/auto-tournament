import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { GroupTables } from '../components/tournament/GroupTables';
import { api } from '../utils/api';
import { TabEmpty, TabLoading } from '../components/tournament/page/TabState';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { useIntegrationFor } from '../integrations/registry';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { PlayersLeaderboard } from '../components/tournament/overview/PlayersLeaderboard';
import {
  ChampionHero,
  SectionTitle,
  TeamLogo,
  panel,
  tableTh,
  tableTd,
  tableOptional,
} from '../components/tournament/ui/draftUi';
import type { Match, Tournament } from '../types';
import { tokens, textSize } from '../theme/tokens';

const { color } = tokens;

interface TeamLeaderboardEntry {
  teamId: string;
  name: string;
  tag?: string | null;
  matchWins: number;
  matchLosses: number;
  matchCount: number;
  winRate: number;
  rank?: number;
  buchholz?: number;
  roundDiff?: number;
}

interface TournamentLeaderboardData {
  tournament: Pick<Tournament, 'id' | 'name' | 'status' | 'type' | 'game'>;
  leaderboard: unknown[];
  teams?: TeamLeaderboardEntry[];
  currentRound: number;
  totalRounds: number;
}

type Row = {
  id: string;
  name: string;
  tag?: string | null;
  wins: number;
  losses: number;
  roundsWon?: number;
  roundsLost?: number;
  diff?: number;
  buchholz?: number;
  form: Array<'W' | 'L'>;
  out?: boolean;
};

/** Each team's last five results, oldest first. */
function formOf(matches: Match[], teamId: string): Array<'W' | 'L'> {
  return matches
    .filter(
      (m) =>
        m.status === 'completed' &&
        m.winner?.id &&
        (m.team1?.id === teamId || m.team2?.id === teamId)
    )
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || a.round - b.round)
    .slice(-5)
    .map((m) => (m.winner?.id === teamId ? 'W' : 'L'));
}

/**
 * The tournament page's Standings tab (the drafts' Standings board): the
 * champions once it is over, the table with what the format ranks on and each
 * team's form, the game's own numbers when it has any, and every player.
 */
export default function TournamentLeaderboard() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { viewerTeam } = useTournamentPage();
  const [data, setData] = useState<TournamentLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bracket = usePublicBracket(id);
  const gameIntegration = useIntegrationFor(data?.tournament);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .get<TournamentLeaderboardData>(`/api/tournament/${id}/leaderboard`)
      .then((res) => live && setData(res ?? null))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        if (!live) return;
        if (message.includes('404') || message.toLowerCase().includes('not found')) setData(null);
        else setError(t('leaderboardPage.loadError'));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, t]);

  if (loading || bracket.loading) return <TabLoading label={t('overviewPage.loading')} />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) {
    return (
      <Box data-testid="public-leaderboard-page">
        <TabEmpty
          title={t('leaderboardPage.emptyTitle')}
          description={t('leaderboardPage.emptyDescription')}
        />
      </Box>
    );
  }

  const tournament = { ...data.tournament, ...(bracket.tournament ?? {}) } as Tournament;
  const showGameStats = gameIntegration.capabilities.playerStats;
  const GameStatsView = gameIntegration.tournamentStatsView;
  const isShuffle = tournament.type === 'shuffle';
  const matches = bracket.matches;
  const teamsById = new Map((tournament.teams ?? []).map((tm) => [tm.id, tm]));

  let rows: Row[] = [];
  let note = '';
  let intro = '';
  if (!isShuffle) {
    if (tournament.type === 'round_robin' && bracket.roundRobinStandings.length) {
      rows = bracket.roundRobinStandings.map((s) => ({
        id: s.teamId,
        name: teamsById.get(s.teamId)?.name ?? s.teamId,
        tag: teamsById.get(s.teamId)?.tag,
        wins: s.wins,
        losses: s.losses,
        roundsWon: s.roundsWon,
        roundsLost: s.roundsWon - s.roundDiff,
        diff: s.roundDiff,
        form: formOf(matches, s.teamId),
      }));
      intro = t('standingsTab.intro.round_robin');
      note = t('liveOverview.ties.round_robin');
    } else if (tournament.type === 'swiss' && bracket.swissStandings.length) {
      rows = bracket.swissStandings.map((s) => ({
        id: s.teamId,
        name: teamsById.get(s.teamId)?.name ?? s.teamId,
        tag: teamsById.get(s.teamId)?.tag,
        wins: s.wins,
        losses: s.losses,
        diff: s.roundDiff,
        buchholz: s.buchholz,
        form: formOf(matches, s.teamId),
      }));
      intro = t('standingsTab.intro.swiss');
      note = t('liveOverview.ties.swiss');
    } else {
      const lossesOut = tournament.type === 'double_elimination' ? 2 : 1;
      rows = (data.teams ?? [])
        .map((tm) => ({
          id: tm.teamId,
          name: tm.name,
          tag: tm.tag,
          wins: tm.matchWins,
          losses: tm.matchLosses,
          form: formOf(matches, tm.teamId),
          out: tm.matchLosses >= lossesOut && tournament.winner?.id !== tm.teamId,
        }))
        .sort((a, b) => Number(a.out) - Number(b.out) || b.wins - a.wins || a.losses - b.losses);
      intro = t(
        `standingsTab.intro.${tournament.type === 'double_elimination' ? 'double' : 'single'}`
      );
      note = t('liveOverview.ties.elim');
    }
  }

  // The final: the champion's last match, for the banner's line and picture.
  const champion = tournament.status === 'completed' ? tournament.winner : null;
  const final = champion
    ? [...matches]
        .filter((m) => m.status === 'completed' && m.winner?.id === champion.id)
        .sort((a, b) => b.round - a.round || (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
    : undefined;
  const finalMap =
    final?.mapResults?.[final.mapResults.length - 1]?.mapName ?? final?.maps?.[0] ?? null;
  const finalLine = final
    ? [
        `${t('standingsTab.vs')} ${(final.team1?.id === champion?.id ? final.team2?.name : final.team1?.name) ?? ''}`,
        ...(final.mapResults ?? []).map(
          (r) =>
            `${r.mapName ?? ''} ${Math.max(r.team1Score, r.team2Score)}–${Math.min(r.team1Score, r.team2Score)}`
        ),
      ].join(' · ')
    : undefined;

  const hasRounds = rows.some((r) => r.roundsWon !== undefined);
  const hasDiff = rows.some((r) => r.diff !== undefined);
  const hasBuchholz = rows.some((r) => r.buchholz !== undefined);
  const th = tableTh;
  const td = tableTd;
  const opt = tableOptional;

  return (
    <Box
      data-testid="public-leaderboard-page"
      sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
    >
      {champion && (
        <ChampionHero
          label={t('standingsTab.champions')}
          team={{ id: champion.id, name: champion.name, tag: champion.tag }}
          line={finalLine}
          map={finalMap}
        />
      )}

      {tournament.type === 'groups' && bracket.groupStandings.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ color: color.ink2, fontSize: '0.9375rem' }}>
            {t('standingsTab.intro.groups')}
          </Typography>
          <GroupTables
            groups={bracket.groupStandings}
            teams={teamsById}
            advancePerGroup={
              Number(
                (tournament.settings as { advancePerGroup?: number } | undefined)?.advancePerGroup
              ) === 2
                ? 2
                : 1
            }
            viewerTeamId={viewerTeam?.id ?? null}
          />
          <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
            {t('liveOverview.ties.groups')}
          </Typography>
        </Box>
      )}

      {!isShuffle && tournament.type !== 'groups' && rows.length > 0 && (
        <Box
          component="section"
          aria-labelledby="team-standings"
          data-testid="team-standings"
          sx={panel}
        >
          <SectionTitle
            id="team-standings"
            title={t('liveOverview.standings')}
            note={t('leaderboardPage.teamsCount', { count: rows.length })}
          />
          <Typography sx={{ color: color.ink2, fontSize: '0.9375rem' }}>{intro}</Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Box
              component="table"
              sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}
            >
              <thead>
                <tr>
                  <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                    #
                  </Box>
                  <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                    {t('leaderboardPage.team')}
                  </Box>
                  <Box component="th" scope="col" sx={th}>
                    {t('liveOverview.wl')}
                  </Box>
                  {hasRounds && (
                    <Box component="th" scope="col" sx={{ ...th, ...opt }}>
                      {t('standingsTab.rounds')}
                    </Box>
                  )}
                  {hasDiff && (
                    <Box component="th" scope="col" sx={th}>
                      {t('liveOverview.rounds')}
                    </Box>
                  )}
                  {hasBuchholz && (
                    <Box component="th" scope="col" sx={{ ...th, ...opt }}>
                      {t('leaderboardPage.buchholz')}
                    </Box>
                  )}
                  <Box component="th" scope="col" sx={{ ...th, ...opt }}>
                    {t('standingsTab.form')}
                  </Box>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const me = r.id === viewerTeam?.id;
                  return (
                    <Box
                      component="tr"
                      key={r.id}
                      sx={{ bgcolor: me ? color.paper3 : 'transparent', opacity: r.out ? 0.55 : 1 }}
                    >
                      <Box
                        component="td"
                        sx={{
                          ...td,
                          textAlign: 'left',
                          color: i === 0 ? color.medalGold : color.muted,
                          fontWeight: 600,
                        }}
                      >
                        {i + 1}
                      </Box>
                      <Box
                        component="td"
                        sx={{
                          ...td,
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          fontWeight: me || i === 0 ? 700 : 500,
                        }}
                      >
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                          <TeamLogo team={{ id: r.id, name: r.name, tag: r.tag }} size="sm" />
                          {r.name}
                          {champion?.id === r.id && (
                            <Box
                              component="span"
                              sx={{
                                fontSize: textSize.xs,
                                color: color.medalGold,
                                fontWeight: 700,
                              }}
                            >
                              {t('standingsTab.championBadge')}
                            </Box>
                          )}
                        </Box>
                      </Box>
                      <Box component="td" sx={td}>
                        {r.wins}–{r.losses}
                      </Box>
                      {hasRounds && (
                        <Box component="td" sx={{ ...td, ...opt, color: color.ink2 }}>
                          {r.roundsWon ?? '—'}–{r.roundsLost ?? '—'}
                        </Box>
                      )}
                      {hasDiff && (
                        <Box
                          component="td"
                          sx={{
                            ...td,
                            color:
                              (r.diff ?? 0) > 0
                                ? color.live
                                : (r.diff ?? 0) < 0
                                  ? color.ban
                                  : color.ink2,
                          }}
                        >
                          {(r.diff ?? 0) > 0 ? '+' : (r.diff ?? 0) < 0 ? '−' : ''}
                          {Math.abs(r.diff ?? 0)}
                        </Box>
                      )}
                      {hasBuchholz && (
                        <Box component="td" sx={{ ...td, ...opt }}>
                          {r.buchholz}
                        </Box>
                      )}
                      <Box
                        component="td"
                        sx={{ ...td, ...opt, letterSpacing: '0.15em' }}
                        aria-label={r.form.join(' ')}
                      >
                        {r.form.map((f, k) => (
                          <Box
                            component="span"
                            key={k}
                            sx={{ color: f === 'W' ? color.live : color.muted }}
                          >
                            {f === 'W' ? '●' : '○'}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{note}</Typography>
        </Box>
      )}

      {GameStatsView && <GameStatsView tournamentId={tournament.id} />}

      <PlayersLeaderboard
        tournamentId={tournament.id}
        viewerTeamId={viewerTeam?.id ?? null}
        gameStats={showGameStats}
        sortBy={isShuffle ? 'wins' : 'rating'}
        testId="public-leaderboard"
        title={isShuffle ? t('liveOverview.standings') : undefined}
      />
    </Box>
  );
}
