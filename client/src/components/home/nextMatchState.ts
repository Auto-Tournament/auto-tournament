/**
 * What the home page's next-match card shows, from the team's current match
 * (GET /api/teams/:id/match), kept apart from React so it can be checked on
 * its own. `tone`: 'act' (the player has to do something, or soon will: the
 * whole card lights up), 'live', 'wait' (the platform is waiting on
 * something) or 'calm'. Text is i18n keys under `home.next`, with values.
 */
import type { TeamMatchInfo } from '../../types';

export type CardTone = 'act' | 'live' | 'wait' | 'calm';

export interface NextMatchCard {
  tone: CardTone;
  /** The big text in the status block: a key, or a literal (a score, a clock). */
  big: { key: string; values?: Record<string, string | number> } | { text: string };
  small: { key: string; values?: Record<string, string | number> };
  label: string;
  action: 'open' | 'veto' | 'join';
  /** A countdown to this time (unix s) replaces `big` while it runs. */
  countdownTo?: number;
}

const clock = (at: number) => {
  const d = new Date(at * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function nextMatchCard(m: TeamMatchInfo, now: number): NextMatchCard {
  const mine = (a: number, b: number) => (m.isTeam1 ? [a, b] : [b, a]);
  const live = m.liveStats;
  // No veto state yet means it has not started (unless the match has no veto at all).
  const vetoDone = m.veto?.status === 'completed' || !!m.config?.vetoDisabled;

  if (!m.opponent) {
    return {
      tone: 'calm',
      big: { text: 'TBD' },
      small: { key: 'opponent' },
      label: 'nextMatch',
      action: 'open',
    };
  }
  if (m.status === 'live' || m.status === 'loaded') {
    if (live && (live.status === 'live' || live.status === 'knife')) {
      const [a, b] = mine(live.team1Score, live.team2Score);
      return {
        tone: 'live',
        big: { text: `${a} – ${b}` },
        small: live.mapName
          ? { key: 'mapRound', values: { map: live.mapName, round: live.roundNumber } }
          : { key: 'round', values: { round: live.roundNumber } },
        label: 'live',
        action: 'open',
      };
    }
    if (live?.status === 'halftime') {
      const [a, b] = mine(live.team1Score, live.team2Score);
      return {
        tone: 'live',
        big: { text: `${a} – ${b}` },
        small: { key: 'halftime' },
        label: 'live',
        action: 'open',
      };
    }
    if (live?.status === 'postgame' && live.totalMaps > 1) {
      const [a, b] = mine(live.team1SeriesScore, live.team2SeriesScore);
      return {
        tone: 'live',
        big: { text: `${a} – ${b}` },
        small: { key: 'nextMap' },
        label: 'live',
        action: 'open',
      };
    }
    // On the server, before it starts: nobody of ours on it yet, else who is ready.
    const ours = (m.connectionStatus?.connectedPlayers ?? []).filter(
      (p) => p.team === (m.isTeam1 ? 'team1' : 'team2')
    );
    if (ours.length === 0) {
      return {
        tone: 'act',
        big: { key: 'join' },
        small: { key: 'serverReady' },
        label: 'ready',
        action: 'join',
      };
    }
    const ready = (m.connectionStatus?.connectedPlayers ?? []).filter((p) => p.isReady).length;
    const total = m.config?.expected_players_total ?? ready;
    return {
      tone: 'live',
      big: { text: `${ready}/${total}` },
      small: { key: 'ready' },
      label: 'warmup',
      action: 'open',
    };
  }
  if (m.veto?.status === 'in_progress' && !m.config?.vetoDisabled) {
    const yours = m.veto.currentTurn === (m.isTeam1 ? 'team1' : 'team2');
    const what =
      ({ pick: 'pick', side_pick: 'side' } as const)[m.veto.currentAction ?? ''] ?? 'ban';
    return yours
      ? {
          tone: 'act',
          big: { key: 'yourTurn' },
          small: { key: what },
          label: 'vetoTurn',
          action: 'veto',
        }
      : {
          tone: 'act',
          big: { key: 'veto' },
          small: { key: 'theirTurn' },
          label: 'nextMatch',
          action: 'veto',
        };
  }
  if (m.heldUntil && m.heldUntil > now) {
    return {
      tone: 'act',
      big: { text: '' },
      small: { key: vetoDone ? 'untilMatch' : 'untilVeto' },
      label: 'nextMatch',
      action: 'open',
      countdownTo: m.heldUntil,
    };
  }
  if (m.startsAt && m.startsAt > now) {
    return {
      tone: 'calm',
      big: { text: clock(m.startsAt) },
      small: { key: 'startsAt' },
      label: 'nextMatch',
      action: 'open',
    };
  }
  if (vetoDone && !m.server) {
    return {
      tone: 'wait',
      big: { key: 'waiting' },
      small: { key: 'forServer' },
      label: 'nextMatch',
      action: 'open',
    };
  }
  return {
    tone: 'act',
    big: { key: 'veto' },
    small: { key: 'vetoOpen' },
    label: 'nextMatch',
    action: 'veto',
  };
}
