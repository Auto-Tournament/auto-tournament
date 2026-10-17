/**
 * The Overview of a running tournament with fixed teams (the drafts' round
 * robin, Swiss, single and double elimination boards): the status hero, the
 * schedule (round cards) or the bracket, this round's matches with the earlier
 * rounds under them, the table on the side, and every player by rating.
 */
import { GroupTables, type GroupStandingSet } from '../GroupTables';
import { fmtTime } from '../../../utils/time';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type {
  Match,
  RoundRobinStanding,
  SwissStanding,
  TeamMatchInfo,
  Tournament,
} from '../../../types';
import { matchPagePath, tournamentTabPath } from '../../../paths';
import { matchPhaseOf, type MatchPhase } from '../../../utils/matchPhase';
import { useSocket } from '../../../hooks/useSocket';
import { onSocketReconnect } from '../../../utils/socketResync';
import { placementFor } from '../../../hooks/usePlacement';
import { getMapDisplayName } from '../../../constants/maps';
import { tokens, mono, radii, textSize } from '../../../theme/tokens';
import { CardBracket } from '../page/CardBracket';
import {
  InfoTile,
  MapTile,
  SectionTitle,
  StatePill,
  StatusHero,
  TeamLogo,
  YoursPill,
  panel,
  type TeamLike,
  resultInk,
  TeamIdentity,
} from '../ui/draftUi';
import { PlayersLeaderboard } from './PlayersLeaderboard';
import type { NextRoundEta } from '../../../hooks/usePublicBracket';
import { minutesLeft } from '../PlacementDialog';
import { publicMatchLabel } from '../page/matchHelpers';

const { color } = tokens;

interface TeamMatchResponse {
  hasMatch?: boolean;
  match?: TeamMatchInfo | null;
  tournamentStatus?: string;
  team?: { name?: string } | null;
}

/** The viewer's team's next match, kept fresh as matches and the bracket move. */
export function useTeamNextMatch(teamId: string | null | undefined) {
  const [data, setData] = useState<TeamMatchResponse | null>(null);
  const load = useCallback(() => {
    if (!teamId) return undefined;
    let live = true;
    fetch(`/api/team/${encodeURIComponent(teamId)}/match`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<TeamMatchResponse>) : null))
      .then((body) => live && setData(body))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [teamId]);
  useEffect(() => load(), [load]);
  const socket = useSocket();
  const slug = data?.match?.slug ?? null;
  useEffect(() => {
    if (!teamId) return undefined;
    const events = ['match:update', 'bracket:update', ...(slug ? [`veto:update:${slug}`] : [])];
    const changed = () => void load();
    for (const event of events) socket.on(event, changed);
    const off = onSocketReconnect(socket, changed);
    return () => {
      off();
      for (const event of events) socket.off(event, changed);
    };
  }, [socket, slug, load, teamId]);
  const match = data?.hasMatch ? (data.match ?? null) : null;
  const phase: MatchPhase | null = match ? matchPhaseOf(match, data?.tournamentStatus ?? '') : null;
  return { match, phase, teamName: data?.team?.name ?? null };
}

const isElim = (type: string) => type === 'single_elimination' || type === 'double_elimination';
const isLive = (m: Match) => m.status === 'live' || m.status === 'loaded';
const teamOf = (
  team?: { id?: string; name?: string; tag?: string; logoUrl?: string | null } | null
): TeamLike | null =>
  team?.name ? { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl } : null;

/** The map a match is (or was) played on, when the round has one. */
function mapOf(m: Match): string | null {
  return m.currentMap ?? m.mapResults?.[0]?.mapName ?? m.maps?.[0] ?? null;
}

function scoreOf(m: Match): [number | null, number | null] {
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
function MatchRow({
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
function Hero({
  tournament,
  matches,
  viewerTeamId,
}: {
  tournament: Tournament;
  matches: Match[];
  viewerTeamId: string | null;
}) {
  const { t } = useTranslation();
  const { match, phase, teamName } = useTeamNextMatch(viewerTeamId);
  const placement = viewerTeamId ? placementFor(tournament, matches, viewerTeamId) : null;
  const live = matches.filter(isLive);
  const totalRounds = Math.max(0, ...matches.map((m) => m.round));
  const currentRound = Math.min(
    ...matches.filter((m) => m.status !== 'completed').map((m) => m.round),
    totalRounds
  );

  const roundLine = t('liveOverview.roundOf', {
    round: Number.isFinite(currentRound) ? currentRound : totalRounds,
    total: totalRounds,
  });

  // Out or champion (elimination formats).
  if (viewerTeamId && placement && (!match || phase === 'done')) {
    const won = placement.place === 1 && tournament.winner?.id === viewerTeamId;
    return (
      <StatusHero
        eyebrow={teamName ?? ''}
        eyebrowColor={won ? color.medalGold : color.ink2}
        ring={won ? color.medalGold : color.rule}
        title={
          won
            ? t('liveOverview.hero.wonTitle')
            : t('liveOverview.hero.outTitle', {
                place: t('teamProfile.tournaments.place', {
                  count: placement.place,
                  ordinal: true,
                }),
              })
        }
        body={won ? t('liveOverview.hero.wonBody') : t('liveOverview.hero.outBody')}
        side={
          <Button
            component={RouterLink}
            to="/play"
            variant="contained"
            sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
          >
            {t('liveOverview.hero.playMatchmaking')}
          </Button>
        }
      />
    );
  }

  // Elimination, waiting for the next opponent (the drafts' bracket hero): the win that got the
  // team here, the stage next, the match the opponent comes from, and when the veto opens.
  if (viewerTeamId && match && phase === 'waitingOpponent' && isElim(tournament.type)) {
    const next = matches.find((m) => m.slug === match.slug);
    const won = [...matches]
      .filter((m) => m.status === 'completed' && m.winner?.id === viewerTeamId)
      .sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0))[0];
    const feeder = next
      ? matches.find(
          (m) => m.nextMatchId === next.id && m.status !== 'completed' && m.slug !== won?.slug
        )
      : undefined;
    const feederLive = !!feeder && isLive(feeder);
    const maxRounds =
      tournament.maxRounds ??
      (tournament.settings as { cs2?: { maxRounds?: number } } | undefined)?.cs2?.maxRounds ??
      null;
    const minutes =
      feederLive && feeder
        ? minutesLeft(maxRounds, feeder.team1MapScore, feeder.team2MapScore)
        : null;
    const series = (m: Match) =>
      `${Math.max(m.team1SeriesScore ?? m.team1Score ?? 0, m.team2SeriesScore ?? m.team2Score ?? 0)}–${Math.min(m.team1SeriesScore ?? m.team1Score ?? 0, m.team2SeriesScore ?? m.team2Score ?? 0)}`;
    const totalRoundsSe = Math.max(
      0,
      ...matches.filter((m) => !m.bracket || m.bracket === 'SE').map((m) => m.round)
    );
    const winsToTitle =
      next && tournament.type === 'single_elimination' && totalRoundsSe > 0
        ? totalRoundsSe - next.round + 1
        : null;
    const eyebrow = [
      won
        ? t('liveOverview.hero.wonStage', {
            stage: publicMatchLabel(won, tournament),
            score: series(won),
          })
        : roundLine,
      winsToTitle ? t('whatsNext.winsToTitle', { count: winsToTitle }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const feederScore =
      feederLive && feeder && typeof feeder.team1SeriesScore === 'number'
        ? t('liveOverview.hero.feederLive', {
            score: `${feeder.team1SeriesScore ?? 0}–${feeder.team2SeriesScore ?? 0}`,
            map: (feeder.mapNumber ?? 0) + 1,
          })
        : t('liveOverview.hero.feederNotStarted');
    return (
      <StatusHero
        testId="overview-hero-waiting"
        eyebrow={eyebrow}
        eyebrowColor={color.live}
        title={
          next
            ? t('liveOverview.hero.stageNext', { stage: publicMatchLabel(next, tournament) })
            : t('liveOverview.hero.waitingTitle')
        }
        body={
          feeder?.team1 && feeder.team2
            ? t('liveOverview.hero.faceWinnerOf', {
                us: teamName ?? '',
                a: feeder.team1.name,
                b: feeder.team2.name,
                state: feederScore,
              })
            : t('liveOverview.hero.waitingBody')
        }
        side={
          <>
            <InfoTile
              label={t('liveOverview.hero.vetoOpens')}
              value={
                minutes
                  ? t('liveOverview.hero.inAboutMinutes', { count: minutes })
                  : t('liveOverview.hero.later')
              }
              note={t('liveOverview.hero.afterBreak')}
            />
            {feederLive && feeder ? (
              <Button
                component={RouterLink}
                to={matchPagePath(feeder.slug)}
                variant="outlined"
                sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
              >
                {t('liveOverview.hero.watchLive')}
              </Button>
            ) : (
              <Button
                component={RouterLink}
                to={matchPagePath(match.slug)}
                variant="outlined"
                data-testid="next-match-open"
                sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
              >
                {t('liveOverview.hero.openMatchRoom')}
              </Button>
            )}
          </>
        }
      />
    );
  }

  if (viewerTeamId && match && phase && phase !== 'done') {
    const us = match.isTeam1 ? 'team1' : 'team2';
    const them = match.isTeam1 ? 'team2' : 'team1';
    const ourName = teamName ?? match[us]?.name ?? '';
    const theirName = match.opponent?.name ?? match.config?.[them]?.name ?? t('bracketCards.tbd');
    const mapPart = match.currentMap ? ` · ${getMapDisplayName(match.currentMap)}` : '';
    // Joining without a server yet: it waits in line for one (nothing to join).
    const noServer =
      phase === 'joining' && !match.server && match.status !== 'loaded' && match.status !== 'live';
    const key =
      phase === 'live'
        ? 'playing'
        : noServer
          ? 'waitingServer'
          : phase === 'joining'
            ? 'joining'
            : phase === 'veto'
              ? 'veto'
              : phase === 'waitingOpponent'
                ? 'waiting'
                : 'notStarted';
    // The veto waits for the break between matches: say when it opens, not that it is open.
    const vetoHeld = phase === 'veto' && !!match.heldUntil;
    const hot =
      phase === 'live' || (phase === 'joining' && !noServer) || (phase === 'veto' && !vetoHeld);
    const ring = phase === 'veto' ? color.accent : hot ? color.live : color.rule;
    return (
      <StatusHero
        eyebrow={`${roundLine}${phase === 'live' ? ` · ${t('liveOverview.state.live')}` : ''}`}
        eyebrowColor={hot ? ring : color.muted}
        ring={ring}
        title={
          vetoHeld
            ? t('liveOverview.hero.vetoSoonTitle', { time: fmtTime(match.heldUntil as number) })
            : t(`liveOverview.hero.${key}Title`, { them: theirName })
        }
        body={
          vetoHeld
            ? t('liveOverview.hero.vetoSoonBody', { them: theirName })
            : t(`liveOverview.hero.${key}Body`, { us: ourName, them: theirName, map: mapPart })
        }
        side={
          <>
            <InfoTile
              label={t('liveOverview.hero.yourMatch')}
              value={`${ourName.split(/\s/)[0]} vs ${theirName.split(/\s/)[0]}`}
              note={roundLine}
            />
            <Button
              component={RouterLink}
              to={matchPagePath(match.slug)}
              variant={hot ? 'contained' : 'outlined'}
              data-testid="next-match-open"
              sx={{
                minHeight: 56,
                borderRadius: radii.pill,
                fontWeight: 700,
                fontSize: '1.0625rem',
              }}
            >
              {phase === 'veto' && !vetoHeld
                ? t('liveOverview.hero.openVeto')
                : t('liveOverview.hero.openMatchRoom')}
            </Button>
          </>
        }
      />
    );
  }

  // A player between rounds (round robin, Swiss): their record and what comes next.
  if (
    viewerTeamId &&
    !placement &&
    !isElim(tournament.type) &&
    tournament.status === 'in_progress'
  ) {
    const mine = matches.filter(
      (m) =>
        m.status === 'completed' && (m.team1?.id === viewerTeamId || m.team2?.id === viewerTeamId)
    );
    const wins = mine.filter((m) => m.winner?.id === viewerTeamId).length;
    const losses = mine.length - wins;
    const nextRound = Number.isFinite(currentRound)
      ? currentRound + (live.length ? 1 : 0)
      : totalRounds;
    const firstLive = live[0];
    return (
      <StatusHero
        testId="overview-hero-between"
        eyebrow={`${roundLine} · ${t('liveOverview.hero.youAre', { record: `${wins}–${losses}` })}`}
        eyebrowColor={color.live}
        title={
          nextRound > totalRounds
            ? t('liveOverview.hero.lastRoundPlaying')
            : t('liveOverview.hero.nextRoundDrawn', { round: nextRound })
        }
        body={t('liveOverview.hero.betweenBody')}
        side={
          firstLive ? (
            <Button
              component={RouterLink}
              to={matchPagePath(firstLive.slug)}
              variant="outlined"
              sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
            >
              {t('liveOverview.hero.watchLive')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  // Everyone else: what is on now, and one way into it.
  const first = live[0];
  return (
    <StatusHero
      eyebrow={`${roundLine}${live.length ? ` · ${t('liveOverview.state.live')}` : ''}`}
      eyebrowColor={live.length ? color.live : color.muted}
      ring={live.length ? color.live : color.rule}
      title={
        live.length === 0
          ? t('liveOverview.hero.spectatorIdleTitle')
          : live.length === 1
            ? t('liveOverview.hero.spectatorTitleOne')
            : t('liveOverview.hero.spectatorTitle', { count: live.length })
      }
      body={t('liveOverview.hero.spectatorBody')}
      side={
        first ? (
          <Button
            component={RouterLink}
            to={matchPagePath(first.slug)}
            variant="contained"
            sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
          >
            {t('liveOverview.hero.watchLive')}
          </Button>
        ) : undefined
      }
    />
  );
}

/** The rounds as cards: the round's map when it has one, its state and number. */
function RoundStrip({ matches, totalRounds }: { matches: Match[]; totalRounds: number }) {
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
function SideTable({
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
                  {team?.name ?? r.id}
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
function NextRoundEtaLine({ eta }: { eta: NextRoundEta | null }) {
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
