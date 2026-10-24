import fs from 'fs';
import path from 'path';
import { expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';
import { FleetTestClient, enroll, envelope, newInstallId } from './fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import {
  validateMessage,
  type Envelope,
  type HelloPayload,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/** A fake Ready Up server over the real gateway, plus the match helpers the fleet specs share. */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
export const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

export const STEAM = (n: number) => `765611980001${String(n).padStart(5, '0')}`;

/** A fake Ready Up server: its own seq counter, answers, keepalive. */
export class FakeReadyUp {
  seq = 0;
  private keepalive: NodeJS.Timeout | null = null;

  private constructor(
    readonly serverId: string,
    readonly installId: string,
    readonly token: string,
    public client: FleetTestClient
  ) {}

  static async enroll(request: APIRequestContext, keyValue: string): Promise<FakeReadyUp> {
    const installId = newInstallId();
    const res = await enroll(request, { key: keyValue }, installId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const client = await FleetTestClient.connect(res.body.token);
    const fake = new FakeReadyUp(res.body.server_id, installId, res.body.token, client);
    return fake;
  }

  async hello(over: Partial<HelloPayload> = {}): Promise<Envelope> {
    const welcome = await this.client.handshake(this.serverId, this.installId, {
      stream: { id: `stream-${this.serverId}`, last_tx_seq: this.seq, last_rx_seq: 0 },
      ...over,
    });
    this.startKeepalive();
    return welcome;
  }

  /** The link dies without a close frame (a crash or a cut cable). */
  kill(): void {
    this.stopKeepalive();
    this.client.ws.terminate();
  }

  /** Drop the socket and connect again (a reconnect). */
  async reconnect(over: Partial<HelloPayload> = {}): Promise<Envelope> {
    this.stopKeepalive();
    this.client.ws.terminate();
    this.client = await FleetTestClient.connect(this.token);
    return this.hello(over);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    // Frames keep the platform's dead-link timer (30 s) from firing while a test waits.
    this.keepalive = setInterval(() => this.client.send(envelope('ping', { t: Date.now() })), 5000);
  }

  private stopKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  send(env: Omit<Envelope, 'seq'>): Envelope {
    const out = { ...env, seq: ++this.seq } as Envelope;
    expect(validateMessage(out), JSON.stringify(validateMessage(out).errors)).toEqual({
      ok: true,
      errors: [],
    });
    this.client.send(out);
    return out;
  }

  /** The one cmd.result for a platform message (ref = its id, epoch = its epoch). */
  answer(
    msg: Envelope,
    status: 'ok' | 'rejected' | 'failed' = 'ok',
    extra: Record<string, unknown> = {}
  ): Envelope {
    return this.send({
      v: 1,
      type: 'cmd.result',
      id: ulid(),
      ts: Date.now(),
      ack: msg.seq,
      ref: msg.id,
      ...(msg.epoch !== undefined ? { epoch: msg.epoch } : {}),
      payload: { status, ...extra },
    });
  }

  availability(
    availability: 'available' | 'busy' | 'draining',
    reason = 'test',
    extra: { detail?: string | null } = {}
  ): Envelope {
    return this.send({
      v: 1,
      type: 'server.availability',
      id: ulid(),
      ts: Date.now(),
      payload: { availability, reason, ...extra },
    });
  }

  /** A reliable event frame from the examples, re-keyed. */
  event(
    file: string,
    opts: { slug: string; epoch: number; rev: number; data?: Record<string, unknown> }
  ): Envelope {
    const frame = example(file);
    const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown> & {
      patch?: Record<string, unknown>;
    };
    payload.match_id = opts.slug;
    payload.rev = opts.rev;
    payload.patch = { ...(payload.patch ?? {}), live_rev: opts.rev };
    if (opts.data) payload.data = opts.data;
    const { seq: _seq, ack: _ack, ...rest } = frame;
    return this.send({ ...rest, id: ulid(), ts: Date.now(), epoch: opts.epoch, payload });
  }

  /** The assign snapshot (ephemeral), the state store's baseline. */
  snapshot(slug: string, epoch: number, over: Record<string, unknown> = {}): void {
    const frame = example('live.state.snapshot.json');
    const payload = JSON.parse(JSON.stringify(frame.payload)) as { state: Record<string, unknown> };
    payload.state.match_id = slug;
    payload.state.epoch = epoch;
    payload.state.live_rev = 0;
    Object.assign(payload, over);
    const { seq: _seq, ack: _ack, ...rest } = frame;
    this.client.send({ ...rest, id: ulid(), ts: Date.now(), epoch, payload });
  }

  next(type: string, timeoutMs = 20_000): Promise<Envelope> {
    return this.client.nextOfType(type, timeoutMs);
  }

  close(): void {
    this.stopKeepalive();
    this.client.close();
  }
}

export async function link(
  request: APIRequestContext,
  fleetServerId: string,
  serverId?: string
): Promise<string> {
  const res = await request.post(`/api/fleet/servers/${fleetServerId}/link`, {
    headers: getAuthHeader(),
    data: serverId ? { serverId } : {},
  });
  expect([200, 201], await res.text()).toContain(res.status());
  return (await res.json()).cs2ServerId as string;
}

export async function unlink(request: APIRequestContext, fleetServerId: string): Promise<void> {
  await request.delete(`/api/fleet/servers/${fleetServerId}/link`, { headers: getAuthHeader() });
}

/** A standalone match with no server: the allocator picks one. */
export async function createMatch(request: APIRequestContext, slug: string): Promise<void> {
  await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
  const res = await request.post('/api/matches', {
    headers: getAuthHeader(),
    data: {
      slug,
      config: {
        vetoDisabled: true,
        maplist: ['de_mirage'],
        num_maps: 1,
        players_per_team: 2,
        map_sides: ['team1_ct'],
        team1: {
          name: 'Fleet Alpha',
          players: [
            { steamid: STEAM(1), name: 'alice' },
            { steamid: STEAM(2), name: 'bob' },
          ],
        },
        team2: {
          name: 'Fleet Bravo',
          players: [
            { steamid: STEAM(3), name: 'carol' },
            { steamid: STEAM(4), name: 'dave' },
          ],
        },
        cvars: { mp_maxrounds: 24 },
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

export async function matchRow(
  request: APIRequestContext,
  slug: string
): Promise<{ status?: string; serverId?: string } | null> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  if (!res.ok()) return null;
  const body = await res.json();
  const match = body.match ?? body;
  return { status: match?.status, serverId: match?.serverId ?? match?.server_id };
}

/**
 * Wait for the server's match.assign for `slug`, answer it `ok`, and return
 * it. A match another spec left `ready` may be handed out first: that one is
 * refused (invalid_config), which is not retried on another server here.
 */
export async function acceptAssign(fake: FakeReadyUp, slug: string): Promise<Envelope> {
  for (let i = 0; i < 10; i++) {
    const assign = await fake.next('match.assign', 30_000);
    expect(validateMessage(assign)).toEqual({ ok: true, errors: [] });
    if ((assign.payload as { match_id: string }).match_id !== slug) {
      fake.answer(assign, 'rejected', {
        error: { code: 'invalid_config', message: 'not this test' },
      });
      continue;
    }
    fake.answer(assign, 'ok');
    return assign;
  }
  throw new Error(`no match.assign for ${slug}`);
}
