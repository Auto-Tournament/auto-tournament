/**
 * Where a team's match stands, in the order the match room draws it (boards
 * 7a–7c): not started, waiting for the opponent, the pre-match veto, joining
 * the server, live, done. The match room and the next-match cards say the same.
 */

import type { TeamMatchInfo } from '../types';
import { isVetoDisabledForMatch } from './matchFlags';

const FORMATS = ['bo1', 'bo3', 'bo5'];

export type MatchPhase = 'notStarted' | 'waitingOpponent' | 'veto' | 'joining' | 'live' | 'done';

export function matchPhaseOf(match: TeamMatchInfo, tournamentStatus: string): MatchPhase {
  const isManual = match.round === 0;
  const bothTeams = isManual
    ? Boolean(match.config?.team1 && match.config?.team2)
    : Boolean(match.team1?.id && match.team2?.id);
  if (match.status === 'completed') return 'done';
  if (match.status === 'live' && match.liveStats && match.liveStats.status !== 'warmup')
    return 'live';
  if (!isManual && tournamentStatus !== 'in_progress' && match.status === 'pending')
    return 'notStarted';
  if (match.status === 'pending' && !bothTeams) return 'waitingOpponent';
  const vetoOff = isVetoDisabledForMatch({
    round: match.round,
    team1: match.team1 ? { id: match.team1.id } : null,
    team2: match.team2 ? { id: match.team2.id } : null,
    config: match.config
      ? {
          ...match.config,
          team1: match.config.team1 ? { id: match.config.team1.id } : null,
          team2: match.config.team2 ? { id: match.config.team2.id } : null,
        }
      : null,
  });
  const vetoDone = match.veto?.status === 'completed';
  if (!vetoOff && !vetoDone && match.status === 'pending' && FORMATS.includes(match.matchFormat)) {
    return 'veto';
  }
  return 'joining';
}
