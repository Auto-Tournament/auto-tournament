import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import type { MapPool, MapPoolsResponse, MapsResponse, Map as MapType } from '../../types/api.types';

/** Enabled server count, map pools and maps for the tournament setup. Loaded once. */
export function useTournamentFormData() {
  const [serverCount, setServerCount] = useState<number>(0);
  const [loadingServers, setLoadingServers] = useState(true);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [availableMaps, setAvailableMaps] = useState<MapType[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);

  const refreshServers = useCallback(async () => {
    try {
      const serversResponse = await fetch('/api/servers');
      const serversData = await serversResponse.json();
      const enabledServers = (serversData.servers || []).filter(
        (s: { enabled: boolean }) => s.enabled
      );
      setServerCount(enabledServers.length);
    } catch (err) {
      console.error('Failed to refresh servers:', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      try {
        await refreshServers();

        // Load map pools (filter disabled pools for tournament selection)
        const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools?enabled=true');
        if (!cancelled) setMapPools(poolsResponse.mapPools || []);

        // Load available maps
        const mapsResponse = await api.get<MapsResponse>('/api/maps');
        if (!cancelled) setAvailableMaps(mapsResponse.maps || []);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        if (!cancelled) {
          setLoadingServers(false);
          setLoadingMaps(false);
        }
      }
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [refreshServers]);

  return {
    serverCount,
    loadingServers,
    mapPools,
    availableMaps,
    loadingMaps,
    setMapPools,
    refreshServers,
  };
}
