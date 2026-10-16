/**
 * Player presence (GET /api/players/presence), shared by every name and
 * avatar on the page: ids asked for in the same moment go out in one request,
 * answers are kept for a while, and a match or matchmaking change on the
 * socket asks again.
 *
 * Live: one socket for the whole page joins the `presence` room and applies
 * `presence:update` { playerId, status } as it comes. For a signed-in player
 * the same socket also says when this tab goes idle (5 minutes without
 * pointer, keyboard, focus or visibility) and comes back: the server shows
 * them away when every tab they have open is idle.
 */
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../../utils/api';

export type PresenceActivity =
  | { kind: 'searching'; mode: string }
  | {
      kind: 'playing';
      source: 'matchmaking' | 'tournament' | 'match';
      matchSlug: string;
      label: string;
    };

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface Presence {
  online: boolean;
  /** Online, away or offline (older servers send only `online`). */
  status?: PresenceStatus;
  activity: PresenceActivity | null;
}

export function presenceStatus(p: Presence): PresenceStatus {
  return p.status ?? (p.online ? 'online' : 'offline');
}

/** No input in the tab for this long: away. */
export const IDLE_AFTER_MS = 5 * 60_000;

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

let socket: Socket | null = null;
let connectedBefore = false;
/** This tab reports its idle state (a signed-in player). */
let reporting = false;
let idle = false;

function shared(): Socket {
  if (socket) return socket;
  const s = io({ autoConnect: false });
  s.on('connect', () => {
    s.emit('presence:subscribe');
    if (reporting) {
      s.emit('player:subscribe');
      s.emit('presence:idle', idle);
    }
    // Updates sent while disconnected are lost: ask about everyone again.
    if (connectedBefore) requestPresence([...known.keys()], true);
    connectedBefore = true;
  });
  s.on('presence:update', (u: { playerId?: unknown; status?: unknown }) => {
    if (typeof u?.playerId !== 'string') return;
    if (u.status !== 'online' && u.status !== 'away' && u.status !== 'offline') return;
    const k = known.get(u.playerId);
    if (!k) return;
    const status: PresenceStatus = u.status;
    // Gone offline: whatever they were doing on the site is over too.
    const activity = status === 'offline' ? null : k.presence.activity;
    known.set(u.playerId, {
      presence: { ...k.presence, online: status !== 'offline', status, activity },
      at: k.at,
    });
    notify();
  });
  s.connect();
  socket = s;
  return s;
}

/**
 * Report this tab's idle state while a signed-in player has it open: idle
 * after IDLE_AFTER_MS without pointer, keyboard, focus or visibility, back on
 * the next one. Returns the stop.
 */
export function startPresenceReporting(): () => void {
  reporting = true;
  idle = false;
  // A fresh connection: one opened before sign-in has no player in its handshake.
  socket?.close();
  socket = null;
  shared();
  let last = Date.now();
  let check: ReturnType<typeof setTimeout> | null = null;
  const setIdle = (next: boolean) => {
    if (idle === next) return;
    idle = next;
    if (socket?.connected) socket.emit('presence:idle', next);
  };
  const arm = () => {
    if (check) clearTimeout(check);
    check = setTimeout(
      () => {
        check = null;
        if (Date.now() - last >= IDLE_AFTER_MS) setIdle(true);
        else arm();
      },
      Math.max(1_000, IDLE_AFTER_MS - (Date.now() - last))
    );
  };
  const active = () => {
    last = Date.now();
    setIdle(false);
    if (!check) arm();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') active();
  };
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'];
  for (const e of events) window.addEventListener(e, active, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  arm();
  return () => {
    reporting = false;
    if (check) clearTimeout(check);
    for (const e of events) window.removeEventListener(e, active);
    document.removeEventListener('visibilitychange', onVisibility);
    // Signed out: this socket's handshake still names the player; a fresh one does not.
    socket?.close();
    socket = null;
    if (listeners.size > 0) shared();
  };
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
    shared();
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
