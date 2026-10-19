import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { acquireSocket, onSharedSocket, releaseSocket } from '../utils/sharedSocket';
import type { Untrusted } from '../utils/untrusted';

/**
 * Re-read page data when the server says it changed, instead of polling.
 *
 * `topics` are the server's page topics (api services/socketService
 * `emitTopic`: `fleet`, `matchmaking`, `logs`, `demo-analysis`,
 * `highlights-admin`, `steam-health`); `events` are other socket events that
 * mean the same thing for this page (`match:update`, `bracket:update`,
 * `tournament:update`, `veto:update`, `server:status`, `mm:changed`…).
 * `reload` runs on any of them (at most once per 300 ms, the last call wins)
 * and once after every reconnect, since what was emitted while disconnected is
 * lost. Admin topics need `admin`: the socket joins the admins' room; player
 * events (`mm:changed`) need `player`.
 *
 * Every subscriber shares the page's one connection (utils/sharedSocket).
 */
export interface TopicOptions {
  events?: readonly string[];
  admin?: boolean;
  player?: boolean;
  /** False: subscribe to nothing (e.g. until the page knows what it shows). */
  enabled?: boolean;
}

interface Subscriber {
  topics: ReadonlySet<string>;
  admin: boolean;
  player: boolean;
  reload: () => void;
}

const THROTTLE_MS = 300;
const subscribers = new Set<Subscriber>();
let connectedBefore = false;

function joinRooms(s: Socket): void {
  const all = [...subscribers];
  if (all.some((x) => x.admin)) s.emit('admin:subscribe');
  if (all.some((x) => x.player)) s.emit('player:subscribe');
}

onSharedSocket((s) => {
  s.on('connect', () => {
    joinRooms(s);
    // A reconnect: everything emitted meanwhile is lost, so everyone re-reads.
    if (connectedBefore) for (const sub of subscribers) sub.reload();
    connectedBefore = true;
  });
  s.on('topic', (payload: { topic?: Untrusted }) => {
    const topic = typeof payload?.topic === 'string' ? payload.topic : null;
    if (!topic) return;
    for (const sub of subscribers) if (sub.topics.has(topic)) sub.reload();
  });
});

/** Calls `fn` at most once per `ms`, the last call after the wait. */
function throttled(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = Date.now();
    fn();
  };
  return {
    call: () => {
      if (timer) return;
      const wait = Math.max(0, last + ms - Date.now());
      if (wait === 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function useTopic(
  topics: string | readonly string[],
  reload: () => void,
  options: TopicOptions = {}
): void {
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const topicKey = (typeof topics === 'string' ? [topics] : [...topics]).join('|');
  const eventKey = (options.events ?? []).join('|');
  const admin = options.admin === true;
  const player = options.player === true;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) return undefined;
    const limiter = throttled(() => reloadRef.current(), THROTTLE_MS);
    const sub: Subscriber = {
      topics: new Set(topicKey ? topicKey.split('|') : []),
      admin,
      player,
      reload: limiter.call,
    };
    subscribers.add(sub);
    const s = acquireSocket();
    if (s.connected) {
      if (admin) s.emit('admin:subscribe');
      if (player) s.emit('player:subscribe');
    }
    const events = eventKey ? eventKey.split('|') : [];
    for (const event of events) s.on(event, limiter.call);
    return () => {
      for (const event of events) s.off(event, limiter.call);
      limiter.cancel();
      subscribers.delete(sub);
      releaseSocket();
    };
  }, [topicKey, eventKey, admin, player, enabled]);
}
