import type { VetoAction } from '../cs2.types';

export type VetoPickedBy = 'team1' | 'team2' | 'decider';

/**
 * Who picked each map, keyed by map name, from the veto's actions. A map a
 * pick action names was picked by that team; a map no pick names but that was
 * not banned either (the one left over) is the decider and is not in the map.
 * Null when the veto has no actions at all (maps set by an admin).
 */
export function pickedByMap(actions: readonly VetoAction[]): Map<string, VetoPickedBy> | null {
  if (actions.length === 0) return null;
  const picks = new Map<string, VetoPickedBy>();
  for (const a of actions) {
    if (a.action === 'pick' && (a.team === 'team1' || a.team === 'team2')) {
      picks.set(a.mapName, a.team);
    }
  }
  return picks;
}

/**
 * The index of the map being played (0-based), or null when none is on. The
 * match says which one; before it does, the first map with no result is on.
 */
export function liveMapIndex(
  status: string,
  mapNumber: number | null | undefined,
  mapCount: number,
  results: ReadonlyMap<number, unknown>
): number | null {
  if (status !== 'live' && status !== 'loaded') return null;
  if (typeof mapNumber === 'number') return mapNumber;
  for (let i = 0; i < mapCount; i++) if (!results.has(i)) return i;
  return null;
}
