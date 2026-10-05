/**
 * The signed-in player's matchmaking state (GET /api/matchmaking/me), shared
 * by every component that shows it: the Play page, the queue bar, the accept
 * dialog and the nav link. One poll for the whole app, every 2 s while
 * matchmaking is in use, every 20 s while idle, and every minute while it is
 * not available to this player (feature off, not open to players, signed
 * out), so turning it on shows up without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { apiErrorMessage } from '../../utils/api';

export interface MatchmakingMe {
  party: { id: string; leader: string; mode: string; inviteCode: string; members: string[] } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  lobby: {
    id: string;
    status: string;
    acceptDeadline: number;
    matchSlug: string | null;
    map: string | null;
    accepted: number;
    total: number;
    youAccepted: boolean;
    team: number;
  } | null;
  cooldownUntil: number | null;
}

interface State {
  /** null = not known yet. */
  available: boolean | null;
  me: MatchmakingMe | null;
  /** Server time minus local time, seconds; for countdowns. */
  skew: number;
}

let state: State = { available: null, me: null, skew: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let users = 0;

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function nextDelay(): number {
  if (!state.available) return 60_000;
  const me = state.me;
  return me?.queue || me?.lobby?.status === 'accepting' ? 2_000 : 20_000;
}

/** Fetch now; reschedule the next poll. */
export async function refreshMatchmaking(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    const res = await fetch('/api/matchmaking/me', { credentials: 'same-origin' });
    if (res.ok) {
      const body = (await res.json()) as MatchmakingMe;
      const date = Date.parse(res.headers.get('date') ?? '');
      const skew = Number.isFinite(date) ? Math.round((date - Date.now()) / 1000) : 0;
      emit({ available: true, me: body, skew });
    } else {
      emit({ available: false, me: null, skew: 0 });
    }
  } catch {
    // Network blip: keep what we had.
  }
  if (users > 0) timer = setTimeout(() => void refreshMatchmaking(), nextDelay());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The shared state; the first component that uses it starts the poll. */
export function useMatchmaking(): State {
  useEffect(() => {
    users += 1;
    if (users === 1) void refreshMatchmaking();
    return () => {
      users -= 1;
      if (users === 0 && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** A matchmaking write: same-site JSON (every write route requires a JSON body). */
export async function matchmakingAction<T = unknown>(
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown = {}
): Promise<T> {
  const res = await fetch(`/api/matchmaking${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(apiErrorMessage(new Error(text), `Request failed (${res.status})`));
  void refreshMatchmaking();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Seconds from now (server clock) until an epoch-seconds time. */
export function secondsUntil(epoch: number, skew: number): number {
  return Math.max(0, Math.ceil(epoch - (Date.now() / 1000 + skew)));
}
