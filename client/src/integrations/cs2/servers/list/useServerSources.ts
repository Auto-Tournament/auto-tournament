import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../module-sdk';
import type { FleetServer, FleetServersResponse } from '../../cs2.types';

const POLL_MS = 10_000;

/** The Ready Up servers, read every 10 s. */
export function useServerSources(): {
  fleetServers: FleetServer[];
  loaded: boolean;
  failed: boolean;
  reload: () => Promise<void>;
} {
  const [fleetServers, setFleetServers] = useState<FleetServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    const f = await api.get<FleetServersResponse>('/api/fleet/servers').catch(() => null);
    if (f) setFleetServers(f.servers ?? []);
    setFailed(!f);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [reload]);

  return { fleetServers, loaded, failed, reload };
}
