import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useTopic } from '../../../module-sdk';
import type { Server, ServersResponse } from '../cs2.types';

/**
 * Enabled servers that have never sent an event, so the allocator does not
 * count them yet (`lastSeen` null: added, but the plugin was never set up or
 * never reached us).
 *
 * The availability route lists only servers the allocator can use, so a site
 * with three servers added and none set up read "No servers connected yet" on
 * the dashboard and "No servers configured yet" / "0 / 0" on Manage, while the
 * Servers page said "3 servers, 3 not configured". The panels add these to
 * what the allocator reports, so every page counts the same servers.
 *
 * Asked once per mount, plus again on fleet changes when `live`: a server
 * leaves this list the moment it sends its first event.
 */
export function useUnconfiguredServers(live?: boolean): Pick<Server, 'id' | 'name'>[] {
  const [servers, setServers] = useState<Pick<Server, 'id' | 'name'>[]>([]);

  const mounted = useRef(true);
  const load = useCallback(async () => {
    try {
      const res = await api.get<ServersResponse>('/api/servers');
      if (!mounted.current) return;
      setServers(
        (res.servers ?? [])
          .filter((s) => s.enabled && !s.lastSeen)
          .map((s) => ({ id: s.id, name: s.name }))
      );
    } catch {
      // Leave the last answer; the allocator's own view still shows.
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    // The state is set after the request answers, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  // A server leaves this list the moment it reports in: re-read on fleet changes.
  useTopic('fleet', load, { admin: true, events: ['server:status'], enabled: !!live });

  return servers;
}
