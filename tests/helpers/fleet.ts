import crypto from 'crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import WebSocket from 'ws';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import type { Envelope, HelloPayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Helpers for the Ready Up fleet specs: enroll through the HTTP API, and a
 * small WebSocket client that speaks the fleet envelope the way Ready Up's
 * fleet.so will (FLEET.md §5-§6).
 */

export function baseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
}

export function wsUrl(): string {
  return `${baseUrl().replace(/^http/, 'ws')}/api/fleet/ws`;
}

export function newInstallId(): string {
  return `test-${crypto.randomBytes(8).toString('hex')}`;
}

export async function resetEnrollRateLimit(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/test/fleet/reset-enroll-rate-limit');
  expect(res.ok(), await res.text()).toBeTruthy();
}

export interface Enrolled {
  server_id: string;
  token: string;
  ws_url: string;
  reenrolled: boolean;
  name?: string;
}

export async function createPendingServer(
  request: APIRequestContext,
  name = 'fleet-test'
): Promise<{ serverId: string; code: string }> {
  const res = await request.post('/api/fleet/servers', { data: { name } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { serverId: body.server.id, code: body.code };
}

export async function createFleetKey(
  request: APIRequestContext,
  data: { name: string; namePrefix?: string; maxServers?: number } = { name: 'fleet-test-key' }
): Promise<{ id: string; value: string }> {
  const res = await request.post('/api/fleet/keys', { data });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { id: body.key.id, value: body.value };
}

export function enrollBody(credential: { code?: string; key?: string }, installId: string, extra: object = {}) {
  return {
    ...credential,
    install_id: installId,
    host: { hostname: 'test-host', game_port: 27015 },
    versions: { core: '0.4.0', plugin_api: '1.1', plugins: { fleet: '0.4.0' }, cs2_build: 14032 },
    ...extra,
  };
}

/** `POST /api/fleet/enroll` (public: the code or key is the credential). */
export async function enroll(
  request: APIRequestContext,
  credential: { code?: string; key?: string },
  installId: string,
  extra: object = {}
): Promise<{ status: number; body: Enrolled & { code?: string; error?: string } }> {
  const res = await request.post('/api/fleet/enroll', { data: enrollBody(credential, installId, extra) });
  return { status: res.status(), body: await res.json() };
}

export function helloPayload(serverId: string, installId: string, over: Partial<HelloPayload> = {}): HelloPayload {
  return {
    server_id: serverId,
    install_id: installId,
    tenant_id: 'default',
    protocol: { min: 1, max: 1 },
    versions: { core: '0.4.0', plugin_api: '1.1', plugins: { match: '0.4.0', fleet: '0.4.0' }, cs2_build: 14032, cs2_patch: '1.40.3.2' },
    capabilities: ['match.v1', 'stats.v1'],
    host: { hostname: 'test-host', game_port: 27015, tv_port: 27020 },
    boot_id: ulid(),
    stream: { id: 'stream-1', last_tx_seq: 0, last_rx_seq: 0 },
    state: null,
    availability: 'available',
    selftest: { pass: true, passed: 3, total: 3, failures: [] },
    ...over,
  };
}

export function envelope(type: string, payload: object, extra: Partial<Envelope> = {}): Envelope {
  return { v: 1, type, id: ulid(), ts: Date.now(), payload: payload as Record<string, unknown>, ...extra };
}

/** A fleet client: queues what it receives and remembers how it closed. */
export class FleetTestClient {
  readonly ws: WebSocket;
  readonly received: Envelope[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      this.received.push(JSON.parse(data.toString()) as Envelope);
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
    ws.on('error', () => this.wake());
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  static async connect(token: string | null, headers: Record<string, string> = {}): Promise<FleetTestClient> {
    const ws = new WebSocket(wsUrl(), {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
    const client = new FleetTestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected HTTP ${res.statusCode}`)));
    });
    return client;
  }

  send(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** The next received message matching `pred` (already-received ones count), removed from the queue. */
  async next(pred: (m: Envelope) => boolean = () => true, timeoutMs = 5000): Promise<Envelope> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.received.findIndex(pred);
      if (i >= 0) return this.received.splice(i, 1)[0];
      if (this.closed) throw new Error(`socket closed (${this.closed.code} ${this.closed.reason}) while waiting`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; received: ${JSON.stringify(this.received.map((m) => m.type))}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  nextOfType(type: string, timeoutMs = 5000): Promise<Envelope> {
    return this.next((m) => m.type === type, timeoutMs);
  }

  async waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out waiting for close');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return this.closed;
  }

  /** hello → welcome. */
  async handshake(serverId: string, installId: string, over: Partial<HelloPayload> = {}): Promise<Envelope> {
    const hello = envelope('hello', helloPayload(serverId, installId, over));
    this.send(hello);
    const welcome = await this.nextOfType('welcome');
    expect(welcome.ref).toBe(hello.id);
    return welcome;
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(1000);
  }
}
