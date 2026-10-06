/**
 * The host gateway: `/api/fleet/host`, one WebSocket per machine from csm
 * acting as host agent (FLEET.md §18, D17).
 *
 * Same transport as the server gateway (../gateway.ts, FLEET.md §5-§6):
 * `Authorization: Bearer rhs_…` on the upgrade (4401 bad, 4403 revoked),
 * JSON envelopes validated against ../protocol/host/v1, `hello` → `welcome`,
 * seq/ack with a standalone `ack` within 1 s / 32 messages, resume with
 * replay of the platform's outbox, ping every 10 s and a dead link after
 * 30 s, 4409 for a replaced session, per-host rate limits.
 *
 * Host → platform:
 * - `host.result`, `host.health`, `auth.rotated` (reliable): applied and the
 *   stream position written in **one transaction**, then acked
 *   (persist-before-ack). They are accepted without `seq` too.
 * - `host.inventory`, `host.progress` (ephemeral, `seq` accepted): stored.
 * - `logs.chunk`: accepted and dropped for now (no log viewer yet).
 *
 * Platform → host commands go through ./service.ts (`sendHostCommand`),
 * which writes the outbox; this file writes it to the socket. Two payloads
 * get a secret minted at that moment, so none is ever stored: `auth.rotate`
 * (the new host token) and `server.create` with `enroll: true` (its
 * `enroll_key`: a fleet key limited to that command's server count).
 */

import { EventEmitter } from 'events';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { log } from '../../../../utils/logger';
import { redactFleetSecrets, ulid } from '../credentials';
import { FLEET_CLOSE, type Envelope } from '../protocol/v1';
import {
  HOST_MESSAGES,
  HOST_PROTOCOL_SUPPORTED,
  isKnownHostMessageType,
  validateHostEnvelope,
  validateHostMessage,
  validateHostPayload,
  type HostHealthPayload,
  type HostHelloPayload,
  type HostInventoryPayload,
  type HostProgressPayload,
  type HostResultPayload,
  type HostWelcomePayload,
} from '../protocol/host/v1';
import * as registry from './registry';

export const FLEET_HOST_WS_PATH = '/api/fleet/host';
export const HOST_MAX_FRAME_BYTES = 1024 * 1024;
export const HOST_HEARTBEAT = { interval_ms: 10_000, timeout_ms: 30_000 } as const;
const HELLO_TIMEOUT_MS = 10_000;
const ACK_DELAY_MS = 1_000;
const ACK_EVERY = 32;
const RATE = { perSecond: 50, burst: 200, bytesPerMinute: 8 * 1024 * 1024 };
const SEEN_WRITE_MS = 10_000;
const ID_WINDOW = 10_000;

export interface HostGatewayTimings {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  helloTimeoutMs: number;
}

/** What the rest of the platform can listen to (./service.ts re-exports `hostEvents`). */
export type HostEventMap = {
  online: [hostId: string];
  offline: [hostId: string];
  inventory: [hostId: string, inventory: HostInventoryPayload];
  health: [hostId: string, health: HostHealthPayload];
  result: [hostId: string, record: registry.HostCommandRecord];
  progress: [hostId: string, record: registry.HostCommandRecord];
};

export const hostEvents = new EventEmitter();
hostEvents.setMaxListeners(0);

function closeReason(text: string): string {
  const buf = Buffer.from(text, 'utf8');
  return buf.length <= 123 ? text : buf.subarray(0, 120).toString('utf8') + '…';
}

function bearer(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(raw);
  return m ? m[1] : null;
}

type Auth = Awaited<ReturnType<typeof registry.verifyHostToken>>;

class HostSession {
  sessionId: string | null = null;
  hostId: string | null = null;
  private machineId: string | null = null;
  private ready = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private rxSeq = 0;
  private rxStreamId: string | null = null;
  private rxBaseUnknown = false;
  private txAcked = 0;
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
    private readonly gateway: HostGateway,
    readonly ws: WebSocket,
    auth: Promise<Auth>,
    private readonly timings: HostGatewayTimings
  ) {
    this.helloTimer = setTimeout(() => this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'hello timeout'), timings.helloTimeoutMs);
    this.bumpDeadTimer();
    ws.on('message', (data, isBinary) => this.onFrame(data, isBinary));
    ws.on('close', () => this.onClosed());
    ws.on('error', (error) => log.warn(`[FLEET-HOST] socket error (${this.hostId ?? 'unauthenticated'}): ${error.message}`));
    this.queue = auth
      .then((result) => {
        if (!result.ok) {
          const code = result.reason === 'revoked' ? FLEET_CLOSE.REVOKED : FLEET_CLOSE.BAD_TOKEN;
          log.warn(`[FLEET-HOST] rejected a connection: ${result.reason === 'revoked' ? 'revoked or expired token' : 'invalid token'}`);
          this.close(code, result.reason === 'revoked' ? 'token revoked' : 'invalid token');
          return;
        }
        this.hostId = result.host.id;
        this.machineId = result.host.machine_id;
      })
      .catch((error) => {
        log.error(`[FLEET-HOST] token check failed: ${(error as Error).message}`);
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
      .then(() => (this.closed || !this.hostId ? undefined : this.handle(text)))
      .catch((error) => {
        log.error(`[FLEET-HOST] ${this.hostId}: handling a message failed: ${redactFleetSecrets((error as Error).message)}`);
        this.close(1011, 'internal error');
      });
  }

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
    const env = validateHostEnvelope(value);
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
      await this.onHello(msg as unknown as Envelope<'hello', HostHelloPayload>);
      return;
    }

    this.touchSeen();
    if (typeof msg.ack === 'number' && msg.ack > this.txAcked) {
      this.txAcked = msg.ack;
      await registry.ackHostOutbox(this.hostId as string, msg.ack);
    }
    if (msg.type === 'hello') {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, 'hello sent twice');
      return;
    }
    if (msg.seq !== undefined) {
      await this.onReliable(msg);
      return;
    }
    await this.onEphemeral(msg);
  }

  /** Is this a host → platform type we know? Else the reason. */
  private checkInbound(msg: Envelope): { ok: true } | { ok: false; code: string; message: string } {
    const known = isKnownHostMessageType(msg.type) && HOST_MESSAGES[msg.type]?.direction !== 'platform_to_host';
    if (!known) return { ok: false, code: 'unknown_type', message: `unknown message type ${msg.type}` };
    const check = validateHostPayload(msg.type, msg.payload);
    if (!check.ok) return { ok: false, code: 'invalid_payload', message: check.errors.join('; ') };
    return { ok: true };
  }

  private async onReliable(msg: Envelope): Promise<void> {
    const seq = msg.seq as number;
    if (this.rxBaseUnknown) {
      this.rxSeq = seq - 1;
      this.rxBaseUnknown = false;
    }
    if (seq <= this.rxSeq) {
      this.owe(true);
      return;
    }
    if (seq !== this.rxSeq + 1) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, `seq gap: expected ${this.rxSeq + 1}, got ${seq}`);
      return;
    }
    const hostId = this.hostId as string;
    const streamId = this.rxStreamId as string;
    const check = this.checkInbound(msg);
    if (!check.ok) this.sendError(msg, check.code, check.message);
    // Persist-before-ack: the message's effect and the stream position in one transaction.
    const effects = await registry.tx(async (c) => {
      const out = check.ok ? await this.apply(c, msg) : [];
      await registry.setHostRxState(hostId, streamId, seq, c);
      return out;
    });
    this.rxSeq = seq;
    this.owe();
    this.emitAll(effects);
  }

  private async onEphemeral(msg: Envelope): Promise<void> {
    switch (msg.type) {
      case 'ping': {
        const check = validateHostPayload('ping', msg.payload);
        if (!check.ok) {
          this.sendError(msg, 'invalid_payload', check.errors.join('; '));
          return;
        }
        this.sendEphemeral('pong', { t: (msg.payload as { t: number }).t }, msg.id);
        return;
      }
      case 'pong':
      case 'ack':
        return;
      case 'error': {
        const p = msg.payload as { code?: unknown; message?: unknown };
        log.warn(`[FLEET-HOST] ${this.hostId} reported an error: ${String(p.code)} ${redactFleetSecrets(String(p.message ?? ''))}`);
        return;
      }
      default: {
        // Unknown ephemeral types are ignored (FLEET.md §5).
        if (!isKnownHostMessageType(msg.type)) return;
        const check = this.checkInbound(msg);
        if (!check.ok) {
          this.sendError(msg, check.code, check.message);
          return;
        }
        const effects = await registry.tx((c) => this.apply(c, msg));
        this.emitAll(effects);
      }
    }
  }

  /** Apply one validated host → platform message inside `c`; returns the events to emit after commit. */
  private async apply(c: Parameters<Parameters<typeof registry.tx>[0]>[0], msg: Envelope): Promise<Array<() => void>> {
    const hostId = this.hostId as string;
    switch (msg.type) {
      case 'host.inventory': {
        const payload = msg.payload as unknown as HostInventoryPayload;
        if (payload.host_id !== hostId) {
          log.warn(`[FLEET-HOST] ${hostId}: inventory names host ${payload.host_id}; stored under the session's host`);
        }
        await registry.applyInventory(c, hostId, payload);
        return [() => hostEvents.emit('inventory', hostId, payload)];
      }
      case 'host.health': {
        const payload = msg.payload as unknown as HostHealthPayload;
        const inserted = await registry.applyHealth(c, hostId, this.rxStreamId, msg.seq ?? null, payload);
        if (!inserted) return [];
        const level = payload.event === 'recovered' || payload.event === 'restarted' ? 'info' : 'warn';
        log[level](`[FLEET-HOST] ${hostId}: ${payload.server} ${payload.event}${payload.detail ? ` (${redactFleetSecrets(payload.detail)})` : ''}`);
        return [() => hostEvents.emit('health', hostId, payload)];
      }
      case 'host.result': {
        if (!msg.ref) {
          log.warn(`[FLEET-HOST] ${hostId}: host.result without ref ignored`);
          return [];
        }
        const record = await registry.applyResult(c, hostId, msg.ref, msg.payload as unknown as HostResultPayload);
        if (!record) {
          log.warn(`[FLEET-HOST] ${hostId}: host.result for unknown command ${msg.ref}`);
          return [];
        }
        return [() => hostEvents.emit('result', hostId, record)];
      }
      case 'host.progress': {
        const payload = { ...(msg.payload as unknown as HostProgressPayload) };
        if (!payload.ref && msg.ref) payload.ref = msg.ref;
        const record = await registry.applyProgress(c, hostId, payload);
        return record ? [() => hostEvents.emit('progress', hostId, record)] : [];
      }
      case 'auth.rotated':
        await registry.confirmHostRotation(c, hostId);
        return [() => log.info(`[FLEET-HOST] ${hostId}: rotated its token`)];
      case 'logs.chunk':
        return [];
      default:
        return [];
    }
  }

  private emitAll(effects: Array<() => void>): void {
    for (const fn of effects) {
      try {
        fn();
      } catch (error) {
        log.warn(`[FLEET-HOST] ${this.hostId}: listener failed: ${(error as Error).message}`);
      }
    }
  }

  private async onHello(msg: Envelope<'hello', HostHelloPayload>): Promise<void> {
    const check = validateHostPayload('hello', msg.payload);
    if (!check.ok) {
      this.close(FLEET_CLOSE.PROTOCOL_ERROR, `invalid hello: ${check.errors[0] ?? ''}`);
      return;
    }
    const hello = msg.payload;
    const hostId = this.hostId as string;
    if (hello.host_id !== hostId) {
      this.close(FLEET_CLOSE.REVOKED, 'host_id does not match the token');
      return;
    }
    if (this.machineId && hello.machine_id !== this.machineId) {
      log.warn(`[FLEET-HOST] ${hostId}: hello machine_id does not match the enrolled one; copied credentials?`);
      this.close(FLEET_CLOSE.REVOKED, 'machine_id does not match the enrollment');
      return;
    }
    if (hello.protocol.min > HOST_PROTOCOL_SUPPORTED.max || hello.protocol.max < HOST_PROTOCOL_SUPPORTED.min) {
      this.close(
        FLEET_CLOSE.UNSUPPORTED_PROTOCOL,
        `protocol ${hello.protocol.min}-${hello.protocol.max} unsupported; platform speaks ${HOST_PROTOCOL_SUPPORTED.min}-${HOST_PROTOCOL_SUPPORTED.max}`
      );
      return;
    }
    const protocol = Math.min(hello.protocol.max, HOST_PROTOCOL_SUPPORTED.max);

    const stream = await registry.getHostStreamState(hostId);
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
    if (result === 'reset') await registry.setHostRxState(hostId, hello.stream.id, 0);
    // The agent has received less than it once acknowledged: it starts over
    // (linked again, reinstalled). Continue the numbering from where it is,
    // or the next command waits forever for ones it can never get.
    if (hello.stream.last_rx_seq < stream.txAcked) {
      const renumbered = await registry.rebaseHostTx(hostId, hello.stream.last_rx_seq);
      log.warn(
        `[FLEET-HOST] ${hostId}: the agent starts over at seq ${hello.stream.last_rx_seq} (platform had ${stream.txAcked} acknowledged); ${renumbered} queued message(s) renumbered`
      );
      stream.txAcked = hello.stream.last_rx_seq;
    }
    if (hello.stream.last_rx_seq > 0) {
      await registry.ensureHostTxSeqAtLeast(hostId, hello.stream.last_rx_seq);
      await registry.ackHostOutbox(hostId, hello.stream.last_rx_seq);
    }
    this.txAcked = Math.max(stream.txAcked, hello.stream.last_rx_seq);

    if (this.closed) return;
    this.sessionId = ulid();
    this.gateway.register(this);
    await registry.markHostConnected(hostId, this.sessionId, {
      hostname: hello.hostname,
      os: hello.versions.os,
      csm_version: hello.versions.csm,
      capabilities: hello.capabilities,
      protocol,
      boot_id: hello.boot_id,
    });
    if (this.closed) {
      await registry.markHostDisconnected(hostId, this.sessionId);
      return;
    }
    this.lastSeenWrite = Date.now();
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;

    const welcome: HostWelcomePayload = {
      session_id: this.sessionId,
      protocol,
      heartbeat: { interval_ms: this.timings.heartbeatIntervalMs, timeout_ms: this.timings.heartbeatTimeoutMs },
      resume: { result, platform_last_rx_seq: this.rxSeq },
      host_id: hostId,
    };
    this.ready = true;
    this.sendEphemeral('welcome', welcome as unknown as Record<string, unknown>, msg.id);
    log.info(`[FLEET-HOST] ${hostId} online (session ${this.sessionId}, csm ${hello.versions.csm}, resume ${result})`);

    this.lastSentSeq = hello.stream.last_rx_seq;
    await this.flushOutbox();
    this.pingTimer = setInterval(() => this.sendEphemeral('ping', { t: Date.now() }), this.timings.heartbeatIntervalMs);
    hostEvents.emit('online', hostId);
    await this.gateway.onReady(hostId);
  }

  // --- outbound --------------------------------------------------------------

  private frame(env: Envelope): string | null {
    const out: Envelope = { ...env, ack: this.rxSeq };
    const check = validateHostMessage(out);
    if (!check.ok) {
      log.error(`[FLEET-HOST] refusing to send an invalid ${env.type}: ${check.errors.join('; ')}`);
      return null;
    }
    return JSON.stringify(out);
  }

  private write(text: string): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(text);
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

  flushOutbox(): Promise<boolean> {
    const run = this.sendChain.then(async () => {
      if (this.closed || !this.hostId) return false;
      let sent = false;
      for (const env of await registry.pendingHostOutbox(this.hostId, this.lastSentSeq)) {
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

  /** Write one outbox message; secrets are minted here, never stored. */
  private async sendReliable(env: Envelope): Promise<boolean> {
    let out = env;
    if (env.type === 'auth.rotate') {
      const p = env.payload as { token_id?: string; old_valid_until?: number };
      const token = p.token_id ? await registry.mintHostRotationSecret(p.token_id) : null;
      if (!token) {
        // A rotation that was superseded (same handling as the server gateway).
        log.warn(`[FLEET-HOST] ${this.hostId}: auth.rotate seq ${env.seq} is stale; not sent`);
        return false;
      }
      out = { ...env, payload: { token, old_valid_until: p.old_valid_until } };
    } else if (env.type === 'server.create' && (env.payload as { enroll?: boolean }).enroll === true) {
      const p = env.payload as { count?: number };
      const key = await registry.mintCreateKey({
        hostId: this.hostId as string,
        commandId: env.id,
        count: p.count ?? 1,
        namePrefix: null,
      });
      out = { ...env, payload: { ...env.payload, enroll_key: key } };
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
      log.warn(`[FLEET-HOST] ${this.hostId ?? 'connection'}: no frame for ${this.timings.heartbeatTimeoutMs} ms; link dead`);
      this.closed = true;
      this.ws.terminate();
    }, this.timings.heartbeatTimeoutMs);
  }

  private touchSeen(): void {
    const now = Date.now();
    if (now - this.lastSeenWrite < SEEN_WRITE_MS) return;
    this.lastSeenWrite = now;
    void registry.markHostSeen(this.hostId as string).catch((error) => {
      log.warn(`[FLEET-HOST] ${this.hostId}: last_seen update failed: ${(error as Error).message}`);
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

export class HostGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, HostSession>();
  private readonly connections = new Set<HostSession>();
  private server: HttpServer | null = null;
  private readyListeners: Array<(hostId: string) => Promise<void> | void> = [];
  private readonly timings: HostGatewayTimings;

  constructor(timings: Partial<HostGatewayTimings> = {}) {
    this.timings = {
      heartbeatIntervalMs: timings.heartbeatIntervalMs ?? HOST_HEARTBEAT.interval_ms,
      heartbeatTimeoutMs: timings.heartbeatTimeoutMs ?? HOST_HEARTBEAT.timeout_ms,
      helloTimeoutMs: timings.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
    };
    this.wss = new WebSocketServer({ noServer: true, maxPayload: HOST_MAX_FRAME_BYTES, perMessageDeflate: false });
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== FLEET_HOST_WS_PATH) return;
    const token = bearer(req);
    const auth: Promise<Auth> = token
      ? registry.verifyHostToken(token)
      : Promise.resolve({ ok: false as const, reason: 'bad' as const });
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.connections.add(new HostSession(this, ws, auth, this.timings));
    });
  };

  attach(server: HttpServer): void {
    if (this.server === server) return;
    this.detach();
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    log.info(`[FLEET-HOST] gateway listening on ${FLEET_HOST_WS_PATH}`);
  }

  detach(): void {
    if (!this.server) return;
    this.server.off('upgrade', this.onUpgrade);
    this.server = null;
  }

  shutdown(code: number = FLEET_CLOSE.DRAINING, reason = 'platform restarting'): void {
    this.detach();
    for (const session of this.connections) session.close(code, reason);
  }

  onHostReady(listener: (hostId: string) => Promise<void> | void): void {
    this.readyListeners.push(listener);
  }

  /** @internal */
  async onReady(hostId: string): Promise<void> {
    for (const listener of this.readyListeners) {
      try {
        await listener(hostId);
      } catch (error) {
        log.warn(`[FLEET-HOST] ${hostId}: after-welcome task failed: ${(error as Error).message}`);
      }
    }
  }

  /** @internal */
  register(session: HostSession): void {
    const hostId = session.hostId as string;
    const previous = this.sessions.get(hostId);
    this.sessions.set(hostId, session);
    if (previous && previous !== session) {
      log.info(`[FLEET-HOST] ${hostId}: a newer session replaced the old one`);
      previous.close(FLEET_CLOSE.REPLACED, 'replaced by a newer session');
    }
  }

  /** @internal */
  unregister(session: HostSession): void {
    this.connections.delete(session);
    const hostId = session.hostId;
    if (!hostId || this.sessions.get(hostId) !== session) return;
    this.sessions.delete(hostId);
    if (session.sessionId) {
      log.info(`[FLEET-HOST] ${hostId} offline`);
      hostEvents.emit('offline', hostId);
      void registry.markHostDisconnected(hostId, session.sessionId).catch((error) => {
        log.warn(`[FLEET-HOST] ${hostId}: marking offline failed: ${(error as Error).message}`);
      });
    }
  }

  session(hostId: string): HostSession | null {
    const session = this.sessions.get(hostId);
    return session && session.isReady ? session : null;
  }

  connectedHostIds(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.isReady).map(([id]) => id);
  }

  close(hostId: string, code: number, reason: string): boolean {
    const session = this.sessions.get(hostId);
    if (!session) return false;
    session.close(code, reason);
    return true;
  }
}
