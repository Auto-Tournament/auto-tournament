/**
 * Discord's gateway websocket: the bot shows as online ("Watching 2
 * matches"), and slash commands arrive here when no Interactions Endpoint URL
 * is set (interactions.ts). Identify with no intents (commands come anyway),
 * heartbeat, and connect again when Discord closes it.
 *
 * Started and stopped with the add-on, and again when the token changes.
 */
import { WebSocket, type RawData } from 'ws';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import type { Untrusted } from '../../utils/untrusted';
import { botToken } from './bot';
import { handleGatewayInteraction } from './interactions';

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const STATUS_MS = 60_000;

let socket: WebSocket | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let retry: NodeJS.Timeout | null = null;
let seq: number | null = null;
let backoffMs = 5_000;
let running = false;
let lastStatus = '';

/** "Watching 2 matches", or "Watching the tournaments" with none live. */
export function statusText(live: number): string {
  if (live === 0) return 'the tournaments';
  return live === 1 ? '1 match' : `${live} matches`;
}

async function liveMatches(): Promise<number> {
  const row = await db.queryOneAsync<{ n: string }>(
    "SELECT COUNT(*) AS n FROM matches WHERE status = 'live'"
  );
  return Number(row?.n ?? 0);
}

function presence(name: string) {
  return { since: null, activities: [{ name, type: 3 }], status: 'online', afk: false };
}

function send(payload: object): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function updateStatus(): Promise<void> {
  const name = statusText(await liveMatches());
  if (name === lastStatus) return;
  lastStatus = name;
  send({ op: 3, d: presence(name) });
}

function clearTimers(): void {
  if (heartbeat) clearInterval(heartbeat);
  if (statusTimer) clearInterval(statusTimer);
  heartbeat = statusTimer = null;
}

async function connect(): Promise<void> {
  const token = await botToken();
  if (!running || !token) return;
  const ws = new WebSocket(GATEWAY);
  socket = ws;
  ws.on('message', (raw: RawData) => {
    let msg: { op?: number; s?: number | null; t?: string; d?: Record<string, Untrusted> | null };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.s === 'number') seq = msg.s;
    if (msg.op === 10) {
      // Hello: heartbeat on Discord's interval, then say who we are.
      const every = Number(msg.d?.heartbeat_interval ?? 41_250);
      heartbeat = setInterval(() => send({ op: 1, d: seq }), every);
      heartbeat.unref();
      lastStatus = '';
      void liveMatches()
        .catch(() => 0)
        .then((live) => {
          lastStatus = statusText(live);
          send({
            op: 2,
            d: {
              token,
              intents: 0,
              properties: { os: 'linux', browser: 'auto-tournament', device: 'auto-tournament' },
              presence: presence(lastStatus),
            },
          });
        });
      statusTimer = setInterval(() => void updateStatus().catch(() => undefined), STATUS_MS);
      statusTimer.unref();
    } else if (msg.op === 1) {
      send({ op: 1, d: seq });
    } else if (msg.op === 0 && msg.t === 'INTERACTION_CREATE' && msg.d) {
      void handleGatewayInteraction(msg.d).catch(() => undefined);
    } else if (msg.op === 0 && msg.d && (msg.d as { session_id?: string }).session_id) {
      backoffMs = 5_000; // READY: connected.
    } else if (msg.op === 7 || msg.op === 9) {
      // Reconnect asked, or the session is no good: start over.
      ws.close();
    }
  });
  ws.on('close', (code: number) => {
    clearTimers();
    if (socket === ws) socket = null;
    if (!running) return;
    // 4004: the token is wrong; no point trying again until it changes.
    if (code === 4004) {
      log.warn('[Discord] The gateway refused the bot token; the bot shows offline');
      return;
    }
    retry = setTimeout(() => void connect().catch(() => undefined), backoffMs);
    retry.unref();
    backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
  });
  ws.on('error', () => undefined);
}

export function startPresence(): void {
  if (running) return;
  running = true;
  void connect().catch(() => undefined);
}

export function stopPresence(): void {
  running = false;
  if (retry) clearTimeout(retry);
  retry = null;
  clearTimers();
  socket?.close();
  socket = null;
  seq = null;
}

/** A new token (or none): connect again with it. */
export function restartPresence(): void {
  if (!running) return;
  stopPresence();
  startPresence();
}
