import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { createTestServer, deleteServer } from '../helpers/servers';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import {
  validateMessage,
  type Envelope,
  type HelloPayload,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

/**
 * The fleet driver (api/src/integrations/cs2/driver.ts, fleet/driver.ts):
 * the platform plays a match on a Ready Up server, driven by a fake Ready Up
 * client over the real gateway.
 *
 * - allocation → match.assign → cmd.result ok → loaded; the connect password
 *   reaches the admin; going live, map result and series end complete the
 *   match; the platform unassigns it (`ended`), and the server, available
 *   again, takes the next match (turnover);
 * - a server that answers `busy` is skipped for the next one;
 * - admin buttons are fleet `cmd`s with their cmd.result; `exec` is root
 *   only and audited;
 * - a server that reconnects mid-match gets its assignment in `welcome`; a
 *   server holding an old epoch (hello or events) gets `match.unassign
 *   {superseded}`; `event.admin_called` lands in the admin calls;
 * - RCON servers keep their RCON path.
 *
 * @tag api
 * @tag fleet
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;
const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const STEAM = (n: number) => `765611980001${String(n).padStart(5, '0')}`;
// bob gets a player record, which the spec deletes after: a deleted player
// leaves a tombstone, so a fixed id would be "Deleted player" on the next run.
const BOB = `7656119${String(Date.now()).slice(-10)}`;

let key: { id: string; value: string };

/** A fake Ready Up server: its own seq counter, answers, keepalive. */
class FakeReadyUp {
  seq = 0;
  private keepalive: NodeJS.Timeout | null = null;

  private constructor(
    readonly serverId: string,
    readonly installId: string,
    readonly token: string,
    public client: FleetTestClient
  ) {}

  static async enroll(request: APIRequestContext): Promise<FakeReadyUp> {
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId);
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

  availability(availability: 'available' | 'busy', reason = 'test'): Envelope {
    return this.send({
      v: 1,
      type: 'server.availability',
      id: ulid(),
      ts: Date.now(),
      payload: { availability, reason },
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

  close(): void {
    this.stopKeepalive();
    this.client.close();
  }
}

async function link(
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

async function unlink(request: APIRequestContext, fleetServerId: string): Promise<void> {
  await request.delete(`/api/fleet/servers/${fleetServerId}/link`, { headers: getAuthHeader() });
}

/** A standalone match with no server: the allocator picks one. */
async function createMatch(request: APIRequestContext, slug: string): Promise<void> {
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
            { steamid: BOB, name: 'bob' },
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

async function matchRow(
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
async function acceptAssign(fake: FakeReadyUp, slug: string): Promise<Envelope> {
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

const assignFor = (slug: string) => (m: Envelope) =>
  m.type === 'match.assign' && (m.payload as { match_id: string }).match_id === slug;

test.describe.serial('Fleet driver: Ready Up servers play matches (M1)', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-driver-tests' });
    // Creating a match needs the webhook URL; a spec earlier in the shard may
    // have cleared it.
    // No bracket matches ahead of ours in the allocation queue.
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test.afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  test('allocation → assign → live → admin cmds → end → unassign → turnover', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    // The server takes the next match at once (allocation.ts serverCooldownSeconds: a kick
    // delay of 0 in the fleet's server settings means no wait after a match).
    const read = (
      await (await request.get('/api/fleet/settings', { headers: getAuthHeader() })).json()
    ).settings as { config?: Record<string, unknown>; match?: Record<string, unknown> };
    const before = { config: read?.config ?? {}, match: read?.match ?? {} };
    const zero = await request.put('/api/fleet/settings', {
      headers: getAuthHeader(),
      data: {
        settings: {
          ...before,
          config: {
            ...before.config,
            series_end_kick_delay: { no_demo: 0, demo_no_upload: 0, demo_upload: 0 },
          },
        },
      },
    });
    expect(zero.ok(), await zero.text()).toBe(true);
    cleanup.push(async () => {
      await request.put('/api/fleet/settings', {
        headers: getAuthHeader(),
        data: { settings: before },
      });
    });
    const fake = await FakeReadyUp.enroll(request);
    cleanup.push(() => fake.close());
    await fake.hello();
    const cs2ServerId = await link(request, fake.serverId);
    cleanup.push(() => unlink(request, fake.serverId));
    expect(cs2ServerId).toBe(fake.serverId);

    // The linked server is in the pool as a fleet server.
    const server = await (
      await request.get(`/api/servers/${cs2ServerId}`, { headers: getAuthHeader() })
    ).json();
    // Its status comes from the fleet link: connected is online (#210: it showed Down).
    expect(server.server ?? server).toMatchObject({
      transport: 'fleet',
      fleetServerId: fake.serverId,
      status: 'online',
    });

    // bob has a player record; the other rostered ids are test accounts with
    // none (M1 play-test: their stats rows failed the player FOREIGN KEY, and
    // the error cost bob his row too).
    const bobCreated = await request.post('/api/players', {
      headers: getAuthHeader(),
      data: { id: BOB, name: 'bob' },
    });
    expect([200, 201, 409], await bobCreated.text()).toContain(bobCreated.status());
    if (bobCreated.status() !== 409) {
      cleanup.push(async () => {
        await request.delete(`/api/players/${BOB}`, { headers: getAuthHeader() });
      });
    }

    // Allocation: the match goes to the Ready Up server.
    const slug = `fleet-drv-${Date.now()}`;
    await createMatch(request, slug);
    const assign = await acceptAssign(fake, slug);
    const payload = assign.payload as {
      epoch: number;
      config_rev: number;
      config: {
        password: string;
        maps: unknown[];
        team1: { name: string; players: unknown[] };
        rules: Record<string, unknown>;
      };
    };
    expect(assign.epoch).toBe(payload.epoch);
    expect(payload.config_rev).toBe(1);
    expect(payload.config.maps).toEqual([{ number: 1, name: 'de_mirage', sides: 'team1_ct' }]);
    expect(payload.config.team1).toMatchObject({ name: 'Fleet Alpha' });
    expect(payload.config.team1.players).toHaveLength(2);
    // No join password by default (at_join_password off): the roster whitelist keeps others out.
    expect(payload.config.password).toBe('');
    expect(payload.config.rules).toMatchObject({
      max_rounds: 24,
      demo: { record: true, upload: false },
    });
    const epoch = payload.epoch;

    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    expect((await matchRow(request, slug))?.serverId).toBe(cs2ServerId);

    // The connect password: admins see it (and the roster; nobody else).
    const connect = await (await request.get(`/api/game/cs2/matches/${slug}/connect`)).json();
    expect(connect.server).toMatchObject({ id: cs2ServerId, password: payload.config.password });

    // Live on map 1.
    fake.availability('busy', 'assigned');
    fake.snapshot(slug, epoch);
    fake.event('live.event.phase.json', {
      slug,
      epoch,
      rev: 1,
      data: { from: 'warmup', to: 'live', reason: 'flow' },
    });
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 15_000 })
      .toBe('live');

    // Admin buttons: cmd with the assignment's match_id + epoch, answered by cmd.result.
    const pausing = request.post('/api/rcon/pause-match', {
      headers: getAuthHeader(),
      data: { serverId: cs2ServerId },
    });
    const pause = await fake.next('cmd');
    expect(pause.payload).toMatchObject({
      name: 'pause',
      args: { type: 'technical' },
      match_id: slug,
      epoch,
    });
    expect(pause.epoch).toBe(epoch);
    expect((pause.payload as { expires_at: number }).expires_at).toBeGreaterThan(Date.now());
    fake.answer(pause, 'ok');
    const paused = await pausing;
    expect(paused.status()).toBe(200);
    expect(await paused.json()).toMatchObject({ success: true, transport: 'fleet', status: 'ok' });
    // The players hear it in game (gameMessages.ts): a say, not tied to the match.
    const told = await fake.next('cmd');
    expect(told.payload).toMatchObject({
      name: 'say',
      args: { text: 'The match is paused from the site.' },
      issued_by: { user_id: 'platform' },
    });
    fake.answer(told);

    const unpausing = request.post('/api/rcon/force-unpause', {
      headers: getAuthHeader(),
      data: { serverId: cs2ServerId },
    });
    const unpause = await fake.next('cmd');
    expect(unpause.payload).toMatchObject({ name: 'unpause' });
    fake.answer(unpause, 'rejected', { error: { code: 'not_paused', message: 'not paused' } });
    const refused = await unpausing;
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ success: false, errorCode: 'not_paused' });

    // say: not match-scoped.
    const saying = request.post('/api/rcon/say', {
      headers: getAuthHeader(),
      data: { serverId: cs2ServerId, message: 'hello "all"' },
    });
    const say = await fake.next('cmd');
    expect(say.payload).toMatchObject({ name: 'say', args: { text: 'hello all' } });
    expect((say.payload as { match_id?: string }).match_id).toBeUndefined();
    fake.answer(say);
    expect((await saying).status()).toBe(200);

    // exec: refused for a session admin not in ADMIN_STEAM_IDS...
    const denied = await request.post('/api/rcon/command', {
      headers: getAuthHeader(),
      data: { serverIds: [cs2ServerId], command: 'custom', value: 'status' },
    });
    expect((await denied.json()).results[0]).toMatchObject({
      success: false,
      error: expect.stringContaining('root'),
    });
    // ...and sent, audited, for an admin API token.
    const execing = request.post('/api/rcon/command', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      data: { serverIds: [cs2ServerId], command: 'custom', value: 'status' },
    });
    const exec = await fake.next('cmd');
    const execPayload = exec.payload as {
      name: string;
      args: { command: string };
      issued_by: { root: boolean };
      audit_id: string;
    };
    expect(execPayload).toMatchObject({
      name: 'exec',
      args: { command: 'status' },
      issued_by: { root: true },
    });
    expect(execPayload.audit_id).toMatch(/^[0-9A-Z]{26}$/);
    fake.answer(exec, 'ok', { output: 'hostname: readyup', audit_id: execPayload.audit_id });
    const execResult = (await (await execing).json()).results[0];
    expect(execResult).toMatchObject({
      success: true,
      transport: 'fleet',
      response: 'hostname: readyup',
      auditId: execPayload.audit_id,
    });

    // A player calls an admin: it lands in the core's admin calls.
    const callId = `fleet-call-${Date.now()}`;
    fake.event('event.admin_called.json', {
      slug,
      epoch,
      rev: 2,
      data: {
        call_id: callId,
        player: { steamid64: STEAM(1), name: 'alice', team: 'team1', side: 'ct' },
        message: 'smoke bugged',
        called_at: new Date().toISOString(),
      },
    });
    await expect
      .poll(async () => {
        const calls = await (
          await request.get('/api/admin-calls', { headers: getAuthHeader() })
        ).json();
        const list = (calls.open ?? []) as Array<{
          callId: string;
          matchSlug: string;
          serverId: string;
        }>;
        return list.find((c) => c.callId === callId) ?? null;
      })
      .toMatchObject({ matchSlug: slug, serverId: cs2ServerId });
    // Resolve it: an open call is a toast over every admin page of later UI specs.
    const open = (
      await (await request.get('/api/admin-calls', { headers: getAuthHeader() })).json()
    ).open as Array<{
      id: number;
      callId: string;
    }>;
    const call = open.find((c) => c.callId === callId);
    expect(call).toBeTruthy();
    const resolved = await request.post(`/api/admin-calls/${call!.id}/resolve`, {
      headers: getAuthHeader(),
    });
    expect(resolved.ok(), await resolved.text()).toBe(true);

    // Map result + series end: completed, and the platform unassigns (ended).
    const mapResult = example('live.event.map_result.json');
    fake.event('live.event.map_result.json', {
      slug,
      epoch,
      rev: 3,
      data: {
        ...(mapResult.payload.data as Record<string, unknown>),
        slug,
        winner: 'team1',
        team1_score: 13,
        team2_score: 5,
        team1_series_score: 1,
        team2_series_score: 0,
        series_over: true,
      },
    });
    const seriesEnd = example('live.event.series_end.natural.json');
    fake.event('live.event.series_end.natural.json', {
      slug,
      epoch,
      rev: 4,
      data: {
        ...(seriesEnd.payload.data as Record<string, unknown>),
        slug,
        winner: 'team1',
        team1_series_score: 1,
        team2_series_score: 0,
      },
    });
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('completed');
    // Stats: bob's row is written; the accounts without a player record are skipped.
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/players/${BOB}/summary`);
          if (!res.ok()) return null;
          const body = await res.json();
          const rows = (body.matches ?? body.data?.matches ?? []) as Array<{
            match_slug?: string;
            slug?: string;
          }>;
          return rows.some((m) => (m.match_slug ?? m.slug) === slug);
        },
        { timeout: 20_000 }
      )
      .toBe(true);
    const unassign = await fake.next('match.unassign');
    expect(unassign.payload).toMatchObject({ match_id: slug, epoch, reason: 'ended' });
    fake.answer(unassign);

    // The password is gone with the assignment.
    const after = await (await request.get(`/api/game/cs2/matches/${slug}/connect`)).json();
    expect(after.server?.password ?? null).toBeNull();

    // Turnover: available again, the server takes the next match.
    fake.availability('available', 'series_end');
    await expect
      .poll(async () => {
        const res = await request.get('/api/tournament/server-availability', {
          headers: getAuthHeader(),
        });
        const body = (await res.json()) as {
          servers?: Array<{ id: string; allocatable: boolean }>;
        };
        return body.servers?.find((s) => s.id === cs2ServerId)?.allocatable ?? null;
      })
      .toBe(true);
    const next = `fleet-drv2-${Date.now()}`;
    await createMatch(request, next);
    const assign2 = await acceptAssign(fake, next);
    expect(assign2.epoch).toBe(1);
    await expect
      .poll(async () => (await matchRow(request, next))?.status, { timeout: 20_000 })
      .toBe('loaded');

    // Force-cancel: unassign (cancelled), players kicked at once.
    const cancelled = await request.post(`/api/matches/${next}/force-cancel`, {
      headers: getAuthHeader(),
    });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    const unassign2 = await fake.next('match.unassign');
    expect(unassign2.payload).toMatchObject({
      match_id: next,
      reason: 'cancelled',
      kick_message: expect.any(String),
    });
    fake.answer(unassign2);
  });

  test('match chat bridge: in-game chat in, admin chat out as say, admin call notices', async ({
    request,
  }) => {
    test.setTimeout(150_000);
    const fake = await FakeReadyUp.enroll(request);
    cleanup.push(() => fake.close());
    await fake.hello();
    const cs2ServerId = await link(request, fake.serverId);
    cleanup.push(() => unlink(request, fake.serverId));

    const slug = `fleet-chat-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    const assign = await acceptAssign(fake, slug);
    const epoch = (assign.payload as { epoch: number }).epoch;
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    fake.availability('busy', 'assigned');
    fake.snapshot(slug, epoch);
    fake.event('live.event.phase.json', {
      slug,
      epoch,
      rev: 1,
      data: { from: 'warmup', to: 'live', reason: 'flow' },
    });
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 15_000 })
      .toBe('live');

    const channel = encodeURIComponent(`match:${slug}`);
    type Line = {
      body: string;
      senderKind: string;
      senderName: string;
      senderId: string | null;
      fromGame: boolean;
      onlyTeam: string | null;
    };
    const lines = async (): Promise<Line[]> =>
      (
        (await (
          await request.get(`/api/chat/${channel}/messages`, { headers: getAuthHeader() })
        ).json()) as { messages: Line[] }
      ).messages;

    // In: a chat line in game lands in the match's chat as the player (event.chat).
    const chat = (rev: number, message: string, teamOnly = false) =>
      fake.event('event.chat.json', {
        slug,
        epoch,
        rev,
        data: {
          player: { steamid64: STEAM(1), name: 'alice', team: 'team1', side: 'ct' },
          message,
          team_only: teamOnly,
          at: Date.now(),
        },
      });
    chat(2, 'need an admin for a sec');
    chat(3, 'eco this round', true);
    chat(4, '.ready');
    await expect
      .poll(async () => (await lines()).filter((l) => l.fromGame).map((l) => l.body))
      .toEqual(['need an admin for a sec', '(team) eco this round']);
    const [said, team] = (await lines()).filter((l) => l.fromGame);
    expect(said).toMatchObject({
      senderKind: 'player',
      senderName: 'alice',
      senderId: STEAM(1),
      onlyTeam: '',
    });
    // Game chat is for the admins only (the players have it in game).
    expect(team.onlyTeam).toBe('');
    const alice = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInAsPlayerViaRequest(alice, STEAM(1), 'alice')).toBe(true);
    const aliceLines = (
      (await (await alice.get(`/api/chat/${channel}/messages`)).json()) as {
        messages: Line[];
      }
    ).messages;
    expect(aliceLines.filter((l) => l.fromGame)).toEqual([]);
    const aliceChannels = (
      (await (await alice.get('/api/chat/channels')).json()) as {
        channels: Array<{ channel: string; unread: number }>;
      }
    ).channels;
    expect(aliceChannels.find((c) => c.channel === `match:${slug}`)?.unread ?? 0).toBe(0);
    await alice.dispose();
    // No loop: nothing from the game went back to the server.
    expect(
      fake.client.received.filter(
        (m) => m.type === 'cmd' && (m.payload as { name: string }).name === 'say'
      )
    ).toEqual([]);

    // The live overview has the match, with its server.
    const overview = (await (
      await request.get('/api/game/cs2/live-overview', { headers: getAuthHeader() })
    ).json()) as { matches: Array<Record<string, unknown>> };
    expect(overview.matches.find((m) => m.slug === slug)).toMatchObject({
      slug,
      status: 'live',
      source: 'manual',
      team1: { name: 'Fleet Alpha' },
      team2: { name: 'Fleet Bravo' },
      server: { id: cs2ServerId, online: true },
      call: null,
    });

    // Out: an admin's message is said on the server, with who wrote it.
    const posted = await request.post(`/api/chat/${channel}/messages`, {
      headers: getAuthHeader(),
      data: { body: 'on my way' },
    });
    expect(posted.ok(), await posted.text()).toBe(true);
    const out = await fake.next('cmd');
    expect(out.payload).toMatchObject({
      name: 'say',
      args: { text: 'on my way', from: expect.any(String), as_admin: true },
    });
    // A Ready Up that does not take it: the chat keeps the message, nothing breaks.
    fake.answer(out, 'rejected', { error: { code: 'unknown_command', message: 'say' } });
    await expect
      .poll(async () => (await lines()).some((l) => l.body === 'on my way' && !l.fromGame))
      .toBe(true);
    const again = await request.post(`/api/chat/${channel}/messages`, {
      headers: getAuthHeader(),
      data: { body: 'still here' },
    });
    expect(again.ok(), await again.text()).toBe(true);
    const out2 = await fake.next('cmd');
    expect(out2.payload).toMatchObject({ name: 'say', args: { text: 'still here' } });
    fake.answer(out2);

    // An admin call claimed and resolved: said in game, and a line in the match chat.
    const callId = `fleet-chat-call-${Date.now()}`;
    fake.event('event.admin_called.json', {
      slug,
      epoch,
      rev: 5,
      data: {
        call_id: callId,
        player: { steamid64: STEAM(1), name: 'alice', team: 'team1', side: 'ct' },
        message: 'smoke bugged',
        called_at: new Date().toISOString(),
      },
    });
    let call = 0;
    await expect
      .poll(async () => {
        const calls = (await (
          await request.get('/api/admin-calls', { headers: getAuthHeader() })
        ).json()) as { open: Array<{ id: number; callId: string }> };
        call = calls.open.find((c) => c.callId === callId)?.id ?? 0;
        return call;
      })
      .toBeGreaterThan(0);
    const overviewCall = (await (
      await request.get('/api/game/cs2/live-overview', { headers: getAuthHeader() })
    ).json()) as { matches: Array<{ slug: string; call: { id: number } | null }> };
    expect(overviewCall.matches.find((m) => m.slug === slug)?.call).toMatchObject({ id: call });

    const claimed = await request.post(`/api/admin-calls/${call}/claim`, {
      headers: getAuthHeader(),
    });
    expect((await claimed.json()).claimed).toBe(true);
    const onIt = await fake.next('cmd');
    expect(onIt.payload).toMatchObject({
      name: 'say',
      args: { text: expect.stringMatching(/is on it\. Reply here in chat\.$/) },
    });
    fake.answer(onIt);
    const resolved = await request.post(`/api/admin-calls/${call}/resolve`, {
      headers: getAuthHeader(),
    });
    expect(resolved.ok(), await resolved.text()).toBe(true);
    const done = await fake.next('cmd');
    expect(done.payload).toMatchObject({ name: 'say', args: { text: 'Admin call resolved.' } });
    fake.answer(done);
    await expect
      .poll(async () =>
        (await lines())
          .filter((l) => l.senderKind === 'system')
          .map((l) => (JSON.parse(l.body.slice(5)) as { key: string }).key)
          .filter((k) => k === 'adminClaimed' || k === 'adminResolved')
      )
      .toEqual(['adminClaimed', 'adminResolved']);
    // The platform's own lines are not said again in game.
    expect(
      fake.client.received.filter(
        (m) => m.type === 'cmd' && (m.payload as { name: string }).name === 'say'
      )
    ).toEqual([]);
  });

  test('a busy Ready Up server is skipped for the next one', async ({ request }) => {
    test.setTimeout(120_000);
    // Both servers take matches: no failover reserve (with two online, one is
    // kept free by default; fleet-failover.spec.ts covers that).
    const reserve = await request.put('/api/fleet/failover/settings', {
      headers: getAuthHeader(),
      data: { reserve: 0 },
    });
    expect(reserve.ok(), await reserve.text()).toBe(true);
    cleanup.push(async () => {
      await request.put('/api/fleet/failover/settings', {
        headers: getAuthHeader(),
        data: { reserve: null },
      });
    });
    const a = await FakeReadyUp.enroll(request);
    const b = await FakeReadyUp.enroll(request);
    cleanup.push(
      () => a.close(),
      () => b.close()
    );
    await a.hello();
    await b.hello();
    await link(request, a.serverId);
    await link(request, b.serverId);
    cleanup.push(
      () => unlink(request, a.serverId),
      () => unlink(request, b.serverId)
    );

    const slug = `fleet-busy-${Date.now()}`;
    await createMatch(request, slug);
    // Whichever gets it first says busy (a scrim it cannot end, say).
    // (Polled without consuming: a pending next() on the other client would
    // swallow the retry.)
    const ours = assignFor(slug);
    let first: { fake: FakeReadyUp; other: FakeReadyUp; m: Envelope } | null = null;
    for (const deadline = Date.now() + 30_000; !first && Date.now() < deadline;) {
      for (const [fake, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const i = fake.client.received.findIndex(ours);
        if (i >= 0) {
          first = { fake, other, m: fake.client.received.splice(i, 1)[0] };
          break;
        }
      }
      if (!first) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!first) throw new Error('no server got the match');
    first.fake.answer(first.m, 'rejected', { error: { code: 'busy', message: 'playing' } });
    const second = await first.other.client.next(ours, 30_000);
    expect((second.payload as { match_id: string }).match_id).toBe(slug);
    // A new epoch for the new assignment.
    expect(second.epoch).toBe((first.m.epoch as number) + 1);
    first.other.answer(second, 'ok');
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    expect((await matchRow(request, slug))?.serverId).toBe(first.other.serverId);
    await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
  });

  test('a server that does not answer the assign is passed over, not picked every pass', async ({
    request,
  }) => {
    // t10-r1m4 (2026-10-19): the only free server never answered; every 15 s
    // pass assigned it there again, for 12 hours.
    test.setTimeout(120_000);
    const silent = await FakeReadyUp.enroll(request);
    cleanup.push(() => silent.close());
    await silent.hello();
    await link(request, silent.serverId);
    cleanup.push(() => unlink(request, silent.serverId));

    const slug = `fleet-silent-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    // It gets the assign and never answers.
    const first = await silent.client.next(assignFor(slug), 30_000);
    // Past the 15 s answer wait and a sweep: no new assignment there (the
    // unacked one may be sent again; that is the same epoch).
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    const again = silent.client.received.filter(
      (m) => assignFor(slug)(m) && m.epoch !== first.epoch
    );
    expect(again, 'a new assignment went to the silent server').toHaveLength(0);
    expect((await matchRow(request, slug))?.serverId ?? null).toBeNull();

    // Another server that answers takes it.
    const other = await FakeReadyUp.enroll(request);
    cleanup.push(() => other.close());
    await other.hello();
    const otherId = await link(request, other.serverId);
    cleanup.push(() => unlink(request, other.serverId));
    await acceptAssign(other, slug);
    await expect
      .poll(async () => (await matchRow(request, slug))?.serverId, { timeout: 30_000 })
      .toBe(otherId);
  });

  test('a manual match with no free server waits, and takes the server once it is available', async ({
    request,
  }) => {
    // M1 play-test: the manual match tried allocation once at creation; the
    // only server was still in turnover, and the match stayed `ready` forever.
    test.setTimeout(120_000);
    const fake = await FakeReadyUp.enroll(request);
    cleanup.push(() => fake.close());
    await fake.hello();
    fake.availability('busy', 'series_end');
    const cs2ServerId = await link(request, fake.serverId);
    cleanup.push(() => unlink(request, fake.serverId));
    await expect
      .poll(async () => {
        const res = await request.get('/api/tournament/server-availability', {
          headers: getAuthHeader(),
        });
        const body = (await res.json()) as {
          servers?: Array<{ id: string; allocatable: boolean }>;
        };
        return body.servers?.find((s) => s.id === cs2ServerId)?.allocatable ?? null;
      })
      .toBe(false);

    const slug = `fleet-wait-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    // Nothing free: it waits in `ready`, nothing sent.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect((await matchRow(request, slug))?.status).toBe('ready');
    expect(fake.client.received.some(assignFor(slug))).toBe(false);

    // Turnover done: the server says available, and the waiting match goes to it.
    fake.availability('available', 'series_end');
    await acceptAssign(fake, slug);
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');
    expect((await matchRow(request, slug))?.serverId).toBe(cs2ServerId);
  });

  test('reconnect mid-match resumes; an old epoch is superseded (hello and events)', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const fake = await FakeReadyUp.enroll(request);
    cleanup.push(() => fake.close());
    await fake.hello();
    await link(request, fake.serverId);
    cleanup.push(() => unlink(request, fake.serverId));

    const slug = `fleet-rc-${Date.now()}`;
    await createMatch(request, slug);
    const assign = await acceptAssign(fake, slug);
    const epoch = assign.epoch as number;
    await expect
      .poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 })
      .toBe('loaded');

    // The link drops and comes back: welcome carries the assignment.
    const state = JSON.parse(JSON.stringify(example('live.state.snapshot.json').payload))
      .state as Record<string, unknown>;
    state.match_id = slug;
    state.epoch = epoch;
    const welcome = await fake.reconnect({ state, availability: 'busy' });
    expect(welcome.payload).toMatchObject({ assignment: { match_id: slug, epoch } });

    // The match moves on (a new epoch elsewhere): this server is now a zombie.
    const moved = await request.post('/api/test/fleet/assign', {
      headers: getAuthHeader(),
      data: { matchSlug: slug, serverId: fake.serverId },
    });
    expect(moved.ok()).toBe(true);
    const newEpoch = (await moved.json()).epoch as number;
    expect(newEpoch).toBe(epoch + 1);

    // Its hello still says the old epoch: match.unassign {superseded}.
    const again = await fake.reconnect({ state, availability: 'busy' });
    expect((again.payload as { assignment: unknown }).assignment).toBeNull();
    const zombie = await fake.next('match.unassign');
    expect(zombie.payload).toMatchObject({ match_id: slug, epoch, reason: 'superseded' });
    expect(zombie.epoch).toBe(epoch);
    fake.answer(zombie);

    // Another server sending events for the old epoch gets the same.
    const other = await FakeReadyUp.enroll(request);
    cleanup.push(() => other.close());
    await other.hello();
    other.event('live.event.pause.json', { slug, epoch, rev: 5 });
    const zombie2 = await other.next('match.unassign');
    expect(zombie2.payload).toMatchObject({ match_id: slug, epoch, reason: 'superseded' });
    await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
  });

  test('link to an existing server row, unlink gives it back; an unlinked row takes no commands', async ({
    request,
  }) => {
    const rcon = await createTestServer(request, 'fleet-rcon');
    expect(rcon).toBeTruthy();
    cleanup.push(async () => {
      await deleteServer(request, rcon!.id);
    });

    // A row no Ready Up server is linked to: the buttons have nothing to send to.
    const res = await request.post('/api/rcon/pause-match', {
      headers: getAuthHeader(),
      data: { serverId: rcon!.id },
    });
    const body = await res.json();
    expect(res.status()).toBe(404);
    expect(body.success).toBe(false);
    expect(body.commandId).toBeUndefined();
    const row = await (
      await request.get(`/api/servers/${rcon!.id}`, { headers: getAuthHeader() })
    ).json();
    expect(row.server ?? row).toMatchObject({ transport: 'rcon', fleetServerId: null });

    // A fleet server takes over that row, then gives it back.
    const fake = await FakeReadyUp.enroll(request);
    cleanup.push(() => fake.close());
    expect(await link(request, fake.serverId, rcon!.id)).toBe(rcon!.id);
    const listed = await (
      await request.get('/api/fleet/servers', { headers: getAuthHeader() })
    ).json();
    expect(listed.servers.find((s: { id: string }) => s.id === fake.serverId)).toMatchObject({
      linkedServerId: rcon!.id,
    });
    // Linking again is a no-op; linking it to another row is refused.
    const twice = await request.post(`/api/fleet/servers/${fake.serverId}/link`, {
      headers: getAuthHeader(),
      data: {},
    });
    expect(twice.status()).toBe(200);
    expect((await twice.json()).cs2ServerId).toBe(rcon!.id);
    const elsewhere = await request.post(`/api/fleet/servers/${fake.serverId}/link`, {
      headers: getAuthHeader(),
      data: { serverId: 'some-other-row' },
    });
    expect(elsewhere.status()).toBe(409);
    await unlink(request, fake.serverId);
    const back = await (
      await request.get(`/api/servers/${rcon!.id}`, { headers: getAuthHeader() })
    ).json();
    expect(back.server ?? back).toMatchObject({
      transport: 'rcon',
      fleetServerId: null,
      enabled: true,
    });
  });
});
