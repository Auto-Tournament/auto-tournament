/**
 * The signed-in player's friends and notifications (GET /api/social/friends
 * and /api/social/notifications), shared by the bell, the invite toast, the
 * Friends page, the Play page and profiles.
 *
 * Live: one socket joins the player's room (`player:subscribe`). `notify:new`
 * puts a notice at the top of the bell (and a party invite in the toast);
 * `social:changed` reads the friends again. A slow poll is the fallback.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiErrorMessage } from '../../utils/api';
import { refreshMatchmaking } from '../matchmaking/matchmakingStore';

export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export type Activity = { kind: 'searching'; mode: string } | { kind: 'playing'; matchSlug: string; label: string } | null;

/** Whether you can invite them to a CS2 party: true, or why not. */
export type Invitable = true | 'nobody' | 'friends' | 'no_game';

export interface Friend extends Person {
  invite?: Invitable;
  online: boolean;
  lastSeenAt: number | null;
  activity: Activity;
  since: number;
}

export type Relation = 'self' | 'friend' | 'sent' | 'incoming' | 'none';

export interface Found extends Person {
  invite?: Invitable;
  relation: Relation;
  matches: number;
}

export interface Notice {
  id: number;
  kind: 'party_invite' | 'friend_request' | 'friend_accepted' | 'skin' | 'highlight' | 'tournament' | 'news'
    | 'report';
  data: Record<string, unknown>;
  createdAt: number;
  read: boolean;
}

interface State {
  /** False until the first load answered; stays false when signed out. */
  ready: boolean;
  friends: Friend[];
  incoming: Array<Person & { at: number }>;
  sent: Array<Person & { at: number }>;
  notices: Notice[];
  unread: number;
  more: boolean;
  /** Party invites that arrived while the page was open: the toast's queue. */
  toasts: Notice[];
}

const EMPTY: State = { ready: false, friends: [], incoming: [], sent: [], notices: [], unread: 0, more: false, toasts: [] };
let state: State = EMPTY;
const listeners = new Set<() => void>();
let users = 0;
let socket: Socket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function get<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function refreshFriends(): Promise<void> {
  try {
    const body = await get<Pick<State, 'friends' | 'incoming' | 'sent'>>('/api/social/friends');
    if (body) emit({ ready: true, friends: body.friends, incoming: body.incoming, sent: body.sent });
  } catch {
    // Network blip: keep what we had.
  }
}

export async function refreshNotices(): Promise<void> {
  try {
    const body = await get<{ items: Notice[]; unread: number; more: boolean }>('/api/social/notifications');
    if (body) emit({ ready: true, notices: body.items, unread: body.unread, more: body.more });
  } catch {
    // Keep what we had.
  }
}

export async function loadOlderNotices(): Promise<void> {
  const last = state.notices[state.notices.length - 1];
  if (!last) return;
  const body = await get<{ items: Notice[]; unread: number; more: boolean }>(`/api/social/notifications?before=${last.id}`);
  if (body) emit({ notices: [...state.notices, ...body.items], unread: body.unread, more: body.more });
}

function openSocket() {
  if (socket) return;
  socket = io({ autoConnect: true });
  socket.on('connect', () => {
    socket?.emit('player:subscribe');
    void refreshFriends();
    void refreshNotices();
  });
  socket.on('notify:new', (notice: Notice) => {
    const notices = [notice, ...state.notices.filter((n) => n.id !== notice.id)];
    const toasts = notice.kind === 'party_invite' ? [...state.toasts.filter((n) => n.data.partyId !== notice.data.partyId), notice] : state.toasts;
    emit({ notices, unread: state.unread + 1, toasts });
    if (notice.kind === 'party_invite') void refreshMatchmaking();
  });
  socket.on('social:changed', () => void refreshFriends());
}

function closeSocket() {
  socket?.close();
  socket = null;
}

function poll() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void Promise.all([refreshFriends(), refreshNotices()]).finally(() => {
      if (users > 0) poll();
    });
  }, 60_000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The shared state. `enabled` false (signed out, or an admin without a
 * player account) keeps it empty and opens nothing.
 */
export function useSocial(enabled = true): State {
  useEffect(() => {
    if (!enabled) return;
    users += 1;
    if (users === 1) {
      openSocket();
      void refreshFriends();
      void refreshNotices();
      poll();
    }
    return () => {
      users -= 1;
      if (users === 0) {
        closeSocket();
        if (timer) clearTimeout(timer);
        timer = null;
      }
    };
  }, [enabled]);
  const current = useSyncExternalStore(subscribe, () => state);
  return enabled ? current : EMPTY;
}

/** A social write: same-site JSON; reads friends and notices again after. */
export async function socialAction<T = unknown>(method: 'POST' | 'DELETE', path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(apiErrorMessage(new Error(text), `Request failed (${res.status})`));
  void refreshFriends();
  void refreshNotices();
  if (path.startsWith('/matchmaking')) void refreshMatchmaking();
  return (text ? JSON.parse(text) : {}) as T;
}

export const friendRequest = (playerId: string) => socialAction<{ relation: Relation }>('POST', '/social/friends/requests', { playerId });
export const acceptFriend = (playerId: string) => socialAction('POST', `/social/friends/requests/${playerId}/accept`);
export const declineFriend = (playerId: string) => socialAction('POST', `/social/friends/requests/${playerId}/decline`);
export const cancelFriendRequest = (playerId: string) => socialAction('DELETE', `/social/friends/requests/${playerId}`);
export const removeFriend = (playerId: string) => socialAction('DELETE', `/social/friends/${playerId}`);
export const inviteToParty = (playerId: string) => socialAction('POST', '/matchmaking/party/invites', { playerId });
export const cancelPartyInvite = (playerId: string) => socialAction('DELETE', `/matchmaking/party/invites/${playerId}`);
export const answerPartyInvite = (partyId: string, accept: boolean) =>
  socialAction('POST', `/matchmaking/invites/${partyId}/${accept ? 'accept' : 'decline'}`);

/** Mark notices read (all with no ids); the badge follows at once. */
export async function markNoticesRead(ids?: number[]): Promise<void> {
  const notices = state.notices.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
  emit({ notices, unread: ids ? Math.max(0, state.unread - ids.filter((id) => state.notices.some((n) => n.id === id && !n.read)).length) : 0 });
  try {
    const res = await fetch('/api/social/notifications/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    if (res.ok) emit({ unread: ((await res.json()) as { unread: number }).unread });
  } catch {
    // The next load corrects it.
  }
}

/** Drop a party invite from the toast queue (answered, closed or timed out). */
export function dismissToast(id: number): void {
  emit({ toasts: state.toasts.filter((n) => n.id !== id) });
}

/** Find players to add or invite: by name, or (empty query) people played with lately. */
export async function findPeople(q: string): Promise<Found[]> {
  const body = await get<{ people: Found[] }>(`/api/social/people${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  return body?.people ?? [];
}

export async function relationTo(playerId: string): Promise<Relation | null> {
  const body = await get<{ relation: Relation }>(`/api/social/relation/${playerId}`);
  return body?.relation ?? null;
}
