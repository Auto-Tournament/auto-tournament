/**
 * The top of the live overview: the viewer's next match (useTeamNextMatch)
 * and the hero. Moved out of OverviewLive.tsx as is.
 */
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
import { radii, tokens } from '../../../theme/tokens';
import { StatusHero } from '../ui/draftUi';
import { publicMatchLabel } from '../page/matchHelpers';
import { NextMatchCard } from '../../home/NextMatchCard';
import { formatBadge } from '../../../utils/tournamentSummary';

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

  // The viewer's match: the same card as the home page (components/home/NextMatchCard).
  if (viewerTeamId && match && phase && phase !== 'done') {
    const next = matches.find((m) => m.slug === match.slug);
    return (
      <NextMatchCard
        match={match}
        teamName={teamName ?? ''}
        where={[
          tournament.name,
          next ? publicMatchLabel(next, tournament) : null,
          formatBadge(match.matchFormat),
        ]
          .filter(Boolean)
          .join(' · ')}
        tournamentId={tournament.id}
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
