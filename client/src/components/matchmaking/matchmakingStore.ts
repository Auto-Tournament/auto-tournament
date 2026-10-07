/**
 * The signed-in player's matchmaking state (GET /api/matchmaking/me), shared
 * by every component that shows it: the Play page, the queue bar, the accept
 * dialog and the nav link.
 *
 * Live: one socket for the whole app joins the player's room
 * (`player:subscribe`), and every `mm:changed` reads /me again at once. A
 * poll stays as the fallback: every 5 s while searching or answering, every
 * 30 s while idle, and every minute while matchmaking is not available to
 * this player, so turning it on shows up without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiErrorMessage } from '../../utils/api';

export interface MatchmakingMe {
  party: {
    id: string;
    leader: string;
    mode: string;
    inviteCode: string;
    members: string[];
    /** The members with names and avatars (older APIs: missing). */
    people?: Array<{ id: string; name: string; avatarUrl: string | null }>;
  } | null;
  queue: { mode: string; queuedAt: number; status: string } | null;
  /** Players searching right now, per mode. */
  queueCounts?: Record<string, number>;
  /** Signed-in players with the site open (older APIs: missing). */
  online?: number;
  /** Typical seconds to a match found, per mode; null with too little history. */
  waitSeconds?: Record<string, number | null>;
  /** Rounds per half and the map pool's name per mode (null pool = the default). */
  modeRules?: Record<string, { maxRounds: number; pool: string | null }>;
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
  /** 5v5 matchmaking rating (display Elo), once the player has played. */
  rating: { elo: number; games: number; wins: number } | null;
  /** The modes players can search on this site (5v5; 1v1 when an admin turned it on). */
  modes?: string[];
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
let socket: Socket | null = null;

function openSocket() {
  if (socket) return;
  socket = io({ autoConnect: true });
  // Rooms don't survive a reconnect: ask again on every connect, and read
  // the state in case something changed while disconnected.
  socket.on('connect', () => {
    socket?.emit('player:subscribe');
    void refreshMatchmaking();
  });
  socket.on('mm:changed', () => void refreshMatchmaking());
}

function closeSocket() {
  socket?.close();
  socket = null;
}

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function nextDelay(): number {
  if (!state.available) return 60_000;
  const me = state.me;
  return me?.queue || me?.lobby?.status === 'accepting' ? 5_000 : 30_000;
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
      // Live updates only for a viewer matchmaking is available to: the nav
      // uses this store on every page, for everyone.
      if (users > 0) openSocket();
    } else {
      emit({ available: false, me: null, skew: 0 });
      closeSocket();
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
      if (users === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        closeSocket();
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** A matchmaking write: same-site JSON (every write route requires a JSON body). */
export async function matchmakingAction<T = unknown>(
  method: 'POST' | 'PUT' | 'DELETE',
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

/** Players per team in `mode` ('5v5' → 5); the most a party can bring to it. */
export function teamSizeOf(mode: string): number {
  const m = /^(\d+)v\d+$/.exec(mode);
  return m ? Number(m[1]) : 5;
}

/** Players a match of `mode` needs ('5v5' → 10, '2v2' → 4, '1v1' → 2). */
export function playersFor(mode: string): number {
  const m = /^(\d+)v(\d+)$/.exec(mode);
  return m ? Number(m[1]) + Number(m[2]) : 10;
}
