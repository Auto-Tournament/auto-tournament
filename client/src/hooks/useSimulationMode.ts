import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from './useIsDevelopment';

/**
 * Small hook to expose whether "simulation mode" is currently enabled.
 *
 * - Reads simulateMatches from /api/settings
 * - No-op (always false) in production
 * - Provides a refresh() method so callers can re-sync after toggling settings
 */
export function useSimulationMode() {
  const isDev = useIsDevelopment();
  const [simulationEnabled, setSimulationEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isDev) {
      setSimulationEnabled(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get<SettingsResponse>('/api/settings');
      if (response.success) {
        setSimulationEnabled(Boolean(response.settings.simulateMatches));
      } else {
        setSimulationEnabled(false);
      }
    } catch {
      setSimulationEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [isDev]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { simulationEnabled, loading, refresh };
}


