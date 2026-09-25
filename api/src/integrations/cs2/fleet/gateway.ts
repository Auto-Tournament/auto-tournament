/**
 * The fleet WebSocket gateway: `/api/fleet/ws` on the API's own HTTP server
 * (FLEET.md §5, §6, §19.2 item 1).
 *
 * - Auth: `Authorization: Bearer rus_…` on the upgrade. The handshake always
 *   completes and a rejected token is answered with a close code (4401 bad,
 *   4403 revoked), which is what Ready Up's backoff keys on (§6.3).
 * - Every frame is one JSON envelope, validated with ajv against
 *   ./protocol/v1; the first must be `hello`, answered with `welcome`.
 * - Reliable messages (with `seq`) are processed in order, deduplicated and
 *   acked (piggybacked, or a standalone `ack` within 1 s / 32 messages).
 *   The platform's own reliable messages go through the outbox in the
 *   database and are replayed after a reconnect until acked (§6.4).
 * - Heartbeat: ping every 10 s, link dead after 30 s without a frame.
 * - Presence: `online`, `last_seen`, versions and health in
 *   `cs2_fleet_servers`.
 *
 * Callers send through `FleetBus` (./bus), never through this class, so a
 * multi-instance bus can replace the in-process one (D15).
 */

import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { log } from '../../../utils/logger';
import { redactFleetSecrets, ulid } from './credentials';
import {
  FLEET_CLOSE,
  FLEET_MESSAGES,
  FLEET_PROTOCOL_SUPPORTED,
  isKnownMessageType,
  validateEnvelope,
  validateMessage,
  validatePayload,
  type Envelope,
  type HelloPayload,
  type PingPayload,
  type WelcomePayload,
} from './protocol/v1';
import * as registry from './registry';

export const FLEET_WS_PATH = '/api/fleet/ws';
export const MAX_FRAME_BYTES = 1024 * 1024;
export const HEARTBEAT = { interval_ms: 10_000, timeout_ms: 30_000 } as const;
/** How long a new connection has to send hello. */
const HELLO_TIMEOUT_MS = 10_000;
/** Ack a reliable message within this long, or after this many (FLEET.md §5). */
const ACK_DELAY_MS = 1_000;
const ACK_EVERY = 32;
/** Per-server limits (FLEET.md §15). */
const RATE = { perSecond: 50, burst: 200, bytesPerMinute: 8 * 1024 * 1024 };
/** last_seen is written at most this often from pings and other frames. */
const SEEN_WRITE_MS = 10_000;
const ID_WINDOW = 10_000;

/** Test hook: shorter timers. Only read when the gateway is created. */
export interface GatewayTimings {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  helloTimeoutMs: number;
}

function closeReason(text: string): string {
  // A close reason is at most 123 bytes of UTF-8.
  const buf = Buffer.from(text, 'utf8');
  return buf.length <= 123 ? text : buf.subarray(0, 120).toString('utf8') + '…';
}

function bearer(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(raw);
  return m ? m[1] : null;
}

type Auth = Awaited<ReturnType<typeof registry.verifyServerToken>>;

class FleetSession {
  readonly connId = ulid();
  sessionId: string | null = null;
  serverId: string | null = null;
  private installId: string | null = null;
  private ready = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private rxSeq = 0;
  private rxStreamId: string | null = null;
  /** After a `reset` resume, the first reliable message sets the base. */
  private rxBaseUnknown = false;
  private txAcked = 0;
  /** Highest platform seq written to this socket. */
  private lastSentSeq = 0;
  private sendChain: Promise<void> = Promise.resolve();
  private acksOwed = 0;
  private ackTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private deadTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private lastSeenWrite = 0;
  private tokens: number = RATE.burst;
  private tokensAt = Date.now();
  private bytesWindowStart = Date.now();
  private bytesInWindow = 0;
  private seenIds = new Set<string>();
  private seenOrder: string[] = [];

  constructor(
    private readonly gateway: FleetGateway,
    readonly ws: WebSocket,
    auth: Promise<Auth>,
    private readonly timings: GatewayTimings
  ) {
    this.helloTimer = setTimeout(() => this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'hello timeout'), timings.helloTimeoutMs);
    this.bumpDeadTimer();
    ws.on('message', (data, isBinary) => this.onFrame(data, isBinary));
    ws.on('close', () => this.onClosed());
    ws.on('error', (error) => log.warn(`[FLEET] socket error (${this.serverId ?? 'unauthenticated'}): ${error.message}`));
    // Frames that arrive before the token check finishes wait in the queue.
    this.queue = auth
      .then((result) => {
        if (!result.ok) {
          const code = result.reason === 'revoked' ? FLEET_CLOSE.REVOKED : FLEET_CLOSE.BAD_TOKEN;
          log.warn(`[FLEET] rejected a connection: ${result.reason === 'revoked' ? 'revoked or expired token' : 'invalid token'}`);
          this.close(code, result.reason === 'revoked' ? 'token revoked' : 'invalid token');
          return;
        }
        this.serverId = result.server.id;
        this.installId = result.server.install_id;
      })
      .catch((error) => {
        log.error(`[FLEET] token check failed: ${(error as Error).message}`);
        this.close(1011, 'internal error');
      });
  }

  get isReady(): boolean {
    return this.ready && !this.closed;
  }

  // --- inbound ---------------------------------------------------------------

  private onFrame(data: RawData, isBinary: boolean): void {
    if (this.closed) return;
    this.bumpDeadTimer();
    const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : (data as Buffer).byteLength;
    const limited = this.rateLimited(size);
    if (limited !== null) {
      this.close(FLEET_CLOSE.RATE_LIMITED, JSON.stringify({ retry_after_ms: limited }));
      return;
    }
    if (isBinary) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'binary frames are not part of the protocol');
      return;
    }
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString();
    this.queue = this.queue
      .then(() => (this.closed || !this.serverId ? undefined : this.handle(text)))
      .catch((error) => {
        log.error(`[FLEET] ${this.serverId}: handling a message failed: ${redactFleetSecrets((error as Error).message)}`);
        this.close(1011, 'internal error');
      });
  }

  /** Milliseconds to wait when over the limit, else null. */
  private rateLimited(bytes: number): number | null {
    const now = Date.now();
    this.tokens = Math.min(RATE.burst, this.tokens + ((now - this.tokensAt) / 1000) * RATE.perSecond);
    this.tokensAt = now;
    if (now - this.bytesWindowStart >= 60_000) {
      this.bytesWindowStart = now;
      this.bytesInWindow = 0;
    }
    this.bytesInWindow += bytes;
    if (this.bytesInWindow > RATE.bytesPerMinute) return this.bytesWindowStart + 60_000 - now;
    if (this.tokens < 1) return Math.ceil(((1 - this.tokens) / RATE.perSecond) * 1000);
    this.tokens -= 1;
    return null;
  }

  private async handle(text: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'frame is not JSON');
      return;
    }
    const env = validateEnvelope(value);
    if (!env.ok) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, `invalid envelope: ${env.errors[0] ?? ''}`);
      return;
    }
    const msg = value as Envelope;

    if (this.seenIds.has(msg.id)) return;
    this.rememberId(msg.id);

    if (!this.ready) {
      if (msg.type !== 'hello') {
        this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'expected hello');
        return;
      }
      await this.onHello(msg as unknown as Envelope<'hello', HelloPayload>);
      return;
    }

    this.touchSeen();
    if (typeof msg.ack === 'number' && msg.ack > this.txAcked) {
      this.txAcked = msg.ack;
      await registry.ackOutbox(this.serverId as string, msg.ack);
    }

    if (msg.seq !== undefined) {
      await this.onReliable(msg);
      return;
    }
    await this.onEphemeral(msg);
  }

  private async onReliable(msg: Envelope): Promise<void> {
    const seq = msg.seq as number;
    if (this.rxBaseUnknown) {
      this.rxSeq = seq - 1;
      this.rxBaseUnknown = false;
    }
    if (seq <= this.rxSeq) {
      // Already processed (a replay after a lost ack): ack it again.
      this.owe(true);
      return;
    }
    if (seq !== this.rxSeq + 1) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, `seq gap: expected ${this.rxSeq + 1}, got ${seq}`);
      return;
    }
    const known = isKnownMessageType(msg.type) && FLEET_MESSAGES[msg.type].direction !== 'platform_to_server';
    if (!known) {
      this.sendError(msg, 'unknown_type', `unknown message type ${msg.type}`);
    } else {
      const check = validatePayload(msg.type, msg.payload);
      if (!check.ok) {
        this.sendError(msg, 'invalid_payload', check.errors.join('; '));
      } else if (msg.type === 'auth.rotated') {
        await registry.confirmRotation(this.serverId as string);
        log.info(`[FLEET] ${this.serverId}: rotated its token`);
      }
    }
    // Processed (or rejected for good): durable, then acked.
    this.rxSeq = seq;
    await registry.setRxState(this.serverId as string, this.rxStreamId as string, seq);
    this.owe();
  }

  private async onEphemeral(msg: Envelope): Promise<void> {
    switch (msg.type) {
      case 'ping': {
        const check = validatePayload('ping', msg.payload);
        if (!check.ok) {
          this.sendError(msg, 'invalid_payload', check.errors.join('; '));
          return;
        }
        const payload = msg.payload as unknown as PingPayload;
        this.sendEphemeral('pong', { t: payload.t }, msg.id);
        if (payload.health) this.touchSeen(payload.health, true);
        return;
      }
      case 'pong':
      case 'ack':
        return;
      case 'error': {
        const p = msg.payload as { code?: unknown; message?: unknown };
        log.warn(
          `[FLEET] ${this.serverId} reported an error: ${String(p.code)} ${redactFleetSecrets(String(p.message ?? ''))}`
        );
        return;
      }
      case 'hello':
        this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'hello sent twice');
        return;
      default:
        // Unknown ephemeral types are ignored (FLEET.md §5).
        return;
    }
  }

  private async onHello(msg: Envelope<'hello', HelloPayload>): Promise<void> {
    const check = validatePayload('hello', msg.payload);
    if (!check.ok) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, `invalid hello: ${check.errors[0] ?? ''}`);
      return;
    }
    const hello = msg.payload;
    const serverId = this.serverId as string;
    if (hello.server_id !== serverId) {
      this.close(FLEET_CLOSE.REVOKED, 'server_id does not match the token');
      return;
    }
    if (this.installId && hello.install_id !== this.installId) {
      log.warn(`[FLEET] ${serverId}: hello install_id does not match the enrolled one; copied credentials?`);
      this.close(FLEET_CLOSE.REVOKED, 'install_id does not match the enrollment');
      return;
    }
    if (hello.protocol.min > FLEET_PROTOCOL_SUPPORTED.max || hello.protocol.max < FLEET_PROTOCOL_SUPPORTED.min) {
      this.close(
        FLEET_CLOSE.UNSUPPORTED_PROTOCOL,
        `protocol ${hello.protocol.min}-${hello.protocol.max} unsupported; platform speaks ${FLEET_PROTOCOL_SUPPORTED.min}-${FLEET_PROTOCOL_SUPPORTED.max}`
      );
      return;
    }
    const protocol = Math.min(hello.protocol.max, FLEET_PROTOCOL_SUPPORTED.max);

    // Resume (§6.4): the server's stream, and what it has of ours.
    const stream = await registry.getStreamState(serverId);
    let result: 'resumed' | 'reset';
    if (stream.rxStreamId === hello.stream.id && hello.stream.last_tx_seq >= stream.rxSeq) {
      result = 'resumed';
      this.rxSeq = stream.rxSeq;
    } else {
      result = 'reset';
      this.rxSeq = 0;
      this.rxBaseUnknown = true;
    }
    this.rxStreamId = hello.stream.id;
    if (result === 'reset') await registry.setRxState(serverId, hello.stream.id, 0);
    if (hello.stream.last_rx_seq > 0) {
      await registry.ensureTxSeqAtLeast(serverId, hello.stream.last_rx_seq);
      await registry.ackOutbox(serverId, hello.stream.last_rx_seq);
    }
    this.txAcked = Math.max(stream.txAcked, hello.stream.last_rx_seq);

    if (this.closed) return;
    this.sessionId = ulid();
    this.gateway.register(this);
    await registry.markConnected(serverId, this.sessionId, {
      availability: hello.availability,
      versions: hello.versions,
      capabilities: hello.capabilities,
      host: hello.host,
      selftest: hello.selftest,
      protocol,
      boot_id: hello.boot_id,
    });
    if (this.closed) {
      // The socket went while we were writing; do not leave it marked online.
      await registry.markDisconnected(serverId, this.sessionId);
      return;
    }
    this.lastSeenWrite = Date.now();
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;

    const welcome: WelcomePayload = {
      session_id: this.sessionId,
      protocol,
      heartbeat: { interval_ms: this.timings.heartbeatIntervalMs, timeout_ms: this.timings.heartbeatTimeoutMs },
      resume: { result, platform_last_rx_seq: this.rxSeq },
      server_config_rev: 0,
      admins_rev: 0,
      assignment: null,
    };
    this.ready = true;
    this.sendEphemeral('welcome', welcome as unknown as Record<string, unknown>, msg.id);
    log.info(
      `[FLEET] ${serverId} online (session ${this.sessionId}, protocol ${protocol}, core ${hello.versions.core}, resume ${result})`
    );

    // Replay what the server has not processed of ours.
    this.lastSentSeq = hello.stream.last_rx_seq;
    await this.flushOutbox();
    this.pingTimer = setInterval(() => this.sendEphemeral('ping', { t: Date.now() }), this.timings.heartbeatIntervalMs);
    await this.gateway.onReady(serverId);
  }

  // --- outbound --------------------------------------------------------------

  private frame(env: Envelope): string | null {
    const out: Envelope = { ...env, ack: this.rxSeq };
    const check = validateMessage(out);
    if (!check.ok) {
      log.error(`[FLEET] refusing to send an invalid ${env.type}: ${check.errors.join('; ')}`);
      return null;
    }
    return JSON.stringify(out);
  }

  private write(text: string): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(text);
    // Every frame carries our ack.
    this.acksOwed = 0;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  sendEphemeral(type: string, payload: Record<string, unknown>, ref?: string): boolean {
    const text = this.frame({ v: 1, type, id: ulid(), ts: Date.now(), ...(ref ? { ref } : {}), payload });
    if (text === null) return false;
    this.write(text);
    return true;
  }

  /**
   * Send every outbox message after the last one sent on this session, in seq
   * order. Serialized, so a message queued while the replay after `welcome`
   * runs cannot overtake it. Resolves true when something was sent.
   */
  flushOutbox(): Promise<boolean> {
    const run = this.sendChain.then(async () => {
      if (this.closed || !this.serverId) return false;
      let sent = false;
      for (const env of await registry.pendingOutbox(this.serverId, this.lastSentSeq)) {
        if (this.closed) break;
        await this.sendReliable(env);
        this.lastSentSeq = env.seq as number;
        sent = true;
      }
      return sent;
    });
    this.sendChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** Send one outbox message. `auth.rotate` gets its secret minted here. */
  private async sendReliable(env: Envelope): Promise<boolean> {
    let out = env;
    if (env.type === 'auth.rotate') {
      const p = env.payload as { token_id?: string; old_valid_until?: number };
      const token = p.token_id ? await registry.mintRotationSecret(p.token_id) : null;
      if (!token) {
        log.warn(`[FLEET] ${this.serverId}: auth.rotate seq ${env.seq} is stale; not sent`);
        return false;
      }
      out = { ...env, payload: { token, old_valid_until: p.old_valid_until } };
    }
    const text = this.frame(out);
    if (text === null) return false;
    this.write(text);
    return true;
  }

  private sendError(about: Envelope, code: string, message: string): void {
    this.sendEphemeral('error', { code, message: message.slice(0, 2000), type: about.type }, about.id);
  }

  private owe(now = false): void {
    this.acksOwed += 1;
    if (now || this.acksOwed >= ACK_EVERY) {
      this.sendEphemeral('ack', {});
      return;
    }
    if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        if (this.acksOwed > 0) this.sendEphemeral('ack', {});
      }, ACK_DELAY_MS);
    }
  }

  // --- liveness --------------------------------------------------------------

  private bumpDeadTimer(): void {
    if (this.deadTimer) clearTimeout(this.deadTimer);
    this.deadTimer = setTimeout(() => {
      log.warn(`[FLEET] ${this.serverId ?? 'connection'}: no frame for ${this.timings.heartbeatTimeoutMs} ms; link dead`);
      this.closed = true;
      this.ws.terminate();
    }, this.timings.heartbeatTimeoutMs);
  }

  private touchSeen(health?: unknown, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSeenWrite < SEEN_WRITE_MS) return;
    this.lastSeenWrite = now;
    void registry.markSeen(this.serverId as string, health).catch((error) => {
      log.warn(`[FLEET] ${this.serverId}: last_seen update failed: ${(error as Error).message}`);
    });
  }

  private rememberId(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > ID_WINDOW) {
      const old = this.seenOrder.shift();
      if (old) this.seenIds.delete(old);
    }
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, closeReason(reason));
    } catch {
      this.ws.terminate();
    }
  }

  private onClosed(): void {
    this.closed = true;
    for (const t of [this.ackTimer, this.deadTimer, this.helloTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.gateway.unregister(this);
  }
}

export class FleetGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, FleetSession>();
  private readonly connections = new Set<FleetSession>();
  private server: HttpServer | null = null;
  private readyListeners: Array<(serverId: string) => Promise<void> | void> = [];
  private readonly timings: GatewayTimings;

  constructor(timings: Partial<GatewayTimings> = {}) {
    this.timings = {
      heartbeatIntervalMs: timings.heartbeatIntervalMs ?? HEARTBEAT.interval_ms,
      heartbeatTimeoutMs: timings.heartbeatTimeoutMs ?? HEARTBEAT.timeout_ms,
      helloTimeoutMs: timings.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
    };
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    // Other upgrades (socket.io) are not ours.
    if (pathname !== FLEET_WS_PATH) return;
    // The check starts now; the handshake completes regardless so a rejection
    // can be a close code rather than a bare HTTP status.
    const token = bearer(req);
    const auth: Promise<Auth> = token
      ? registry.verifyServerToken(token)
      : Promise.resolve({ ok: false as const, reason: 'bad' as const });
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const session = new FleetSession(this, ws, auth, this.timings);
      this.connections.add(session);
    });
  };

  attach(server: HttpServer): void {
    if (this.server === server) return;
    this.detach();
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    log.info(`[FLEET] gateway listening on ${FLEET_WS_PATH}`);
  }

  detach(): void {
    if (!this.server) return;
    this.server.off('upgrade', this.onUpgrade);
    this.server = null;
  }

  /** Close every connection (4503: the platform is going away) and stop listening. */
  shutdown(code: number = FLEET_CLOSE.DRAINING, reason = 'platform restarting'): void {
    this.detach();
    for (const session of this.connections) session.close(code, reason);
  }

  onServerReady(listener: (serverId: string) => Promise<void> | void): void {
    this.readyListeners.push(listener);
  }

  /** @internal */
  async onReady(serverId: string): Promise<void> {
    for (const listener of this.readyListeners) {
      try {
        await listener(serverId);
      } catch (error) {
        log.warn(`[FLEET] ${serverId}: after-welcome task failed: ${(error as Error).message}`);
      }
    }
  }

  /** @internal The newest session for a server wins; the older one gets 4409. */
  register(session: FleetSession): void {
    const serverId = session.serverId as string;
    const previous = this.sessions.get(serverId);
    this.sessions.set(serverId, session);
    if (previous && previous !== session) {
      log.info(`[FLEET] ${serverId}: a newer session replaced the old one`);
      previous.close(FLEET_CLOSE.REPLACED, 'replaced by a newer session');
    }
  }

  /** @internal */
  unregister(session: FleetSession): void {
    this.connections.delete(session);
    const serverId = session.serverId;
    if (!serverId || this.sessions.get(serverId) !== session) return;
    this.sessions.delete(serverId);
    if (session.sessionId) {
      log.info(`[FLEET] ${serverId} offline`);
      void registry.markDisconnected(serverId, session.sessionId).catch((error) => {
        log.warn(`[FLEET] ${serverId}: marking offline failed: ${(error as Error).message}`);
      });
    }
  }

  session(serverId: string): FleetSession | null {
    const session = this.sessions.get(serverId);
    return session && session.isReady ? session : null;
  }

  connectedServerIds(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.isReady).map(([id]) => id);
  }

  close(serverId: string, code: number, reason: string): boolean {
    const session = this.sessions.get(serverId);
    if (!session) return false;
    session.close(code, reason);
    return true;
  }
}
