import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../module-sdk';
import type { Map as MapType, MapPool, MapPoolsResponse, MapsResponse } from '../cs2.types';

/**
 * The enabled map pools and the map catalogue, for CS2's tournament setup
 * steps. Loaded once per mount; `reloadPools` after a pool is saved.
 */
export function useCs2MapData() {
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [availableMaps, setAvailableMaps] = useState<MapType[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadPools = useCallback(async () => {
    try {
      const response = await api.get<MapPoolsResponse>('/api/map-pools?enabled=true');
      setMapPools(response.mapPools || []);
    } catch (err) {
      console.error('Failed to reload map pools:', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [pools, maps] = await Promise.all([
          api.get<MapPoolsResponse>('/api/map-pools?enabled=true'),
          api.get<MapsResponse>('/api/maps'),
        ]);
        if (cancelled) return;
        setMapPools(pools.mapPools || []);
        setAvailableMaps(maps.maps || []);
      } catch (err) {
        console.error('Failed to load map pools and maps:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { mapPools, availableMaps, loading, reloadPools };
}

/**
 * The pool the step shows: "Custom" when the organizer chose it, the pool the
 * settings name (a template's, or the one picked last), "Custom" for a
 * shuffle (an explicit sequence), the pool the maps come from, or for a new
 * elimination bracket "Active Duty", else the default pool.
 */
export function defaultMapPool(
  mapPools: MapPool[],
  type: string,
  maps: string[],
  mapPoolId: number | null | undefined
): string {
  if (mapPools.length === 0) return '';
  if (mapPoolId === null) return 'custom';
  if (mapPoolId !== undefined) {
    const pool = mapPools.find((p) => p.id === mapPoolId);
    if (pool) return pool.id.toString();
  }
  if (type === 'shuffle') return 'custom';
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
