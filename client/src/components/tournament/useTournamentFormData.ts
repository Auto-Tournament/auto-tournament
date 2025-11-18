import { useState, useEffect, useRef } from 'react';
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

        // Load map pools
        const poolsResponse = await api.get<MapPoolsResponse>('/api/map-pools');
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
          // No maps selected - if Active Duty is selected by default, load its maps
          // Only do this once on initial load to avoid infinite loops
          if (!hasInitializedMaps.current && selectedMapPool === 'active-duty') {
            const activeDutyPool = loadedPools.find((p) => p.isDefault);
            if (activeDutyPool) {
              hasInitializedMaps.current = true;
              onMapsChange(activeDutyPool.mapIds);
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
  };
}

