import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../utils/api';
import type { MapPool, MapPoolsResponse, MapsResponse, Map as MapType } from '../../types/api.types';

interface UseTournamentFormDataProps {
  maps: string[];
  selectedMapPool: string;
  onMapsChange: (maps: string[]) => void;
}

export function useTournamentFormData({
  maps,
  selectedMapPool,
  onMapsChange,
}: UseTournamentFormDataProps) {
  const [serverCount, setServerCount] = useState<number>(0);
  const [loadingServers, setLoadingServers] = useState(true);
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [availableMaps, setAvailableMaps] = useState<MapType[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);
  const hasInitializedMaps = useRef(false);

  const refreshServers = useCallback(async () => {
    try {
      const serversResponse = await fetch('/api/servers', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token')}`,
        },
      });
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
    const loadData = async () => {
      try {
        // Load servers
        const serversResponse = await fetch('/api/servers', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token')}`,
          },
        });
        const serversData = await serversResponse.json();
        const enabledServers = (serversData.servers || []).filter(
          (s: { enabled: boolean }) => s.enabled
        );
        setServerCount(enabledServers.length);

        // Load map pools (filter disabled pools for tournament selection)
        const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools?enabled=true');
        const loadedPools = poolsResponse.mapPools || [];
        setMapPools(loadedPools);

        // Load available maps
        const mapsResponse = await api.get<MapsResponse>('/api/maps');
        setAvailableMaps(mapsResponse.maps || []);

        // Initialize map pool selection based on current maps
        if (maps.length > 0) {
          // Maps already set, don't auto-initialize
          return;
        } else {
          // No maps selected - load maps from the selected pool (could be default or any pool)
          // Only do this once on initial load to avoid infinite loops
          if (!hasInitializedMaps.current && selectedMapPool !== 'custom') {
            const selectedPool = loadedPools.find((p) => p.id.toString() === selectedMapPool);
            if (selectedPool) {
              hasInitializedMaps.current = true;
              onMapsChange(selectedPool.mapIds);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoadingServers(false);
        setLoadingMaps(false);
      }
    };
    loadData();
  }, [maps.length, selectedMapPool, onMapsChange]);

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

