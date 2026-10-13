import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useSocket } from './useSocket';
import {
  sortNotices,
  upsertNotice,
  type AdminNotice,
  type AdminNoticeDelivery,
} from '../components/admin/adminNoticeText';

/**
 * The admins' bell: the notices (open ones first) and this admin's unread
 * count, kept live over the admin room (`admin:notice`, `admin:notice:resolved`).
 * `onNew` hears each live notice (the bell toasts it, with its sound flag).
 */
export function useAdminNotices(
  enabled: boolean,
  onNew?: (notice: AdminNotice, sound: boolean) => void
): {
  notices: AdminNotice[];
  unread: number;
  settings: Record<string, AdminNoticeDelivery>;
  markSeen: () => Promise<void>;
  dismiss: (id: number) => Promise<void>;
  reload: () => Promise<void>;
} {
  const socket = useSocket();
  const [notices, setNotices] = useState<AdminNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState<Record<string, AdminNoticeDelivery>>({});

  // Fetches only; the state is set in the callers' `.then`, never synchronously in an effect.
  const fetchNotices = useCallback(
    () =>
      api
        .get<{
          success: boolean;
          notices: AdminNotice[];
          unread: number;
          settings: Record<string, AdminNoticeDelivery>;
        }>('/api/admin-notices')
        .catch(() => null),
    []
  );
  const apply = useCallback(
    (
      res: {
        success: boolean;
        notices: AdminNotice[];
        unread: number;
        settings: Record<string, AdminNoticeDelivery>;
      } | null
    ) => {
      // Not an admin any more, or the API is away: keep what is shown.
      if (!res?.success) return;
      setNotices(sortNotices(res.notices ?? []));
      setUnread(Number(res.unread ?? 0));
      setSettings(res.settings ?? {});
    },
    []
  );
  const reload = useCallback(async () => {
    if (enabled) apply(await fetchNotices());
  }, [enabled, apply, fetchNotices]);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void fetchNotices().then((res) => {
      if (live) apply(res);
    });
    return () => {
      live = false;
    };
  }, [enabled, apply, fetchNotices]);

  useEffect(() => {
    if (!enabled) return undefined;
    const subscribe = () =>
      socket.emit('admin:subscribe', (ack?: { ok?: boolean }) => {
        if (ack?.ok) void reload();
      });
    const onNotice = (payload: { notice?: AdminNotice; sound?: boolean }) => {
      const notice = payload?.notice;
      if (!notice || typeof notice.id !== 'number') return;
      setNotices((list) => upsertNotice(list, notice));
      setUnread((n) => n + 1);
      onNew?.(notice, Boolean(payload.sound));
    };
    const onResolved = (payload: { ids?: number[] }) => {
      const ids = new Set(payload?.ids ?? []);
      if (!ids.size) return;
      const at = Math.floor(Date.now() / 1000);
      setNotices((list) =>
        sortNotices(list.map((n) => (ids.has(n.id) ? { ...n, resolvedAt: at } : n)))
      );
    };
    socket.on('connect', subscribe);
    socket.on('admin:notice', onNotice);
    socket.on('admin:notice:resolved', onResolved);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('admin:notice', onNotice);
      socket.off('admin:notice:resolved', onResolved);
    };
  }, [socket, enabled, reload, onNew]);

  const markSeen = useCallback(async () => {
    setUnread(0);
    await api.post('/api/admin-notices/seen', {}).catch(() => undefined);
  }, []);

  const dismiss = useCallback(async (id: number) => {
    const at = Math.floor(Date.now() / 1000);
    setNotices((list) =>
      sortNotices(list.map((n) => (n.id === id ? { ...n, resolvedAt: at } : n)))
    );
    await api.post(`/api/admin-notices/${id}/dismiss`, {}).catch(() => undefined);
  }, []);

  return { notices, unread, settings, markSeen, dismiss, reload };
}
