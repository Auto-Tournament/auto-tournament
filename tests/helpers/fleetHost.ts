import crypto from 'crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import type { Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';
import {
  validateHostMessage,
  type HostHelloPayload,
  type HostInventoryPayload,
  type HostInventoryServer,
} from '../../api/src/integrations/cs2/fleet/protocol/host/v1';
import { FleetTestClient, baseUrl, envelope } from './fleet';

/**
 * Helpers for the host channel specs (FLEET.md §18): a fake csm that enrolls
 * through the HTTP API and speaks the host protocol on `/api/fleet/host`.
 */

export function hostWsUrl(): string {
  return `${baseUrl().replace(/^http/, 'ws')}/api/fleet/host`;
}

export function newMachineId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function createPendingHost(
  request: APIRequestContext,
  name = 'host-test'
): Promise<{ hostId: string; code: string; command: string; expiresAt: number }> {
  const res = await request.post('/api/fleet/hosts', { data: { name } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { hostId: body.host.id, code: body.code, command: body.command, expiresAt: body.expiresAt };
}

export interface EnrolledHost {
  host_id: string;
  token: string;
  ws_url: string;
  reenrolled: boolean;
  name?: string;
}

export async function enrollHost(
  request: APIRequestContext,
  credential: { code?: string; key?: string },
  machineId: string,
  path = '/api/fleet/enroll'
): Promise<{ status: number; body: EnrolledHost & { code?: string; error?: string } }> {
  const res = await request.post(path, {
    data: { kind: 'host', ...credential, machine_id: machineId, hostname: 'csm-box', os: 'Ubuntu 24.04', csm_version: '2.0.0' },
  });
  return { status: res.status(), body: await res.json() };
}

export function inventoryServer(name: string, over: Partial<HostInventoryServer> = {}): HostInventoryServer {
  const n = Number(name.replace(/\D/g, '')) || 1;
  return {
    name,
    dir: `/home/cs2/${name}`,
    game_port: 27015 + (n - 1) * 10,
    status_port: 27022 + (n - 1) * 10,
    process: { running: true, pid: 1000 + n, restarts_24h: 0 },
    readyup: { installed: '0.5.0', health: 'ok', phase: 'idle', update_safe: true },
    cs2_build: 14032,
    launch_args: ['+map', 'de_dust2'],
    ...over,
  };
}

export function inventory(hostId: string, servers: HostInventoryServer[]): HostInventoryPayload {
  return {
    host_id: hostId,
    hostname: 'csm-box',
    csm_version: '2.0.0',
    os: 'Ubuntu 24.04',
    resources: { cpus: 16, load1: 0.42, ram_mb: 65536, ram_free_mb: 40000, disk: [{ mount: '/', total_gb: 1000, free_gb: 600 }] },
    cs2: { master_build: 14032, update_available: false, updates_hold: 'auto' },
    servers,
  };
}

/** A fake csm on the host channel: seq bookkeeping, and every frame it gets is schema-checked. */
export class FakeCsm {
  txSeq = 0;
  /** Highest ack the platform sent (on any frame). */
  platformAck = 0;
  private constructor(
    readonly client: FleetTestClient,
    readonly hostId: string,
    readonly machineId: string
  ) {
    client.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Envelope;
      if (typeof msg.ack === 'number' && msg.ack > this.platformAck) this.platformAck = msg.ack;
    });
  }

  static async connect(token: string, hostId: string, machineId: string): Promise<FakeCsm> {
    return new FakeCsm(await FleetTestClient.connect(token, {}, hostWsUrl()), hostId, machineId);
  }

  hello(over: Partial<HostHelloPayload> = {}): HostHelloPayload {
    return {
      host_id: this.hostId,
      machine_id: this.machineId,
      tenant_id: 'default',
      protocol: { min: 1, max: 1 },
      versions: { csm: '2.0.0', os: 'Ubuntu 24.04' },
      capabilities: ['host.v1', 'servers.start_stop', 'servers.create', 'update.plugins'],
      hostname: 'csm-box',
      boot_id: ulid(),
      stream: { id: 'csm-stream-1', last_tx_seq: this.txSeq, last_rx_seq: 0 },
      ...over,
    };
  }

  async handshake(over: Partial<HostHelloPayload> = {}): Promise<Envelope> {
    const hello = envelope('hello', this.hello(over));
    this.client.send(hello);
    const welcome = await this.client.nextOfType('welcome');
    expect(welcome.ref).toBe(hello.id);
    expect(validateHostMessage(welcome), JSON.stringify(welcome)).toEqual({ ok: true, errors: [] });
    return welcome;
  }

  sendEphemeral(type: string, payload: object, extra: Partial<Envelope> = {}): Envelope {
    const msg = envelope(type, payload, extra);
    expect(validateHostMessage(msg), JSON.stringify(msg)).toEqual({ ok: true, errors: [] });
    this.client.send(msg);
    return msg;
  }

  sendReliable(type: string, payload: object, extra: Partial<Envelope> = {}): Envelope {
    this.txSeq += 1;
    return this.sendEphemeral(type, payload, { seq: this.txSeq, ...extra });
  }

  /** The next platform command of `type`, schema-checked; acked right away (csm acks what it has stored). */
  async nextCommand(type: string, timeoutMs = 5000): Promise<Envelope> {
    const msg = await this.client.nextOfType(type, timeoutMs);
    expect(validateHostMessage(msg), JSON.stringify(msg)).toEqual({ ok: true, errors: [] });
    expect(typeof msg.seq).toBe('number');
    this.client.send(envelope('ack', {}, { ack: msg.seq }));
    return msg;
  }

  /** Wait for the platform's ack of our seq `seq`. */
  async acked(seq: number, timeoutMs = 5000): Promise<void> {
    await expect.poll(() => this.platformAck, { timeout: timeoutMs }).toBeGreaterThanOrEqual(seq);
  }

  close(): void {
    this.client.close();
  }
}
