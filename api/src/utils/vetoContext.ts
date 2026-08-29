/**
 * Shared veto context resolution.
 *
 * Both the veto routes and the "is it my turn?" endpoint that drives the navbar
 * CTA need to know which veto order a match runs and whose turn it currently is.
 * Keeping that in one place stops the two from disagreeing.
 */

import { db } from '../config/database';
import type { DbMatchRow } from '../types/database.types';
import { getVetoOrder, type VetoStep } from './vetoConfig';

export type VetoContext = {
  format: 'bo1' | 'bo3' | 'bo5';
  tournamentMaps: string[];
  customVetoOrder?: { bo1?: unknown[]; bo3?: unknown[]; bo5?: unknown[] };
};

/**
 * Resolve format and map pool for veto. Tournament matches use tournament row;
 * manual matches (round === 0, no tournament) use match config.
 */
export async function getVetoContext(match: DbMatchRow): Promise<VetoContext | null> {
  const isManual = match.round === 0 || match.tournament_id == null;

  if (isManual) {
    const config = match.config
      ? (JSON.parse(match.config) as { maplist?: string[]; num_maps?: number })
      : {};
    const maplist = Array.isArray(config.maplist) ? config.maplist : [];
    const numMaps = config.num_maps === 1 ? 1 : config.num_maps === 3 ? 3 : config.num_maps === 5 ? 5 : 1;
    const format: 'bo1' | 'bo3' | 'bo5' = numMaps === 1 ? 'bo1' : numMaps === 3 ? 'bo3' : 'bo5';
    if (maplist.length === 0) return null;
    return { format, tournamentMaps: maplist };
  }

  const tournament = await db.queryOneAsync<{ format: string; maps: string; settings: string | null }>(
    'SELECT format, maps, settings FROM tournament WHERE id = ?',
    [match.tournament_id]
  );
  if (!tournament) return null;

  const tournamentSettings = tournament.settings ? JSON.parse(tournament.settings) : {};
  return {
    format: tournament.format as 'bo1' | 'bo3' | 'bo5',
    tournamentMaps: JSON.parse(tournament.maps),
    customVetoOrder: tournamentSettings.customVetoOrder,
  };
}

/**
 * Whose turn is it, and to do what?
 *
 * A veto's state row is only written once the first action is submitted — the
 * GET endpoint builds the opening state on the fly without persisting it. So for
 * a match that has not been acted on yet, `veto_state` is NULL and the turn has
 * to be derived from the configured veto order.
 *
 * Reading the turn straight off `veto_state` therefore reports "nobody's turn"
 * for step 1, which is exactly when the first team needs to be told to act.
 *
 * @returns null when the match has no usable veto configuration, or the veto is
 *          already complete.
 */
export async function resolveCurrentVetoTurn(
  match: DbMatchRow
): Promise<{ currentTurn: 'team1' | 'team2'; currentAction: VetoStep['action'] } | null> {
  if (match.veto_state) {
    try {
      const state = JSON.parse(match.veto_state) as {
        status?: string;
        currentTurn?: 'team1' | 'team2';
        currentAction?: VetoStep['action'];
      };

      if (state.status === 'completed') return null;
      if (state.currentTurn && state.currentAction) {
        return { currentTurn: state.currentTurn, currentAction: state.currentAction };
      }
    } catch {
      // Fall through and derive from the configured order.
    }
  }

  const context = await getVetoContext(match);
  if (!context) return null;

  const vetoOrder = getVetoOrder(
    context.format,
    context.customVetoOrder as { bo1?: VetoStep[]; bo3?: VetoStep[]; bo5?: VetoStep[] } | undefined,
    context.tournamentMaps.length
  );
  if (vetoOrder.length === 0) return null;

  return { currentTurn: vetoOrder[0].team, currentAction: vetoOrder[0].action };
}
