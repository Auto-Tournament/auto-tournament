/**
 * OverviewLive's smaller parts: a match row, the round strip, the side
 * table and the next-round line. Moved out of OverviewLive.tsx as is.
 */
import { OpponentName } from '../../team/MatchRowLinks';
import { fmtTime } from '../../../utils/time';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match, RoundRobinStanding, SwissStanding, Tournament } from '../../../types';
import { matchPagePath } from '../../../paths';
import { mono, radii, textSize, tokens } from '../../../theme/tokens';
import {
  MapTile,
  SectionTitle,
  StatePill,
  TeamLogo,
  YoursPill,
  panel,
  resultInk,
  TeamIdentity,
  type TeamLike,
} from '../ui/draftUi';
import type { NextRoundEta } from '../../../hooks/usePublicBracket';

const { color } = tokens;

export const isElim = (type: string) =>
  type === 'single_elimination' || type === 'double_elimination';
export const isLive = (m: Match) => m.status === 'live' || m.status === 'loaded';
export const teamOf = (
  team?: { id?: string; name?: string; tag?: string; logoUrl?: string | null } | null
): TeamLike | null =>
  team?.name ? { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl } : null;

export function mapOf(m: Match): string | null {
  return m.currentMap ?? m.mapResults?.[0]?.mapName ?? m.maps?.[0] ?? null;
}

export function scoreOf(m: Match): [number | null, number | null] {
  if (m.status === 'completed') {
    // One map: its rounds (13 – 7), not the map count.
    const only = m.mapResults?.length === 1 ? m.mapResults[0] : null;
    if (only) return [only.team1Score, only.team2Score];
    const series = (m.team1SeriesScore ?? 0) + (m.team2SeriesScore ?? 0) > 1;
    if (series) return [m.team1SeriesScore ?? null, m.team2SeriesScore ?? null];
    return [m.team1Score ?? m.team1MapScore ?? null, m.team2Score ?? m.team2MapScore ?? null];
  }
  if (isLive(m))
    return [m.team1MapScore ?? m.team1Score ?? null, m.team2MapScore ?? m.team2Score ?? null];
  return [null, null];
}

/** One match as a row: logos, names (logos only on a phone), score, state. */

export function MatchRow({
  m,
  mine,
  done = false,
  yourTeamId = null,
}: {
  m: Match;
  mine: boolean;
  done?: boolean;
  yourTeamId?: string | null;
}) {
  const { t } = useTranslation();
  const [a, b] = scoreOf(m);
  const winner = m.winner?.id;
  const ink = (id?: string) => resultInk({ teamId: id, winnerId: winner, done, yourTeamId });
  const nameSx = (id?: string) => ({
    minWidth: 0,
    fontWeight: ink(id).won || ink(id).yours ? 700 : 600,
    color: ink(id).name,
  });
  const state = m.status === 'completed' ? 'done' : isLive(m) ? 'live' : 'upcoming';
  return (
    <Box
      component={RouterLink}
      to={matchPagePath(m.slug)}
      data-testid="overview-match-row"
      sx={{
        display: 'grid',
        gridTemplateColumns: done
          ? 'minmax(0,1fr) auto minmax(0,1fr)'
          : 'minmax(0,1fr) auto minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: done ? 1.25 : 1.75,
        borderRadius: radii.md,
        bgcolor: done ? color.paper : color.paper3,
        color: color.ink,
        textDecoration: 'none',
        '&:hover': { filter: 'brightness(1.12)' },
        '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <TeamIdentity
        team={teamOf(m.team1)}
        yours={ink(m.team1?.id).yours}
        link={false}
        nameOnPhone={false}
        nameSx={nameSx(m.team1?.id)}
        tbd={t('bracketCards.tbd')}
      />
      <Typography
        component="span"
        sx={{ ...mono, fontSize: '0.9375rem', color: color.ink2, whiteSpace: 'nowrap' }}
      >
        {a === null ? (
          t('overviewPage.matchesTab.vs')
        ) : (
          <>
            <Box component="span" sx={{ color: ink(m.team1?.id).score }}>
              {a}
            </Box>{' '}
            –{' '}
            <Box component="span" sx={{ color: ink(m.team2?.id).score }}>
              {b}
            </Box>
          </>
        )}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
        <TeamIdentity
          team={teamOf(m.team2)}
          align="end"
          yours={ink(m.team2?.id).yours}
          link={false}
          nameOnPhone={false}
          nameSx={nameSx(m.team2?.id)}
          tbd={t('bracketCards.tbd')}
        />
      </Box>
      {!done && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            minWidth: 64,
          }}
        >
          {mine && <YoursPill kind="match" />}
          <Typography
            component="span"
            sx={{
              fontSize: textSize.sm,
              fontWeight: 600,
              textAlign: 'right',
              color: state === 'live' ? color.live : color.ink2,
            }}
          >
            {t(`liveOverview.state.${state === 'upcoming' ? 'upcoming' : state}`)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/** The status hero for a viewer on a team, or for everyone else. */

export function RoundStrip({ matches, totalRounds }: { matches: Match[]; totalRounds: number }) {
  const { t } = useTranslation();
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const firstOpen = rounds.find((r) =>
    matches.some((m) => m.round === r && m.status !== 'completed')
  );
  return (
    <Box
      component="section"
      aria-labelledby="overview-schedule"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
    >
      <SectionTitle id="overview-schedule" title={t('liveOverview.schedule')} />
      {/* One row of rounds (it scrolls sideways when they don't fit), never a lone round on a second row. */}
      <Box
        component="ol"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: { xs: '9.5rem', md: 'minmax(9.5rem, 1fr)' },
          overflowX: 'auto',
          pb: 0.5,
          gap: 1.5,
        }}
      >
        {rounds.map((r) => {
          const inRound = matches.filter((m) => m.round === r);
          const map = inRound.map(mapOf).find(Boolean) ?? null;
          const done = inRound.length > 0 && inRound.every((m) => m.status === 'completed');
          const now = r === firstOpen;
          const state = done ? 'done' : now ? 'now' : r === (firstOpen ?? 0) + 1 ? 'next' : 'later';
          const label = t('liveOverview.round', { n: r });
          return (
            <Box component="li" key={r}>
              {map ? (
                <MapTile
                  map={map}
                  played={done}
                  ring={now ? color.live : 'transparent'}
                  top={
                    <>
                      <Box
                        component="span"
                        sx={{
                          px: 1,
                          py: 0.25,
                          borderRadius: radii.pill,
                          bgcolor: color.paper,
                          fontSize: textSize.sm,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </Box>
                      <StatePill state={state} label={t(`liveOverview.state.${state}`)} />
                    </>
                  }
                />
              ) : (
                <Box
                  sx={{
                    borderRadius: radii.md,
                    bgcolor: now ? color.paper3 : color.paper2,
                    border: `2px solid ${now ? color.live : 'transparent'}`,
                    p: 2,
                    minHeight: 96,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    opacity: done ? 0.6 : 1,
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                      {label}
                    </Typography>
                    <StatePill state={state} label={t(`liveOverview.state.${state}`)} />
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** The table beside the matches: standings for round robin and Swiss, wins for brackets. */

export function SideTable({
  tournament,
  matches,
  rr,
  swiss,
  viewerTeamId,
}: {
  tournament: Tournament;
  matches: Match[];
  rr: RoundRobinStanding[];
  swiss: SwissStanding[];
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const teams = tournament.teams ?? [];
  const byId = new Map(teams.map((tm) => [tm.id, tm]));
  type Row = { id: string; wins: number; losses: number; extra: string; out?: boolean };
  let rows: Row[];
  let note: string;
  if (tournament.type === 'round_robin' && rr.length) {
    rows = rr.map((s) => ({
      id: s.teamId,
      wins: s.wins,
      losses: s.losses,
      extra: `${s.roundDiff > 0 ? '+' : s.roundDiff < 0 ? '−' : ''}${Math.abs(s.roundDiff)}`,
    }));
    note = t('liveOverview.ties.round_robin');
  } else if (tournament.type === 'swiss' && swiss.length) {
    rows = swiss.map((s) => ({ id: s.teamId, wins: s.wins, losses: s.losses, extra: '' }));
    note = t('liveOverview.ties.swiss');
  } else {
    const tally = new Map<string, { wins: number; losses: number }>();
    for (const m of matches) {
      if (m.status !== 'completed' || !m.winner?.id) continue;
      for (const side of [m.team1, m.team2]) {
        if (!side?.id) continue;
        const row = tally.get(side.id) ?? { wins: 0, losses: 0 };
        if (side.id === m.winner.id) row.wins += 1;
        else row.losses += 1;
        tally.set(side.id, row);
      }
    }
    const lossesOut = tournament.type === 'double_elimination' ? 2 : 1;
    rows = teams
      .map((tm) => ({ id: tm.id, ...(tally.get(tm.id) ?? { wins: 0, losses: 0 }), extra: '' }))
      .map((r) => ({ ...r, out: r.losses >= lossesOut }))
      .sort((x, y) => Number(x.out) - Number(y.out) || y.wins - x.wins || x.losses - y.losses);
    note = t(
      tournament.type === 'double_elimination'
        ? 'liveOverview.ties.doubleElim'
        : 'liveOverview.ties.singleElim'
    );
  }
  return (
    <Box
      component="section"
      aria-labelledby="overview-side-table"
      sx={{ ...panel, flex: '1 1 360px' }}
    >
      <SectionTitle
        id="overview-side-table"
        title={isElim(tournament.type) ? t('liveOverview.teams') : t('liveOverview.standings')}
      />
      <Box
        component="ol"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}
      >
        {rows.map((r, i) => {
          const team = byId.get(r.id);
          const me = r.id === viewerTeamId;
          return (
            <Box
              component="li"
              key={r.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: '24px minmax(0,1fr) auto',
                gap: 1.5,
                alignItems: 'center',
                px: 1.5,
                py: 1.25,
                borderRadius: radii.sm,
                bgcolor: me ? color.paper3 : 'transparent',
                opacity: r.out ? 0.55 : 1,
              }}
            >
              <Typography
                component="span"
                sx={{ ...mono, fontWeight: 600, color: i === 0 ? color.medalGold : color.muted }}
              >
                {i + 1}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <TeamLogo
                  team={team ? { id: team.id, name: team.name, tag: team.tag } : null}
                  size="sm"
                />
                <Typography
                  component="span"
                  title={team?.name}
                  sx={{
                    fontWeight: me ? 700 : 500,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {team ? <OpponentName id={team.id} name={team.name} /> : r.id}
                </Typography>
              </Box>
              <Typography
                component="span"
                sx={{ ...mono, fontSize: '0.875rem', color: color.ink2, whiteSpace: 'nowrap' }}
              >
                {r.wins}–{r.losses}
                {r.extra ? ` · ${r.extra}` : ''}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{note}</Typography>
    </Box>
  );
}

/** "Next round about 15:47" while a round is being played; nothing when there is no estimate. */

export function NextRoundEtaLine({ eta }: { eta: NextRoundEta | null }) {
  const { t, i18n } = useTranslation();
  if (!eta) return null;
  const time = fmtTime(eta.at, i18n.language);
  const key = eta.final ? 'finalEnds' : eta.exact ? 'nextRoundAt' : 'nextRoundAbout';
  return (
    <Typography
      data-testid="overview-next-round-eta"
      sx={{ px: 1, fontSize: textSize.sm, color: color.ink2, fontVariantNumeric: 'tabular-nums' }}
    >
      {t(`liveOverview.eta.${key}`, { time })}
    </Typography>
  );
}
