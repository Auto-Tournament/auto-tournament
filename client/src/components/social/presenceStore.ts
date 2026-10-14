/**
 * Player presence (GET /api/players/presence), shared by every name on the
 * page: ids asked for in the same moment go out in one request, answers are
 * kept for a while, and a match or matchmaking change on the socket asks again.
 */
import { useEffect, useState } from 'react';
import { api } from '../../utils/api';

export type PresenceActivity =
  | { kind: 'searching'; mode: string }
  | {
      kind: 'playing';
      source: 'matchmaking' | 'tournament' | 'match';
      matchSlug: string;
      label: string;
    };

export interface Presence {
  online: boolean;
  activity: PresenceActivity | null;
}

/** How long an answer is good for. */
const FRESH_MS = 30_000;

const known = new Map<string, { presence: Presence; at: number }>();
const listeners = new Set<() => void>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const res = await api.get<{ success: boolean; presence?: Record<string, Presence> }>(
        `/api/players/presence?ids=${encodeURIComponent(batch.join(','))}`
      );
      const at = Date.now();
      for (const [id, presence] of Object.entries(res.presence ?? {}))
        known.set(id, { presence, at });
    } catch {
      // Unknown for now: the names show without a status.
    }
  }
  notify();
}

/** Ask for these ids (soon, together with any others asked for now). */
export function requestPresence(ids: string[], force = false): void {
  const now = Date.now();
  for (const id of ids) {
    const k = known.get(id);
    if (force || !k || now - k.at > FRESH_MS) pending.add(id);
  }
  if (pending.size > 0 && !timer) timer = setTimeout(() => void flush(), 50);
}

/** Something changed (a match, the queue): everyone shown is asked about again. */
let lastRefresh = 0;
export function refreshAllPresence(): void {
  // Live scores send match updates every round: at most one ask per few seconds.
  if (Date.now() - lastRefresh < 5_000) return;
  lastRefresh = Date.now();
  requestPresence([...known.keys()], true);
}

/** The presence of each id (undefined until it is known); refreshed while mounted. */
export function usePresence(ids: string[]): Record<string, Presence | undefined> {
  const key = [...new Set(ids)].sort().join(',');
  const [, setTick] = useState(0);
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    requestPresence(list);
    const every = setInterval(() => requestPresence(list), FRESH_MS);
    return () => {
      listeners.delete(listener);
      clearInterval(every);
    };
  }, [key]);
  const out: Record<string, Presence | undefined> = {};
  for (const id of key ? key.split(',') : []) out[id] = known.get(id)?.presence;
  return out;
}
