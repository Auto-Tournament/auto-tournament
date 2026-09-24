/**
 * What the game this instance is running gives the pages that are not about
 * one tournament — a player's profile (3.0 phase D, PR D10).
 *
 * Those pages show kills, deaths, ADR, headshots and a demo link, which are
 * things a *game* measured. A game that measures nothing has no zero to show;
 * it has nothing to show, and a column of "N/A" says the data is missing when
 * the truth is that it was never going to exist.
 *
 * Read from the tournament rather than from the instance, which until phase E
 * meant CS2 ("3.0 runs one game per instance"): the whole point of phase D is
 * that the one tournament this instance runs might be Rocket League.
 *
 * It asks `GET /api/tournament/game` and not `GET /api/tournament`, which is
 * admin-only — an ordinary player opening their own profile would get a 403 in
 * the console, which is the exact bug `/api/tournament/allocation-status` was
 * carved out to fix and which `tests/api/player-page-permissions.spec.ts`
 * watches for.
 *
 * While it loads, and with no tournament at all, the answer is CS2's — the
 * game every instance has had — so nothing flickers away on the common path.
 *
 * It also hands back the module itself and the tournament's id, so a page can
 * show what that module puts in place of the columns it left out (manual
 * reporting's `tournamentStatsView`). `tournamentId` is null until the
 * tournament is known, so nothing is asked for a tournament that is not there.
 */

import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { getIntegration } from '../integrations/registry';
import {
  DEFAULT_GAME,
  type ClientGameIntegration,
  type GameCapabilities,
} from '../integrations/types';

export function useGameCapabilities(): {
  capabilities: GameCapabilities;
  /** The module that owns the tournament (CS2 while loading, and with none). */
  integration: ClientGameIntegration;
  /** The tournament's id; null while loading and with no tournament. */
  tournamentId: number | null;
  loading: boolean;
} {
  const [game, setGame] = useState<string>(DEFAULT_GAME);
  const [tournamentId, setTournamentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api
      .get<{ success: boolean; game: string | null; tournamentId?: number | null }>(
        '/api/tournament/game'
      )
      .then((response) => {
        if (!live) return;
        if (response.game) setGame(response.game);
        if (typeof response.tournamentId === 'number') setTournamentId(response.tournamentId);
      })
      .catch((error) => console.error("Failed to read the tournament's game:", error))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const integration = getIntegration(game);
  return { capabilities: integration.capabilities, integration, tournamentId, loading };
}
