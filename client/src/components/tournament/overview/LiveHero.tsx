/**
 * The top of the live overview: the viewer's next match (useTeamNextMatch)
 * and the hero. Moved out of OverviewLive.tsx as is.
 */
import { fmtTime } from '../../../utils/time';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match, TeamMatchInfo, Tournament } from '../../../types';
import { matchPagePath } from '../../../paths';
import { matchPhaseOf, type MatchPhase } from '../../../utils/matchPhase';
import { useSocket } from '../../../hooks/useSocket';
import { onSocketReconnect } from '../../../utils/socketResync';
import { placementFor } from '../../../hooks/usePlacement';
import { getMapDisplayName } from '../../../constants/maps';
import { radii, tokens } from '../../../theme/tokens';
import { InfoTile, StatusHero } from '../ui/draftUi';
import { minutesLeft } from '../PlacementDialog';
import { publicMatchLabel } from '../page/matchHelpers';

import { isElim, isLive } from './LiveParts';

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

/** The map a match is (or was) played on, when the round has one. */

export function Hero({
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
