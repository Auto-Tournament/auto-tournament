import { useEffect, useState } from 'react';
import { useSocket } from './useSocket';
import { onSocketReconnect } from '../utils/socketResync';
import type { CompatRunSummary, CompatSnapshot, CompatUpdateEvent } from '../types/compat.types';

/** Runs shown in the history list. */
export const COMPAT_HISTORY_SHOWN = 20;

export type CompatLoadState = 'loading' | 'ready' | 'disabled' | 'error';

export interface CompatData {
  state: CompatLoadState;
  latest: CompatSnapshot | null;
  runs: CompatRunSummary[];
  /** The socket is connected, so updates arrive as they happen. */
  live: boolean;
}

/** Newest first, as the API sorts: by start, then by arrival. */
function upsertRun(runs: CompatRunSummary[], run: CompatRunSummary): CompatRunSummary[] {
  const next = runs.filter((r) => r.run.id !== run.run.id);
  next.push(run);
  next.sort((a, b) => (a.run.started_at < b.run.started_at ? 1 : a.run.started_at > b.run.started_at ? -1 : 0));
  return next.slice(0, COMPAT_HISTORY_SHOWN);
}

type Loaded =
  | { state: 'ready'; latest: CompatSnapshot | null; runs: CompatRunSummary[] }
  | { state: 'disabled' | 'error' };

/** Both reads at once. Never throws: a 404 means the instance has compatibility off. */
async function fetchCompat(): Promise<Loaded> {
  try {
    const [latestRes, runsRes] = await Promise.all([
      fetch('/api/compat/latest', { credentials: 'same-origin' }),
      fetch(`/api/compat/runs?limit=${COMPAT_HISTORY_SHOWN}`, { credentials: 'same-origin' }),
    ]);
    if (latestRes.status === 404 || runsRes.status === 404) return { state: 'disabled' };
    if (!latestRes.ok || !runsRes.ok) return { state: 'error' };
    const latest = ((await latestRes.json()) as { latest: CompatSnapshot | null }).latest;
    const runs = ((await runsRes.json()) as { runs: CompatRunSummary[] }).runs;
    return { state: 'ready', latest, runs };
  } catch {
    return { state: 'error' };
  }
}

/**
 * The public compatibility page's data: the newest run and recent history
 * from the API, then kept current by the `compat:update` socket event (the
 * page joins the `compat` room on every connect, and refetches after a
 * reconnect, since nothing sent while it was away is replayed).
 */
export function useCompat(): CompatData {
  const socket = useSocket();
  const [state, setState] = useState<CompatLoadState>('loading');
  const [latest, setLatest] = useState<CompatSnapshot | null>(null);
  const [runs, setRuns] = useState<CompatRunSummary[]>([]);
  const [live, setLive] = useState(socket.connected);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchCompat().then((loaded) => {
        if (cancelled) return;
        if (loaded.state === 'ready') {
          setLatest(loaded.latest);
          setRuns(loaded.runs);
        }
        setState(loaded.state);
      });
    };
    const subscribe = () => {
      socket.emit('compat:subscribe');
      setLive(true);
    };
    const handleDisconnect = () => setLive(false);
    const handleUpdate = (event: CompatUpdateEvent) => {
      setLatest(event.latest);
      setRuns((current) => upsertRun(current, event.run));
      setState('ready');
    };

    refresh();
    if (socket.connected) socket.emit('compat:subscribe');
    socket.on('connect', subscribe);
    socket.on('disconnect', handleDisconnect);
    socket.on('compat:update', handleUpdate);
    const stopResync = onSocketReconnect(socket, refresh);
    return () => {
      cancelled = true;
      stopResync();
      socket.off('connect', subscribe);
      socket.off('disconnect', handleDisconnect);
      socket.off('compat:update', handleUpdate);
    };
  }, [socket]);

  return { state, latest, runs, live };
}

/** The current time, updated every `intervalMs`, for "checked 3 minutes ago". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
