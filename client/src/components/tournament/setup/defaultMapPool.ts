import type { MapPool } from '../../../types/api.types';

/**
 * The pool to show before the user picks one: "Custom" for shuffle (an
 * explicit sequence), a loaded template's pool, the pool the saved maps come
 * from, or for a new elimination bracket "Active Duty", else the default pool.
 */
export function defaultMapPool(
  mapPools: MapPool[],
  type: string,
  maps: string[],
  templatePoolId: number | null
): string {
  if (mapPools.length === 0) return '';
  if (type === 'shuffle') return 'custom';
  if (templatePoolId !== null && templatePoolId !== undefined) {
    const pool = mapPools.find((p) => p.id === templatePoolId);
    if (pool) return pool.id.toString();
  }
  if (maps.length > 0) {
    const sorted = JSON.stringify([...maps].sort());
    const matching = mapPools.find((p) => JSON.stringify([...p.mapIds].sort()) === sorted);
    return matching ? matching.id.toString() : 'custom';
  }
  if (type === 'single_elimination' || type === 'double_elimination') {
    const activeDuty = mapPools.find((p) => p.enabled && p.name.toLowerCase() === 'active duty');
    if (activeDuty) return activeDuty.id.toString();
  }
  const fallback =
    mapPools.find((p) => p.isDefault) ?? mapPools.find((p) => p.enabled) ?? mapPools[0];
  return fallback ? fallback.id.toString() : '';
}
