import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import { useAdminNotices } from './useAdminNotices';
import { useTopic } from './useTopic';
import type { AdminCall } from '../types/adminCall';

/**
 * How many things wait for an admin, site-wide (the Nav board's Needs you
 * pill): open admin calls, open error and warning notices, and open player
 * reports. Read again on every page and when a call comes in.
 */
export function useNeedsYouCount(enabled: boolean): number {
  const { pathname } = useLocation();
  const { notices } = useAdminNotices(enabled);
  const [calls, setCalls] = useState(0);
  const [reports, setReports] = useState(0);
  const [tick, setTick] = useState(0);
  useTopic([], () => setTick((n) => n + 1), {
    admin: true,
    enabled,
    events: ['admin:call', 'admin:call:resolved'],
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<{ open?: AdminCall[] }>('/api/admin-calls?resolvedWithin=0')
      .then((res) => !cancelled && setCalls(res.open?.length ?? 0))
      .catch(() => null);
    api
      .get<{ open?: number }>('/api/player-reports?status=open')
      .then((res) => !cancelled && setReports(res.open ?? 0))
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [enabled, pathname, tick]);

  if (!enabled) return 0;
  const openNotices = notices.filter((n) => n.resolvedAt === null && n.severity !== 'info').length;
  return calls + openNotices + reports;
}
