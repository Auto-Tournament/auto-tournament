import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import {
  INTEGRATOR,
  bearer,
  createEndpoint,
  deleteAllEndpoints,
  expectSigned,
  newBin,
  ofType,
  reconcile,
  received,
  setAllowPrivate,
  setTiming,
  sinkUrl,
  waitForTypes,
  type Received,
} from '../helpers/webhooks';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import { connectLinks } from '../../api/src/services/webhooks/events';
import { validateMessage, type Envelope, type HelloPayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Webhook events from real match lifecycles, on both transports:
 *
 * - an RCON server: allocation (or the admin's load), the game's events on
 *   /api/events (going live, a round, the map result that ends a Bo1);
 * - a Ready Up server over the fleet link, driven by a fake Ready Up client
 *   (the pattern of fleet-driver.spec.ts): match.assign, the live phase, the
 *   map result and series end; the connect password reaches the webhook.
 *
 * Both check the order (data.sequence), the signature, the teams' external
 * ids and Steam64s, and that the connect details are in the signed delivery
 * only, never in the delivery log.
 *
 * @tag api
 * @tag webhooks
 * @tag fleet
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};
const run = Date.now().toString(36);
const steam = (n: number) => `765611980003${String(n).padStart(5, '0')}`;

async function pushTeam(request: APIRequestContext, externalId: string, name: string, ids: number[]): Promise<string> {
  const res = await request.put(`/api/integrations/teams/${externalId}`, {
    headers: bearer(INTEGRATOR.token),
    data: { name, players: ids.map((n) => ({ steamId: steam(n), name: `p${n}` })) },
  });
  expect([200, 201], await res.text()).toContain(res.status());
  return (await res.json()).id as string;
}

async function createMatch(
  request: APIRequestContext,
  slug: string,
  team1: { id: string; name: string; ids: number[] },
  team2: { id: string; name: string; ids: number[] }
): Promise<void> {
  await request.delete(`/api/matches/${slug}`);
  const side = (t: typeof team1) => ({
    id: t.id,
    name: t.name,
    players: t.ids.map((n) => ({ steamid: steam(n), name: `p${n}` })),
  });
  const res = await request.post('/api/matches', {
    data: {
      slug,
      config: {
        vetoDisabled: true,
        maplist: ['de_mirage'],
        num_maps: 1,
        players_per_team: team1.ids.length,
        map_sides: ['team1_ct'],
        team1: side(team1),
        team2: side(team2),
        cvars: { mp_maxrounds: 24 },
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function matchRow(request: APIRequestContext, slug: string): Promise<{ id?: number; status?: string; serverId?: string }> {
  const res = await request.get(`/api/matches/${slug}`);
  if (!res.ok()) return {};
  const body = await res.json();
  const match = body.match ?? body;
  return { id: match?.id, status: match?.status, serverId: match?.serverId ?? match?.server_id };
}

async function sendEvent(request: APIRequestContext, slug: string, data: Record<string, unknown>): Promise<void> {
  const res = await request.post(`/api/events/${slug}`, { headers: SERVER_HEADERS, data });
  expect(res.ok(), `${String(data.event)} rejected: ${await res.text()}`).toBe(true);
}


function expectOrdered(list: Received[], types: string[]): void {
  const seq = (type: string) => {
    const found = ofType(list, type);
    expect(found.length, `${type} delivered`).toBeGreaterThanOrEqual(1);
    return found[0].envelope.data.sequence;
  };
  const sequences = types.map(seq);
  expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  expect(new Set(list.map((r) => r.envelope.data.sequence)).size).toBe(list.length);
}

test.describe.serial('Webhook events from match lifecycles', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    // No bracket matches ahead of ours in the allocation queue.
    await request.delete('/api/tournament');
    await deleteAllEndpoints(request);
    await setAllowPrivate(request, true);
    await setTiming(request, { reset: true, retryScale: 0.0005, scoreThrottleMs: 0 });
  });

  test.afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await deleteAllEndpoints(request);
    await setTiming(request, { reset: true });
    await setAllowPrivate(request, false);
  });

  test('RCON server: ready → live → map → score → map ended → finished', async ({ request }) => {
    test.setTimeout(120_000);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    const bin = newBin('rcon');
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), source: INTEGRATOR.label });

    const a = await pushTeam(request, `wh-${run}-a`, 'Webhook Alpha', [1, 2]);
    const b = await pushTeam(request, `wh-${run}-b`, 'Webhook Bravo', [3, 4]);
    const server = await createTestServer(request, 'wh-rcon');
    expect(server).toBeTruthy();
    cleanup.push(async () => {
      await deleteServer(request, server!.id);
    });

    const slug = `wh-rcon-${run}`;
    await createMatch(request, slug, { id: a, name: 'Webhook Alpha', ids: [1, 2] }, { id: b, name: 'Webhook Bravo', ids: [3, 4] });
    // Allocation loads it on a free server; if none takes it quickly, put it on ours.
    let loaded = false;
    try {
      await expect.poll(async () => (await matchRow(request, slug)).status, { timeout: 15_000 }).toBe('loaded');
      loaded = true;
    } catch {
      loaded = false;
    }
    if (!loaded) {
      const set = await request.post('/api/test/match-state', { data: { slug, status: 'loaded', serverId: server!.id } });
      expect(set.ok()).toBe(true);
    }
    await reconcile(request, slug);

    let got = await waitForTypes(request, bin, ['match.ready'], 30_000, (r) => r.envelope.data.match.slug === slug);
    const ready = ofType(got, 'match.ready')[0];
    expectSigned(ready, endpoint.secret);
    const row = await matchRow(request, slug);
    const serverRow = await (await request.get(`/api/servers/${row.serverId}`)).json();
    const srv = serverRow.server ?? serverRow;
    expect(ready.envelope).toMatchObject({ test: false, api_version: '1' });
    expect(ready.envelope.data.match).toMatchObject({
      slug,
      status: 'loaded',
      best_of: 1,
      team1: { id: a, external_id: `wh-${run}-a`, name: 'Webhook Alpha' },
      team2: { id: b, external_id: `wh-${run}-b` },
      connect: { host: srv.host, port: srv.port, password: null, ...connectLinks(srv.host, srv.port, null) },
    });
    expect(ready.envelope.data.match.team1?.players.map((p) => p.steam_id64)).toEqual([steam(1), steam(2)]);

    const matchId = row.id!;
    await sendEvent(request, slug, { event: 'going_live', matchid: matchId, map_number: 0, map_name: 'de_mirage' });
    await reconcile(request, slug);
    await sendEvent(request, slug, {
      event: 'round_end',
      matchid: matchId,
      map_number: 0,
      round_number: 1,
      winner: 'team1',
      team1_score: 1,
      team2_score: 0,
    });
    await reconcile(request, slug);
    await sendEvent(request, slug, {
      event: 'map_result',
      matchid: matchId,
      map_number: 0,
      map_name: 'de_mirage',
      winner: { side: '3', team: 'team1' },
      team1: { series_score: 1, score: 13, players: [] },
      team2: { series_score: 0, score: 5, players: [] },
    });
    await expect.poll(async () => (await matchRow(request, slug)).status, { timeout: 20_000 }).toBe('completed');
    await reconcile(request, slug);

    const types = ['match.ready', 'match.live', 'match.map_started', 'match.score_updated', 'match.map_ended', 'match.finished'];
    got = await waitForTypes(request, bin, types, 30_000, (r) => r.envelope.data.match.slug === slug);
    for (const r of got) expectSigned(r, endpoint.secret);
    expectOrdered(got, types);

    const score = ofType(got, 'match.score_updated')[0].envelope.data.match;
    expect(score.score.map).toMatchObject({ number: 1, name: 'de_mirage', team1: 1, team2: 0 });
    expect(score.connect?.host).toBe(srv.host);
    const mapEnded = ofType(got, 'match.map_ended')[0].envelope.data;
    expect(mapEnded.map).toMatchObject({ number: 1, team1: 13, team2: 5, status: 'finished', winner: 'team1' });
    const finished = ofType(got, 'match.finished')[0].envelope.data.match;
    expect(finished).toMatchObject({
      status: 'completed',
      score: { series: { team1: 1, team2: 0 } },
      winner: { side: 'team1', team_id: a },
      connect: null,
    });
    await request.delete(`/api/matches/${slug}`);
  });

  test('Ready Up server (fleet): the connect password reaches the signed delivery only', async ({ request }) => {
    test.setTimeout(180_000);
    await resetEnrollRateLimit(request);
    const bin = newBin('fleet');
    const endpoint = await createEndpoint(request, { url: await sinkUrl(request, bin), source: INTEGRATOR.label });

    const key = await createFleetKey(request, { name: `wh-fleet-${run}` });
    const fake = await FakeReadyUp.enroll(request, key.value);
    cleanup.push(() => fake.close());
    await fake.hello();
    const link = await request.post(`/api/fleet/servers/${fake.serverId}/link`, { data: {} });
    expect([200, 201], await link.text()).toContain(link.status());
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${fake.serverId}/link`);
    });

    const a = await pushTeam(request, `whf-${run}-a`, 'Fleet Hook Alpha', [11, 12]);
    const b = await pushTeam(request, `whf-${run}-b`, 'Fleet Hook Bravo', [13, 14]);
    const slug = `wh-fleet-${run}`;
    await createMatch(request, slug, { id: a, name: 'Fleet Hook Alpha', ids: [11, 12] }, { id: b, name: 'Fleet Hook Bravo', ids: [13, 14] });
    const assign = await fake.acceptAssign(slug);
    const password = (assign.payload as { config: { password: string } }).config.password;
    const epoch = (assign.payload as { epoch: number }).epoch;
    await expect.poll(async () => (await matchRow(request, slug)).status, { timeout: 20_000 }).toBe('loaded');
    await reconcile(request, slug);

    let got = await waitForTypes(request, bin, ['match.ready'], 30_000, (r) => r.envelope.data.match.slug === slug);
    const ready = ofType(got, 'match.ready')[0];
    expectSigned(ready, endpoint.secret);
    const connectRoute = await (await request.get(`/api/game/cs2/matches/${slug}/connect`)).json();
    expect(ready.envelope.data.match.connect).toEqual({
      host: connectRoute.server.host,
      port: connectRoute.server.port,
      password,
      ...connectLinks(connectRoute.server.host, connectRoute.server.port, password),
    });
    expect(ready.envelope.data.match.connect?.steam_url).toMatch(new RegExp(`^steam://connect/.+/${password}$`));
    expect(ready.envelope.data.match.team2).toMatchObject({ id: b, external_id: `whf-${run}-b` });

    // Live, then the map result and the series end.
    fake.availability('busy', 'assigned');
    fake.snapshot(slug, epoch);
    fake.event('live.event.phase.json', { slug, epoch, rev: 1, data: { from: 'warmup', to: 'live', reason: 'flow' } });
    await expect.poll(async () => (await matchRow(request, slug)).status, { timeout: 15_000 }).toBe('live');
    await reconcile(request, slug);
    const mapResult = example('live.event.map_result.json');
    fake.event('live.event.map_result.json', {
      slug,
      epoch,
      rev: 2,
      data: {
        ...(mapResult.payload.data as Record<string, unknown>),
        slug,
        winner: 'team2',
        team1_score: 9,
        team2_score: 13,
        team1_series_score: 0,
        team2_series_score: 1,
        series_over: true,
      },
    });
    const seriesEnd = example('live.event.series_end.natural.json');
    fake.event('live.event.series_end.natural.json', {
      slug,
      epoch,
      rev: 3,
      data: { ...(seriesEnd.payload.data as Record<string, unknown>), slug, winner: 'team2', team1_series_score: 0, team2_series_score: 1 },
    });
    await expect.poll(async () => (await matchRow(request, slug)).status, { timeout: 20_000 }).toBe('completed');
    const unassign = await fake.next('match.unassign');
    fake.answer(unassign);
    await reconcile(request, slug);

    const types = ['match.ready', 'match.live', 'match.map_started', 'match.map_ended', 'match.finished'];
    got = await waitForTypes(request, bin, types, 30_000, (r) => r.envelope.data.match.slug === slug);
    expectOrdered(got, types);
    expect(ofType(got, 'match.live')[0].envelope.data.match.connect?.password).toBe(password);
    expect(ofType(got, 'match.finished')[0].envelope.data.match).toMatchObject({ winner: { side: 'team2', team_id: b }, connect: null });

    // The delivery log never shows it.
    const log = await (await request.get(`/api/webhooks/${endpoint.id}/deliveries?limit=200`)).text();
    expect(log).toContain('match.ready');
    expect(log).not.toContain(password);
    expect(log).not.toContain('steam://connect');
    // And every delivery the sink got is accounted for as succeeded.
    await expect
      .poll(async () => {
        const list = (await (await request.get(`/api/webhooks/${endpoint.id}/deliveries?limit=200`)).json()).deliveries as Array<{ status: string }>;
        return list.every((d) => d.status === 'succeeded');
      })
      .toBe(true);
    expect((await received(request, bin)).length).toBeGreaterThanOrEqual(types.length);
    await request.delete(`/api/matches/${slug}`);
  });
});

// ---------------------------------------------------------------------------
// A fake Ready Up server (the pattern of fleet-driver.spec.ts, trimmed).
// ---------------------------------------------------------------------------

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

class FakeReadyUp {
  seq = 0;
  private keepalive: NodeJS.Timeout | null = null;

  private constructor(
    readonly serverId: string,
    readonly installId: string,
    public client: FleetTestClient
  ) {}

  static async enroll(request: APIRequestContext, keyValue: string): Promise<FakeReadyUp> {
    const installId = newInstallId();
    const res = await enroll(request, { key: keyValue }, installId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const client = await FleetTestClient.connect(res.body.token);
    return new FakeReadyUp(res.body.server_id, installId, client);
  }

  async hello(over: Partial<HelloPayload> = {}): Promise<Envelope> {
    const welcome = await this.client.handshake(this.serverId, this.installId, {
      stream: { id: `stream-${this.serverId}`, last_tx_seq: this.seq, last_rx_seq: 0 },
      ...over,
    });
    this.keepalive = setInterval(() => this.client.send(envelope('ping', { t: Date.now() })), 5000);
    return welcome;
  }

  send(env: Omit<Envelope, 'seq'>): Envelope {
    const out = { ...env, seq: ++this.seq } as Envelope;
    expect(validateMessage(out), JSON.stringify(validateMessage(out).errors)).toEqual({ ok: true, errors: [] });
    this.client.send(out);
    return out;
  }

  answer(msg: Envelope, status: 'ok' | 'rejected' = 'ok', extra: Record<string, unknown> = {}): Envelope {
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

  availability(availability: 'available' | 'busy', reason = 'test'): Envelope {
    return this.send({ v: 1, type: 'server.availability', id: ulid(), ts: Date.now(), payload: { availability, reason } });
  }

  event(file: string, opts: { slug: string; epoch: number; rev: number; data?: Record<string, unknown> }): Envelope {
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

  snapshot(slug: string, epoch: number): void {
    const frame = example('live.state.snapshot.json');
    const payload = JSON.parse(JSON.stringify(frame.payload)) as { state: Record<string, unknown> };
    payload.state.match_id = slug;
    payload.state.epoch = epoch;
    payload.state.live_rev = 0;
    const { seq: _seq, ack: _ack, ...rest } = frame;
    this.client.send({ ...rest, id: ulid(), ts: Date.now(), epoch, payload });
  }

  next(type: string, timeoutMs = 20_000): Promise<Envelope> {
    return this.client.nextOfType(type, timeoutMs);
  }

  /** Answer our match.assign ok; refuse any other match handed out first. */
  async acceptAssign(slug: string): Promise<Envelope> {
    for (let i = 0; i < 10; i++) {
      const assign = await this.next('match.assign', 30_000);
      if ((assign.payload as { match_id: string }).match_id !== slug) {
        this.answer(assign, 'rejected', { error: { code: 'invalid_config', message: 'not this test' } });
        continue;
      }
      this.answer(assign, 'ok');
      return assign;
    }
    throw new Error(`no match.assign for ${slug}`);
  }

  close(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.client.close();
  }
}
