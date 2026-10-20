import { OpponentName } from '../../team/MatchRowLinks';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Link, TableSortLabel, Typography } from '@mui/material';
import {
  ChartLineUpIcon,
  CoinsIcon,
  CrosshairIcon,
  EyeSlashIcon,
  FireIcon,
  HandFistIcon,
  LightningIcon,
  SkullIcon,
  StarIcon,
  TargetIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Match, Tournament } from '../../../types';
import { ChampionHero, PlayerAvatar, SectionTitle, TeamLogo, panel } from '../ui/draftUi';
import { getMapDisplayName } from '../../../constants/maps';
import type {
  OverviewPlayer,
  OverviewTeamStanding,
} from '../../../hooks/usePublicTournamentOverview';
import { tournamentAwards, type AwardKey } from '../../../utils/tournamentAwards';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import { matchPagePath, teamProfilePath, tournamentTabPath } from '../../../paths';
import { tokens, mono, radii } from '../../../theme/tokens';
import { useInstalledIntegrations } from '../../../integrations/registry';
import { fmtNum } from '../../../utils/number';

const { color } = tokens;
const SHOWN_PLAYERS = 10;

type PlayerSortKey = 'player' | 'team' | 'kd' | 'adr' | 'hs' | 'rating' | 'elo';
type SortDir = 'asc' | 'desc';
const TEXT_SORT_KEYS: PlayerSortKey[] = ['player', 'team'];

const kdRatio = (p: OverviewPlayer) => (p.kills ?? 0) / Math.max(p.deaths ?? 0, 1);
const hsRate = (p: OverviewPlayer) =>
  (p.kills ?? 0) > 0 ? (p.headshots ?? 0) / (p.kills ?? 1) : 0;

/** Numeric value a column sorts on; null sorts last in either direction. */
function sortValue(p: OverviewPlayer, key: PlayerSortKey): number | null {
  switch (key) {
    case 'kd':
      return kdRatio(p);
    case 'adr':
      return p.averageAdr || null;
    case 'hs':
      return hsRate(p);
    case 'rating':
      return typeof p.rating === 'number' ? p.rating : null;
    case 'elo':
      return p.eloChange;
    default:
      return null;
  }
}

/**
 * Players ordered for the table. Default (dir null): this tournament's
 * performance rating, then K/D, then kills (not the pre-tournament Elo the
 * API sends them in). A column sort ties back to that same order.
 */
export function sortResultsPlayers(
  players: OverviewPlayer[],
  key: PlayerSortKey | null,
  dir: SortDir
): OverviewPlayer[] {
  const byPerformance = (a: OverviewPlayer, b: OverviewPlayer) =>
    (b.rating ?? -Infinity) - (a.rating ?? -Infinity) ||
    kdRatio(b) - kdRatio(a) ||
    (b.kills ?? 0) - (a.kills ?? 0);
  const sign = dir === 'asc' ? 1 : -1;
  return [...players].sort((a, b) => {
    if (key === 'player' || key === 'team') {
      const av = key === 'player' ? a.name : (a.team?.name ?? '');
      const bv = key === 'player' ? b.name : (b.team?.name ?? '');
      // Players without a team stay at the bottom.
      if (key === 'team' && !av !== !bv) return av ? -1 : 1;
      return sign * av.localeCompare(bv) || byPerformance(a, b);
    }
    if (key) {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av === null || bv === null) {
        if (av !== bv) return av === null ? 1 : -1;
      } else if (av !== bv) {
        return sign * (av - bv);
      }
      if (key === 'kd' && (a.kills ?? 0) !== (b.kills ?? 0))
        return sign * ((a.kills ?? 0) - (b.kills ?? 0));
    }
    return byPerformance(a, b);
  });
}

const AWARD_ICON: Record<AwardKey, { icon: ReactNode; tone: string }> = {
  bestPlayer: { icon: <StarIcon size={22} />, tone: color.medalGold },
  mostClutches: { icon: <HandFistIcon size={22} />, tone: color.accent },
  mostTeamFlashes: { icon: <EyeSlashIcon size={22} />, tone: color.muted },
  mostMoney: { icon: <CoinsIcon size={22} />, tone: color.accent },
  mostKills: { icon: <SkullIcon size={22} />, tone: color.ban },
  bestAdr: { icon: <FireIcon size={22} />, tone: color.accent },
  bestHeadshots: { icon: <CrosshairIcon size={22} />, tone: color.sideT },
  mostFlashAssists: { icon: <LightningIcon size={22} />, tone: color.sideCt },
  mostUtility: { icon: <TargetIcon size={22} />, tone: color.live },
  biggestGain: { icon: <ChartLineUpIcon size={22} />, tone: color.medalGold },
};

const PLACE_COLOR = [color.medalGold, color.medalSilver, color.medalBronze];

/** Champion first, then the others by matches won (the server's order). */
export function finalStandings(
  teams: OverviewTeamStanding[],
  winnerId: string | undefined
): OverviewTeamStanding[] {
  if (!winnerId) return teams;
  const champion = teams.find((team) => team.teamId === winnerId);
  return champion ? [champion, ...teams.filter((team) => team.teamId !== winnerId)] : teams;
}

/**
 * The finished tournament's Results (board 9): the final standings and the
 * awards side by side, then every player's numbers as a table.
 */
export function TournamentResults({
  tournament,
  teams,
  players,
  matches = [],
}: {
  tournament: Tournament;
  teams: OverviewTeamStanding[];
  players: OverviewPlayer[];
  /** The tournament's matches (public bracket): the final for the banner, the latest results. */
  matches?: Match[];
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  // Modules' own part of the results (CS2: the tournament reel).
  const installed = useInstalledIntegrations();
  const sections = installed.flatMap((i) =>
    i.tournamentResultsSection ? [{ id: i.id, Section: i.tournamentResultsSection }] : []
  );
  // At the very bottom (CS2: every player's reward, folded).
  const footers = installed.flatMap((i) =>
    i.tournamentResultsFooter ? [{ id: i.id, Footer: i.tournamentResultsFooter }] : []
  );
  // The viewer's prize to pick, if they have one (CS2: "You earned a skin for 1st place").
  const pickRows = installed.flatMap((i) =>
    i.prizePickRow ? [{ id: i.id, Row: i.prizePickRow }] : []
  );
  const standings = finalStandings(teams, tournament.winner?.id);
  const awards = tournamentAwards(players);
  const hasRating = players.some((p) => typeof p.rating === 'number');
  // A shuffle keeps the server's wins-first order until a column is clicked.
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: SortDir } | null>(null);
  const ordered =
    sort || tournament.type !== 'shuffle'
      ? sortResultsPlayers(players, sort?.key ?? null, sort?.dir ?? 'desc')
      : players;
  const shown = showAll ? ordered : ordered.slice(0, SHOWN_PLAYERS);
  const toggleSort = (key: PlayerSortKey) =>
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc' }
    );
  const sortableTh = (key: PlayerSortKey, label: ReactNode, sx: object) => (
    <Box
      component="th"
      sx={sx}
      aria-sort={sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <TableSortLabel
        active={sort?.key === key}
        direction={sort?.key === key ? sort.dir : TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc'}
        onClick={() => toggleSort(key)}
        data-testid={`results-sort-${key}`}
        sx={{
          color: 'inherit',
          '&.Mui-active': { color: color.ink },
          '& .MuiTableSortLabel-icon': { color: 'inherit !important' },
        }}
      >
        {label}
      </TableSortLabel>
    </Box>
  );

  const th = {
    ...mono,
    fontSize: '0.6875rem',
    fontWeight: 500,
    color: color.muted,
    textAlign: 'right',
    p: { xs: '8px 6px', sm: '10px 12px' },
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  } as const;
  const td = {
    p: { xs: '8px 6px', sm: '10px 12px' },
    textAlign: 'right',
    ...mono,
    fontSize: '0.875rem',
    whiteSpace: 'nowrap',
  } as const;

  // The final: the champion's last match, for the banner's line and picture. By when it
  // finished, not by round: a double-elimination grand final is round 1 of its own bracket.
  const champion = tournament.winner ?? null;
  const final = champion
    ? [...matches]
        .filter((m) => m.status === 'completed' && m.winner?.id === champion.id)
        .sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0) || y.round - x.round)[0]
    : undefined;
  const finalMap =
    final?.mapResults?.[final.mapResults.length - 1]?.mapName ?? final?.maps?.[0] ?? null;
  const opponent = final ? (final.team1?.id === champion?.id ? final.team2 : final.team1) : null;
  const finalLine = final
    ? [
        t('results.wonFinal', {
          a: Math.max(
            final.team1SeriesScore ?? final.team1Score ?? 0,
            final.team2SeriesScore ?? final.team2Score ?? 0
          ),
          b: Math.min(
            final.team1SeriesScore ?? final.team1Score ?? 0,
            final.team2SeriesScore ?? final.team2Score ?? 0
          ),
          opponent: opponent?.name ?? '',
        }),
        ...(final.mapResults ?? []).map(
          (r) =>
            `${r.mapName ? getMapDisplayName(r.mapName) : ''} ${Math.max(r.team1Score, r.team2Score)}–${Math.min(r.team1Score, r.team2Score)}`
        ),
      ].join(' · ')
    : null;
  const recent = [...matches]
    .filter((m) => m.status === 'completed')
    .sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0) || y.round - x.round)
    .slice(0, 4);
  const lastRound = Math.max(0, ...matches.map((m) => m.round ?? 0));
  const isElim = /elimination/.test(tournament.type ?? '');
  // With a grand final (double elimination) only it is "the final"; the rounds of the
  // two brackets do not line up into a semifinal.
  const hasGrandFinal = matches.some((m) => m.bracket === 'GF');
  const stageOf = (m: Match) => {
    if (m.bracket === 'GF') return t('results.stage.final');
    if (isElim && !hasGrandFinal && m.round === lastRound) return t('results.stage.final');
    if (isElim && !hasGrandFinal && m.round === lastRound - 1) return t('results.stage.semi');
    return t('results.stage.round', { n: m.round });
  };

  return (
    <Box data-testid="tournament-results" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {champion && (
        <ChampionHero
          label={t('results.champions')}
          team={{ id: champion.id, name: champion.name, tag: champion.tag }}
          line={finalLine}
          map={finalMap}
        />
      )}
      {pickRows.map(({ id, Row }) => (
        <Row key={id} tournamentId={tournament.id} />
      ))}
      {sections.map(({ id, Section }) => (
        <Section key={id} tournamentId={tournament.id} />
      ))}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
        <Box
          component="section"
          aria-labelledby="results-standings"
          sx={{ ...panel, flex: '1 1 300px' }}
        >
          <SectionTitle id="results-standings" title={t('results.finalStandings')} />
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {standings.map((team, index) => (
              <Box
                key={team.teamId}
                component="li"
                data-testid="results-standing"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '40px minmax(0,1fr)',
                  gap: 1.5,
                  alignItems: 'center',
                  py: 1,
                  borderTop: `1px solid ${color.rule}`,
                }}
              >
                <Typography
                  component="span"
                  sx={{ ...mono, fontWeight: 600, color: PLACE_COLOR[index] ?? color.muted }}
                >
                  {t('results.place', { n: index + 1 })}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <TeamLogo team={{ id: team.teamId, name: team.name, tag: team.tag }} size="sm" />
                  <Link
                    component={RouterLink}
                    to={teamProfilePath(team.teamId)}
                    underline="hover"
                    sx={{
                      color: 'inherit',
                      fontWeight: index < 2 ? 700 : 500,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {team.name}
                  </Link>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {awards.length > 0 && (
          <Box
            component="section"
            aria-labelledby="results-awards"
            sx={{ ...panel, flex: '999 1 520px' }}
          >
            <SectionTitle id="results-awards" title={t('results.awards')} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 13rem), 1fr))',
                gap: 1.5,
              }}
            >
              {awards.map((award) => (
                <Box
                  key={award.key}
                  data-testid={`results-award-${award.key}`}
                  sx={{
                    borderRadius: radii.md,
                    bgcolor: color.paper3,
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontSize: '0.75rem',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: color.muted,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                    }}
                  >
                    <Box
                      component="span"
                      aria-hidden
                      sx={{ display: 'inline-flex', color: AWARD_ICON[award.key].tone }}
                    >
                      {AWARD_ICON[award.key].icon}
                    </Box>
                    {t(`results.award.${award.key}`)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <PlayerAvatar
                      id={award.player.playerId}
                      name={award.player.name}
                      avatar={award.player.avatar}
                      size={32}
                    />
                    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Link
                        component={RouterLink}
                        to={getPlayerPageUrl(award.player.playerId)}
                        underline="hover"
                        sx={{ color: 'inherit', fontWeight: 700, overflowWrap: 'anywhere' }}
                      >
                        {award.player.name}
                      </Link>
                      {award.player.team?.name && (
                        <Link
                          component={RouterLink}
                          to={teamProfilePath(award.player.team.id)}
                          underline="hover"
                          sx={{ fontSize: '0.8125rem', color: color.muted }}
                        >
                          {award.player.team.name}
                        </Link>
                      )}
                    </Box>
                  </Box>
                  <Typography sx={{ ...mono, color: color.accent }}>
                    {t(`results.awardValue.${award.key}`, { value: award.value })}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {players.length > 0 && (
        <Box component="section" aria-labelledby="results-players" sx={panel}>
          <SectionTitle id="results-players" title={t('results.players')} />
          <Box sx={{ overflowX: 'auto' }}>
            <Box
              component="table"
              data-testid="results-players-table"
              sx={{ width: '100%', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr>
                  <Box component="th" sx={{ ...th, textAlign: 'left' }}>
                    #
                  </Box>
                  {sortableTh('player', t('results.col.player'), { ...th, textAlign: 'left' })}
                  {sortableTh('team', t('results.col.team'), {
                    ...th,
                    textAlign: 'left',
                    display: { xs: 'none', sm: 'table-cell' },
                  })}
                  {sortableTh('kd', 'K / D', th)}
                  {sortableTh('adr', 'ADR', th)}
                  {sortableTh('hs', 'HS', { ...th, display: { xs: 'none', sm: 'table-cell' } })}
                  {hasRating &&
                    sortableTh('rating', t('results.col.hltv'), {
                      ...th,
                      display: { xs: 'none', sm: 'table-cell' },
                    })}
                  {sortableTh('elo', t('results.col.rating'), th)}
                </tr>
              </thead>
              <tbody>
                {shown.map((player, index) => {
                  const kills = player.kills ?? 0;
                  const deaths = player.deaths ?? 0;
                  const hs = kills > 0 ? Math.round(((player.headshots ?? 0) / kills) * 100) : 0;
                  return (
                    <Box
                      component="tr"
                      key={player.playerId}
                      sx={{ borderTop: `1px solid ${color.rule}` }}
                    >
                      <Box component="td" sx={{ ...td, textAlign: 'left', color: color.muted }}>
                        {index + 1}
                      </Box>
                      <Box component="td" sx={{ p: '10px 12px' }}>
                        <Link
                          component={RouterLink}
                          to={getPlayerPageUrl(player.playerId)}
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1.25,
                            color: color.ink,
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          <PlayerAvatar
                            id={player.playerId}
                            name={player.name}
                            avatar={player.avatar}
                            size={28}
                          />
                          <span>{player.name}</span>
                        </Link>
                      </Box>
                      <Box
                        component="td"
                        sx={{
                          p: '10px 12px',
                          color: color.ink2,
                          fontSize: '0.875rem',
                          display: { xs: 'none', sm: 'table-cell' },
                        }}
                      >
                        {player.team ? (
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                            <TeamLogo
                              team={{
                                id: player.team.id,
                                name: player.team.name,
                                tag: player.team.tag,
                              }}
                              size="sm"
                            />
                            <OpponentName id={player.team.id} name={player.team.name} />
                          </Box>
                        ) : (
                          ''
                        )}
                      </Box>
                      <Box component="td" sx={td}>
                        {kills} / {deaths}
                      </Box>
                      <Box component="td" sx={td}>
                        {player.averageAdr ? Math.round(player.averageAdr) : '—'}
                      </Box>
                      <Box component="td" sx={{ ...td, display: { xs: 'none', sm: 'table-cell' } }}>
                        {kills > 0 ? `${hs}%` : '—'}
                      </Box>
                      {hasRating && (
                        <Box
                          component="td"
                          sx={{ ...td, fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}
                        >
                          {fmtNum(player.rating, 2)}
                        </Box>
                      )}
                      <Box
                        component="td"
                        sx={{
                          ...td,
                          fontWeight: 600,
                          color:
                            player.eloChange > 0
                              ? color.live
                              : player.eloChange < 0
                                ? color.ban
                                : color.ink2,
                        }}
                      >
                        {player.eloChange > 0
                          ? `+${Math.round(player.eloChange)}`
                          : Math.round(player.eloChange)}
                      </Box>
                    </Box>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          {players.length > SHOWN_PLAYERS && (
            <Button
              size="small"
              onClick={() => setShowAll((v) => !v)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {showAll ? t('results.showFewer') : t('results.showAll', { count: players.length })}
            </Button>
          )}
        </Box>
      )}

      {recent.length > 0 && (
        <Box component="section" aria-labelledby="results-matches" sx={panel}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 1,
            }}
          >
            <SectionTitle id="results-matches" title={t('results.matchesAndDemos')} />
            <Link
              component={RouterLink}
              to={tournamentTabPath(tournament.id, 'matches')}
              sx={{ fontSize: '0.875rem' }}
            >
              {t('results.allMatches', {
                count: matches.filter((m) => m.status === 'completed').length,
              })}
            </Link>
          </Box>
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {recent.map((m) => {
              const w = m.winner?.id === m.team1?.id ? m.team1 : m.team2;
              const l = m.winner?.id === m.team1?.id ? m.team2 : m.team1;
              const ws = Math.max(
                m.team1SeriesScore ?? m.team1Score ?? 0,
                m.team2SeriesScore ?? m.team2Score ?? 0
              );
              const ls = Math.min(
                m.team1SeriesScore ?? m.team1Score ?? 0,
                m.team2SeriesScore ?? m.team2Score ?? 0
              );
              return (
                <Box
                  component="li"
                  key={m.slug}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) auto',
                    gap: 1.5,
                    alignItems: 'center',
                    py: 1.25,
                    borderTop: `1px solid ${color.rule}`,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Box
                      component="span"
                      sx={{
                        fontSize: '0.75rem',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: color.muted,
                        mr: 1.5,
                      }}
                    >
                      {stageOf(m)}
                    </Box>
                    <Box component="span" sx={{ color: color.live, fontWeight: 600 }}>
                      {w?.name}
                    </Box>{' '}
                    <Box component="span" sx={{ ...mono }}>
                      {ws} – {ls}
                    </Box>{' '}
                    <Box component="span" sx={{ color: color.muted }}>
                      {l?.name}
                    </Box>
                    <Box component="span" sx={{ fontSize: '0.8125rem', color: color.muted }}>
                      {(m.mapResults ?? []).length
                        ? ` · ${(m.mapResults ?? []).map((r) => (r.mapName ? getMapDisplayName(r.mapName) : '')).join(', ')}`
                        : ''}
                    </Box>
                  </Box>
                  <Link
                    component={RouterLink}
                    to={matchPagePath(m.slug)}
                    sx={{ fontSize: '0.875rem' }}
                  >
                    {t('results.demosAndReel')}
                  </Link>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {footers.map(({ id, Footer }) => (
        <Footer key={id} tournamentId={tournament.id} />
      ))}
    </Box>
  );
}
