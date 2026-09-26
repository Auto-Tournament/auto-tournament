import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from './useSocket';
import { api } from '../utils/api';
import {
  isAdminCallSoundMuted,
  playAdminCallSound,
  setAdminCallSoundMuted,
} from '../utils/adminCallSound';
import type { AdminCall, AdminCallResolvedEvent } from '../types/adminCall';

interface UseAdminCallsReturn {
  /** Open calls, oldest first. */
  calls: AdminCall[];
  /** Resolve one call. Throws when the API refuses. */
  resolve: (id: number) => Promise<void>;
  /** Resolve every open call. Throws when the API refuses. */
  resolveAll: () => Promise<void>;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** The browser will not play a sound until the admin interacts with the page. */
  soundBlocked: boolean;
  /** Play the sound from a click, which unlocks audio for the next calls. */
  enableSound: () => void;
}

function hasUserActivation(): boolean {
  const activation = (
    navigator as typeof navigator & { userActivation?: { hasBeenActive: boolean } }
  ).userActivation;
  // Browsers without the API: assume sound may play, and find out on the first call.
  return activation ? activation.hasBeenActive : true;
}

function byCalledAt(a: AdminCall, b: AdminCall): number {
  return a.calledAt.localeCompare(b.calledAt) || a.id - b.id;
}

/**
 * Open admin calls for a signed-in admin, kept live.
 *
 * Loads the open calls on mount, then joins the admin room on every socket
 * `connect` (rooms do not survive a reconnect) and reloads once the server
 * has let it in, so nothing emitted in between is missed. `admin:call` adds a
 * call and rings; `admin:call:resolved` (anyone's resolve) removes it.
 */
export function useAdminCalls(): UseAdminCallsReturn {
  const socket = useSocket();
  const [calls, setCalls] = useState<AdminCall[]>([]);
  const [muted, setMutedState] = useState<boolean>(() => isAdminCallSoundMuted());
  const [soundBlocked, setSoundBlocked] = useState<boolean>(() => !hasUserActivation());
  const knownIds = useRef<Set<number>>(new Set());
  // What the socket changed while a load was in flight: the load's answer can
  // be older than a live call or resolve, and must not undo it.
  const pendingLoads = useRef<Set<{ added: Map<number, AdminCall>; resolved: Set<number> }>>(
    new Set()
  );
  const loadSeq = useRef(0);
  const appliedSeq = useRef(0);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const replaceCalls = useCallback((next: AdminCall[]) => {
    const sorted = [...next].sort(byCalledAt);
    knownIds.current = new Set(sorted.map((c) => c.id));
    setCalls(sorted);
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const live = { added: new Map<number, AdminCall>(), resolved: new Set<number>() };
    pendingLoads.current.add(live);
    try {
      const res = await api.get<{ success: boolean; open: AdminCall[] }>(
        '/api/admin-calls?resolvedWithin=0'
      );
      // A newer load already answered: this one is older news.
      if (seq < appliedSeq.current) return;
      if (res.success && Array.isArray(res.open)) {
        appliedSeq.current = seq;
        const open = res.open.filter((c) => !live.resolved.has(c.id));
        const ids = new Set(open.map((c) => c.id));
        live.added.forEach((call, id) => {
          if (!ids.has(id)) open.push(call);
        });
        replaceCalls(open);
      }
    } catch (error) {
      // Not signed in as an admin any more, or the API is away: keep what is shown.
      console.warn('Could not load admin calls:', error);
    } finally {
      pendingLoads.current.delete(live);
    }
  }, [replaceCalls]);

  const ring = useCallback(() => {
    if (mutedRef.current) return;
    void playAdminCallSound().then((result) => {
      if (result === 'blocked') setSoundBlocked(true);
      else if (result === 'played') setSoundBlocked(false);
    });
  }, []);

  /** Resolved calls leave, and a load in flight must not bring them back. */
  const forget = useCallback((ids: Set<number>) => {
    ids.forEach((id) => {
      knownIds.current.delete(id);
      pendingLoads.current.forEach((live) => {
        live.added.delete(id);
        live.resolved.add(id);
      });
    });
    setCalls((prev) => prev.filter((c) => !ids.has(c.id)));
  }, []);

  useEffect(() => {
    // The state is set after the fetch resolves, not synchronously.
    void load();
  }, [load]);

  useEffect(() => {
    const subscribe = () => {
      socket.emit('admin:subscribe', (ack?: { ok?: boolean }) => {
        if (ack?.ok) void load();
      });
    };
    const handleCall = (call: AdminCall) => {
      if (!call || typeof call.id !== 'number' || call.resolvedAt) return;
      if (knownIds.current.has(call.id)) return;
      knownIds.current.add(call.id);
      pendingLoads.current.forEach((live) => live.added.set(call.id, call));
      setCalls((prev) => [...prev.filter((c) => c.id !== call.id), call].sort(byCalledAt));
      ring();
    };
    const handleResolved = (payload: AdminCallResolvedEvent) => {
      const ids = new Set(payload?.ids ?? []);
      if (ids.size === 0) return;
      forget(ids);
    };

    socket.on('connect', subscribe);
    socket.on('admin:call', handleCall);
    socket.on('admin:call:resolved', handleResolved);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('admin:call', handleCall);
      socket.off('admin:call:resolved', handleResolved);
    };
  }, [socket, load, ring, forget]);

  // Any click or key press lets the browser play sound from then on.
  useEffect(() => {
    if (!soundBlocked) return;
    const unlock = () => {
      if (hasUserActivation()) setSoundBlocked(false);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [soundBlocked]);

  const removeLocally = useCallback((ids: number[]) => forget(new Set(ids)), [forget]);

  const resolve = useCallback(
    async (id: number) => {
      await api.post(`/api/admin-calls/${id}/resolve`, {});
      removeLocally([id]);
    },
    [removeLocally]
  );

  const resolveAll = useCallback(async () => {
    const res = await api.post<{ resolved?: number[] }>('/api/admin-calls/resolve-all', {});
    removeLocally(res.resolved ?? []);
    // Anything that arrived meanwhile stays; reload to be sure of the rest.
    await load();
  }, [removeLocally, load]);

  const setMuted = useCallback((next: boolean) => {
    setAdminCallSoundMuted(next);
    setMutedState(next);
  }, []);

  const enableSound = useCallback(() => {
    void playAdminCallSound({ ignoreMute: true }).then((result) => {
      setSoundBlocked(result === 'blocked');
    });
    setAdminCallSoundMuted(false);
    setMutedState(false);
  }, []);

  return { calls, resolve, resolveAll, muted, setMuted, soundBlocked, enableSound };
}
