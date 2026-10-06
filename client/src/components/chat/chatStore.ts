/**
 * Chat (api/src/services/chatService.ts), shared by the dock and anything that
 * opens it: the viewer's chats (their match, their team, their party), the
 * messages of each chat read so far, and whether the dock is open.
 *
 * Live: one socket joins the player's room (`player:subscribe`) and, for an
 * admin, the admins' room (`admin:subscribe`); every `chat:message` lands in
 * its chat at once. The chat list is read again on every connect, when a
 * message arrives for a chat it does not know, and once a minute (a new match
 * or party shows up without a message).
 *
 * Admins open a match's chat from anywhere with `openChat('match:<slug>')`
 * (or the `at:open-chat` window event with `{ channel, title }` as its detail).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../../utils/api';

export type ChatKind = 'match' | 'team' | 'party';

export interface ChatMessage {
  id: number;
  channel: string;
  senderId: string | null;
  senderName: string;
  senderKind: 'player' | 'admin' | 'system';
  senderTeam: string | null;
  body: string;
  createdAt: number;
}

export interface ChatChannel {
  channel: string;
  kind: ChatKind;
  title: string;
  myTeam: string | null;
  unread: number;
  live?: boolean;
}

interface Thread {
  messages: ChatMessage[];
  /** Older messages may exist (the first page was full). */
  more: boolean;
  loading: boolean;
  myTeam: string | null;
  error: string | null;
}

interface State {
  channels: ChatChannel[];
  threads: Record<string, Thread>;
  open: boolean;
  active: string | null;
  /** The newest message from someone else that arrived while the dock was closed. */
  peek: ChatMessage | null;
}

const PAGE = 50;
const LIST_MS = 60_000;

let state: State = { channels: [], threads: {}, open: false, active: null, peek: null };
const listeners = new Set<() => void>();
let socket: Socket | null = null;
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let viewer: { steamId: string | null; isAdmin: boolean } = { steamId: null, isAdmin: false };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function setThread(channel: string, patch: Partial<Thread>) {
  const prev = state.threads[channel] ?? { messages: [], more: false, loading: false, myTeam: null, error: null };
  set({ threads: { ...state.threads, [channel]: { ...prev, ...patch } } });
}

export async function refreshChannels(): Promise<void> {
  if (!viewer.steamId && !viewer.isAdmin) return;
  try {
    const body = await api.get<{ channels: ChatChannel[] }>('/api/chat/channels');
    const channels = body.channels ?? [];
    // An admin's match chat opened from match details is not one of theirs: keep its tab.
    const extra = state.channels.filter((c) => c.kind === 'match' && !channels.some((x) => x.channel === c.channel) && c.channel === state.active);
    const active = state.active && [...channels, ...extra].some((c) => c.channel === state.active) ? state.active : (channels[0]?.channel ?? null);
    set({ channels: [...channels, ...extra], active });
  } catch {
    // Signed out or a blip: keep what we had.
  }
}

export async function loadMessages(channel: string, older = false): Promise<void> {
  const thread = state.threads[channel];
  if (thread?.loading) return;
  const before = older ? thread?.messages[0]?.id : undefined;
  setThread(channel, { loading: true, error: null });
  try {
    const body = await api.get<{ messages: ChatMessage[]; myTeam: string | null }>(
      `/api/chat/${encodeURIComponent(channel)}/messages${before ? `?before=${before}` : ''}`
    );
    const current = state.threads[channel]?.messages ?? [];
    const merged = older ? [...body.messages, ...current] : mergeById(current, body.messages);
    setThread(channel, { messages: merged, more: body.messages.length >= PAGE, loading: false, myTeam: body.myTeam });
  } catch (error) {
    setThread(channel, { loading: false, error: (error as Error).message });
  }
}

function mergeById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

function errorText(error: unknown): string {
  const raw = (error as Error).message ?? '';
  try {
    return (JSON.parse(raw) as { error?: string }).error ?? raw;
  } catch {
    return raw;
  }
}

/** Send a message; throws with the server's reason (too long, too fast, not yours). */
export async function sendMessage(channel: string, body: string): Promise<void> {
  try {
    const res = await api.post<{ message: ChatMessage }>(`/api/chat/${encodeURIComponent(channel)}/messages`, { body });
    receive(res.message);
  } catch (error) {
    throw new Error(errorText(error));
  }
}

export async function callAdmin(channel: string, message = ''): Promise<void> {
  try {
    await api.post(`/api/chat/${encodeURIComponent(channel)}/call-admin`, { message });
  } catch (error) {
    throw new Error(errorText(error));
  }
}

/** Mark the open chat read up to its newest message. */
export function markRead(channel: string): void {
  const last = state.threads[channel]?.messages.slice(-1)[0];
  const listed = state.channels.find((c) => c.channel === channel);
  if (listed && listed.unread > 0) {
    set({ channels: state.channels.map((c) => (c.channel === channel ? { ...c, unread: 0 } : c)) });
  }
  if (last && viewer.steamId) void api.post(`/api/chat/${encodeURIComponent(channel)}/read`, { lastId: last.id }).catch(() => undefined);
}

function receive(message: ChatMessage) {
  const thread = state.threads[message.channel];
  if (thread) setThread(message.channel, { messages: mergeById(thread.messages, [message]) });
  const mine = message.senderId !== null && message.senderId === viewer.steamId;
  const known = state.channels.some((c) => c.channel === message.channel);
  if (!known) {
    // An admin hears every match's chat; only the ones they opened matter here.
    if (viewer.isAdmin && message.channel.startsWith('match:')) return;
    void refreshChannels();
    return;
  }
  const reading = state.open && state.active === message.channel;
  if (mine) return;
  if (reading) {
    markRead(message.channel);
    return;
  }
  set({
    channels: state.channels.map((c) => (c.channel === message.channel ? { ...c, unread: c.unread + 1 } : c)),
    peek: state.open ? state.peek : message,
  });
}

function openSocket() {
  if (socket) return;
  socket = io({ autoConnect: true });
  socket.on('connect', () => {
    if (viewer.steamId) socket?.emit('player:subscribe');
    if (viewer.isAdmin) socket?.emit('admin:subscribe');
    void refreshChannels();
    if (state.open && state.active) void loadMessages(state.active);
  });
  socket.on('chat:message', (message: ChatMessage) => receive(message));
}

function closeSocket() {
  socket?.close();
  socket = null;
}

/** Open the dock, on `channel` when given (`title` names a chat that is not one of the viewer's own). */
export function openChat(channel?: string, title?: string): void {
  const active = channel ?? state.active ?? state.channels[0]?.channel ?? null;
  if (channel && !state.channels.some((c) => c.channel === channel)) {
    const ref = channel.replace(/^match:/, '');
    set({ channels: [...state.channels, { channel, kind: 'match', title: title ?? ref, myTeam: null, unread: 0 }] });
  }
  set({ open: true, active, peek: null });
  if (active) void loadMessages(active).then(() => markRead(active));
}

export function closeChat(): void {
  set({ open: false });
}

export function selectChat(channel: string): void {
  set({ active: channel });
  void loadMessages(channel).then(() => markRead(channel));
}

export function dismissPeek(): void {
  set({ peek: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The shared chat state. The dock calls it with who is signed in; it starts
 * the socket and the list for a player or an admin, and stops them otherwise.
 */
export function useChat(who?: { steamId: string | null; isAdmin: boolean }): State {
  const steamId = who?.steamId ?? null;
  const isAdmin = who?.isAdmin ?? false;
  useEffect(() => {
    if (!who) return undefined;
    if (!steamId && !isAdmin) return undefined;
    viewer = { steamId, isAdmin };
    users += 1;
    openSocket();
    void refreshChannels();
    if (!timer) timer = setInterval(() => void refreshChannels(), LIST_MS);
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: string; title?: string }>).detail;
      openChat(detail?.channel, detail?.title);
    };
    window.addEventListener('at:open-chat', onOpen);
    return () => {
      window.removeEventListener('at:open-chat', onOpen);
      users -= 1;
      if (users === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        closeSocket();
        viewer = { steamId: null, isAdmin: false };
        state = { channels: [], threads: {}, open: false, active: null, peek: null };
      }
    };
    // `who` itself changes every render; the ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamId, isAdmin]);
  return useSyncExternalStore(subscribe, () => state);
}
