import type { MatchState } from './protocol/v1/types';

/**
 * A paused Ready Up match for the team view (pure: tested on its own): the
 * pause's type, and the lineup players not connected (subs and coaches do not
 * hold a match up), by name. Null when it is not paused.
 */
export function pauseView(
  state: Pick<MatchState, 'pause' | 'teams'> | null
): { type: string | null; waitingFor: string[] } | null {
  if (!state?.pause?.active) return null;
  const waitingFor: string[] = [];
  for (const team of [state.teams?.team1, state.teams?.team2]) {
    for (const [id, p] of Object.entries(team?.players ?? {})) {
      if (p.connected || (p.role && p.role !== 'player')) continue;
      waitingFor.push(p.name || id);
    }
  }
  return { type: state.pause.type ?? null, waitingFor };
}
