import { useState, useEffect, useCallback } from 'react';

/**
 * Enabled server count for the tournament setup. Loaded once. The game's own
 * data (CS2: map pools and maps) is loaded by its setup steps.
 */
export function useTournamentFormData() {
  const [serverCount, setServerCount] = useState<number>(0);
  const [loadingServers, setLoadingServers] = useState(true);

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
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        if (!cancelled) setLoadingServers(false);
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
    refreshServers,
  };
}
