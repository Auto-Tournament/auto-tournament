import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useTopic } from './useTopic';

export interface TournamentPause {
  pausedAt: number | null;
  reason: string | null;
  resumeAt: number | null;
}

/** Whether a running tournament is paused (public), kept fresh on tournament updates. */
export function useTournamentPause(tournamentId: number, on = true): TournamentPause | null {
  const [pause, setPause] = useState<TournamentPause | null>(null);
  const load = useCallback(async () => {
    if (!on) return;
    setPause(
      await api.get<TournamentPause>(`/api/tournament/${tournamentId}/pause`).catch(() => null)
    );
  }, [tournamentId, on]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api
      .get<TournamentPause>(`/api/tournament/${tournamentId}/pause`)
      .catch(() => null)
      .then((p) => {
        if (live) setPause(p);
      });
    return () => {
      live = false;
    };
  }, [tournamentId, on]);
  useTopic([], load, { events: ['tournament:update', 'bracket:update'] });
  return on ? pause : null;
}
