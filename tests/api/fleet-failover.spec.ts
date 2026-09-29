import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
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
  type InlineBackup,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Fleet failover (FLEET.md §11, fleet/failover.ts) with fake Ready Up
 * servers over the real gateway. Detection runs through
 * POST /api/test/fleet/failover/scan with no grace, so a server that is down
 * now counts as down.
 *
 * - auto (the default): server A dies mid-match → server B (the reserve)
 *   gets `match.assign` with a new epoch and `resume` (A's round backup,
 *   inline) → the match, its connect address and password are B's → A comes
 *   back holding the old epoch and gets `match.unassign {superseded}`;
 * - the same server comes back without the match: it resumes there;
 * - no free server: the failover waits (the match page shows it) and a
 *   server that comes online takes the match;
 * - auto-failover off: the admin moves the match from the match page.
 *
 * @tag api
 * @tag fleet
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;
const STEAM = (n: number) => `765611980002${String(n).padStart(5, '0')}`;

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
    return new FakeReadyUp(res.body.server_id, installId, res.body.token, client);
  }

  async hello(over: Partial<HelloPayload> = {}): Promise<Envelope> {
    const welcome = await this.client.handshake(this.serverId, this.installId, {
      stream: { id: `stream-${this.serverId}`, last_tx_seq: this.seq, last_rx_seq: 0 },
      ...over,
    });
    this.startKeepalive();
    return welcome;
  }

  /** The process dies: the socket goes without a close handshake. */
  kill(): void {
    this.stopKeepalive();
    this.client.ws.terminate();
  }

  /** Connect again after `kill` (or drop the socket and connect again). */
  async reconnect(over: Partial<HelloPayload> = {}): Promise<Envelope> {
    this.stopKeepalive();
    this.client.ws.terminate();
    this.client = await FleetTestClient.connect(this.token);
    return this.hello(over);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => this.client.send(envelope('ping', { t: Date.now() })), 5000);
  }

  private stopKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
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

  event(
    file: string,
    opts: { slug: string; epoch: number; rev: number; data?: Record<string, unknown>; patch?: Record<string, unknown> }
  ): Envelope {
    const frame = example(file);
    const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown> & {
      patch?: Record<string, unknown>;
    };
    payload.match_id = opts.slug;
    payload.rev = opts.rev;
    payload.patch = { ...(payload.patch ?? {}), ...(opts.patch ?? {}), live_rev: opts.rev };
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

  close(): void {
    this.stopKeepalive();
    this.client.close();
  }
}

async function link(request: APIRequestContext, fleetServerId: string): Promise<string> {
  const res = await request.post(`/api/fleet/servers/${fleetServerId}/link`, { headers: getAuthHeader(), data: {} });
  expect([200, 201], await res.text()).toContain(res.status());
  return (await res.json()).cs2ServerId as string;
}

async function unlink(request: APIRequestContext, fleetServerId: string): Promise<void> {
  await request.delete(`/api/fleet/servers/${fleetServerId}/link`, { headers: getAuthHeader() });
}

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
          name: 'Failover Alpha',
          players: [
            { steamid: STEAM(1), name: 'alice' },
            { steamid: STEAM(2), name: 'bob' },
          ],
        },
        team2: {
          name: 'Failover Bravo',
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

async function matchRow(request: APIRequestContext, slug: string): Promise<{ status?: string; serverId?: string } | null> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  if (!res.ok()) return null;
  const body = await res.json();
  const match = body.match ?? body;
  return { status: match?.status, serverId: match?.serverId ?? match?.server_id };
}

async function acceptAssign(fake: FakeReadyUp, slug: string): Promise<Envelope> {
  for (let i = 0; i < 10; i++) {
    const assign = await fake.next('match.assign', 30_000);
    if ((assign.payload as { match_id: string }).match_id !== slug) {
      fake.answer(assign, 'rejected', { error: { code: 'invalid_config', message: 'not this test' } });
      continue;
    }
    fake.answer(assign, 'ok');
    return assign;
  }
  throw new Error(`no match.assign for ${slug}`);
}

/** The match live on `fake` with a round backup stored (map 1, round 1). Returns the epoch and the backup. */
async function liveWithBackup(
  request: APIRequestContext,
  fake: FakeReadyUp,
  slug: string
): Promise<{ epoch: number; password: string; backup: InlineBackup }> {
  await createMatch(request, slug);
  const assign = await acceptAssign(fake, slug);
  const epoch = assign.epoch as number;
  await expect.poll(async () => (await matchRow(request, slug))?.status, { timeout: 20_000 }).toBe('loaded');
  fake.availability('busy', 'assigned');
  fake.snapshot(slug, epoch);
  fake.event('live.event.phase.json', {
    slug,
    epoch,
    rev: 1,
    patch: { phase: 'live' },
    data: { from: 'warmup', to: 'live', reason: 'flow' },
  });
  await expect.poll(async () => (await matchRow(request, slug))?.status, { timeout: 15_000 }).toBe('live');
  const sent = fake.event('live.event.backup.json', { slug, epoch, rev: 2 });
  await expect
    .poll(async () => {
      const res = await request.get(`/api/game/cs2/matches/${slug}/round-backups`, { headers: getAuthHeader() });
      return ((await res.json()).backups ?? []).length;
    })
    .toBe(1);
  return {
    epoch,
    password: (assign.payload as { config: { password: string } }).config.password,
    backup: (sent.payload as { data: InlineBackup }).data,
  };
}

/** Detection passes until one makes a failover (auto-failover moves it inside that pass). */
async function scanUntilProposed(request: APIRequestContext): Promise<Array<{ id: string; matchSlug: string }>> {
  let proposed: Array<{ id: string; matchSlug: string }> = [];
  await expect
    .poll(
      async () => {
        const res = await request.post('/api/test/fleet/failover/scan', { headers: getAuthHeader(), data: {} });
        expect(res.ok(), await res.text()).toBe(true);
        proposed = (await res.json()).proposed;
        return proposed.length;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  return proposed;
}

async function failoverView(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/game/cs2/matches/${slug}/failover`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function setFailover(request: APIRequestContext, data: { auto?: boolean; reserve?: number | null }) {
  const res = await request.put('/api/fleet/failover/settings', { headers: getAuthHeader(), data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test.describe.serial('Fleet failover (FLEET.md §11)', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-failover-tests' });
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    await setFailover(request, { auto: true, reserve: null });
  });

  test.afterEach(async ({ request }) => {
    while (cleanup.length) await cleanup.pop()?.();
    await setFailover(request, { auto: true, reserve: null });
  });

  test('auto: A dies mid-match → the reserve server B resumes from the backup → A comes back superseded', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const a = await FakeReadyUp.enroll(request);
    cleanup.push(() => a.close());
    await a.hello();
    const cs2A = await link(request, a.serverId);
    cleanup.push(() => unlink(request, a.serverId));

    const slug = `fleet-fo-${Date.now()}`;
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    const { epoch, password, backup } = await liveWithBackup(request, a, slug);

    // B joins the pool: with two servers online, it is the reserve (normal
    // allocation leaves it alone; failover does not).
    const b = await FakeReadyUp.enroll(request);
    cleanup.push(() => b.close());
    await b.hello();
    const cs2B = await link(request, b.serverId);
    cleanup.push(() => unlink(request, b.serverId));
    const settings = await (await request.get('/api/fleet/failover/settings', { headers: getAuthHeader() })).json();
    expect(settings.settings).toMatchObject({ auto: true, reserve: null });
    expect(settings.reserve).toMatchObject({ configured: null, effective: 1, poolSize: 2 });
    expect(settings.reserve.held.map((s: { id: string }) => s.id)).toEqual([cs2B]);

    // A's process dies.
    a.kill();
    const assigned = b.next('match.assign', 40_000).then((m) => {
      b.answer(m, 'ok');
      return m;
    });
    const proposed = await scanUntilProposed(request);
    expect(proposed.map((p) => p.matchSlug)).toContain(slug);
    const assign = await assigned;

    // B: a new epoch, a new password, and the match resumed from A's backup.
    expect(validateMessage(assign)).toEqual({ ok: true, errors: [] });
    const payload = assign.payload as {
      match_id: string;
      epoch: number;
      config: { password: string };
      resume: { from_epoch: number; map_number: number; round: number; backup: InlineBackup; score: unknown };
    };
    expect(payload.match_id).toBe(slug);
    expect(assign.epoch).toBe(epoch + 1);
    expect(payload.epoch).toBe(epoch + 1);
    expect(payload.config.password).not.toBe(password);
    expect(payload.resume).toMatchObject({ from_epoch: epoch, map_number: 1, round: backup.round, score: backup.score });
    expect(payload.resume.backup).toEqual({
      map_number: backup.map_number,
      round: backup.round,
      file: backup.file,
      size: backup.size,
      sha256: backup.sha256,
      score: backup.score,
      encoding: 'base64',
      data: backup.data,
    });

    // The match is on B, still live; players get B's address and password.
    await expect.poll(async () => (await matchRow(request, slug))?.serverId, { timeout: 15_000 }).toBe(cs2B);
    expect((await matchRow(request, slug))?.status).toBe('live');
    const connect = await (await request.get(`/api/game/cs2/matches/${slug}/connect`, { headers: getAuthHeader() })).json();
    expect(connect.server).toMatchObject({ id: cs2B, password: payload.config.password });
    expect(connect.server.moved).toMatchObject({ reason: 'offline', inPlace: false });

    // The record: moved, automatic, inline, from A's epoch to B's.
    const view = await failoverView(request, slug);
    expect(view.proposal).toBeNull();
    expect(view.recent[0]).toMatchObject({
      status: 'moved',
      reason: 'offline',
      fromCs2ServerId: cs2A,
      fromEpoch: epoch,
      newCs2ServerId: cs2B,
      newEpoch: epoch + 1,
      round: backup.round,
      inline: true,
      auto: true,
      decidedBy: 'platform:auto-failover',
    });

    // A comes back still holding the old epoch: superseded, with the kick message.
    const state = JSON.parse(JSON.stringify(example('live.state.snapshot.json').payload)).state as Record<string, unknown>;
    state.match_id = slug;
    state.epoch = epoch;
    const welcome = await a.reconnect({ state, availability: 'busy' });
    expect((welcome.payload as { assignment: unknown }).assignment).toBeNull();
    const zombie = await a.next('match.unassign');
    expect(zombie.payload).toMatchObject({ match_id: slug, epoch, reason: 'superseded', kick_message: expect.any(String) });
    expect(zombie.epoch).toBe(epoch);
    a.answer(zombie);
  });

  test('the same server comes back without the match: it resumes there', async ({ request }) => {
    test.setTimeout(120_000);
    const a = await FakeReadyUp.enroll(request);
    cleanup.push(() => a.close());
    await a.hello();
    const cs2A = await link(request, a.serverId);
    cleanup.push(() => unlink(request, a.serverId));

    const slug = `fleet-fo-same-${Date.now()}`;
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    const { epoch, backup } = await liveWithBackup(request, a, slug);

    // Crashed and restarted within the grace period: it holds nothing now.
    a.kill();
    await a.reconnect({ state: null, availability: 'available' });
    const assign = await a.next('match.assign', 30_000);
    a.answer(assign, 'ok');
    const payload = assign.payload as { match_id: string; resume: { from_epoch: number; round: number; backup?: InlineBackup } };
    expect(payload.match_id).toBe(slug);
    expect(assign.epoch).toBe(epoch + 1);
    expect(payload.resume).toMatchObject({ from_epoch: epoch, map_number: 1, round: backup.round });
    expect(payload.resume.backup?.sha256).toBe(backup.sha256);

    await expect
      .poll(async () => (await failoverView(request, slug)).recent[0]?.status, { timeout: 20_000 })
      .toBe('moved');
    const view = await failoverView(request, slug);
    expect(view.recent[0]).toMatchObject({ reason: 'restarted', fromCs2ServerId: cs2A, newCs2ServerId: cs2A, auto: true });
    expect((await matchRow(request, slug))?.serverId).toBe(cs2A);
  });

  test('no free server: the failover waits, then a server that comes online takes the match', async ({ request }) => {
    test.setTimeout(180_000);
    const a = await FakeReadyUp.enroll(request);
    cleanup.push(() => a.close());
    await a.hello();
    await link(request, a.serverId);
    cleanup.push(() => unlink(request, a.serverId));

    const slug = `fleet-fo-wait-${Date.now()}`;
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    const { epoch } = await liveWithBackup(request, a, slug);

    a.kill();
    await scanUntilProposed(request);
    const waiting = await failoverView(request, slug);
    expect(waiting.proposal).toMatchObject({ status: 'open', reason: 'offline', fromEpoch: epoch, targetCs2ServerId: null });
    expect(waiting.candidates).toEqual([]);

    // A server comes online and joins the pool: the next pass moves the match there.
    const b = await FakeReadyUp.enroll(request);
    cleanup.push(() => b.close());
    await b.hello();
    const cs2B = await link(request, b.serverId);
    cleanup.push(() => unlink(request, b.serverId));
    const assigned = b.next('match.assign', 40_000).then((m) => {
      b.answer(m, 'ok');
      return m;
    });
    const scanning = request.post('/api/test/fleet/failover/scan', { headers: getAuthHeader(), data: {} });
    const assign = await assigned;
    expect((assign.payload as { match_id: string }).match_id).toBe(slug);
    expect(assign.epoch).toBe(epoch + 1);
    await scanning;
    await expect.poll(async () => (await matchRow(request, slug))?.serverId, { timeout: 15_000 }).toBe(cs2B);
    expect((await failoverView(request, slug)).recent[0]).toMatchObject({ status: 'moved', newCs2ServerId: cs2B });
  });

  test('auto-failover off: the failover waits for the admin, who moves the match from the match page', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await setFailover(request, { auto: false });
    const a = await FakeReadyUp.enroll(request);
    cleanup.push(() => a.close());
    await a.hello();
    await link(request, a.serverId);
    cleanup.push(() => unlink(request, a.serverId));

    const slug = `fleet-fo-admin-${Date.now()}`;
    cleanup.push(async () => {
      await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    });
    const { epoch, backup } = await liveWithBackup(request, a, slug);
    const b = await FakeReadyUp.enroll(request);
    cleanup.push(() => b.close());
    await b.hello();
    const cs2B = await link(request, b.serverId);
    cleanup.push(() => unlink(request, b.serverId));

    a.kill();
    const [proposal] = await scanUntilProposed(request);
    const view = await failoverView(request, slug);
    expect(view.autoFailover).toBe(false);
    expect(view.proposal).toMatchObject({ id: proposal.id, status: 'open', targetCs2ServerId: cs2B, round: backup.round });
    expect(view.candidates.map((c: { id: string }) => c.id)).toContain(cs2B);
    expect(view.backups.map((x: { round: number }) => x.round)).toContain(backup.round);
    expect((await matchRow(request, slug))?.serverId).not.toBe(cs2B);

    // Another match's slug: not found.
    const wrong = await request.post(`/api/game/cs2/matches/not-${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: {},
    });
    expect(wrong.status()).toBe(404);

    const accepting = request.post(`/api/game/cs2/matches/${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: { targetServerId: cs2B, round: backup.round },
    });
    const assign = await b.next('match.assign', 30_000);
    expect(assign.epoch).toBe(epoch + 1);
    expect((assign.payload as { resume: { round: number } }).resume.round).toBe(backup.round);
    b.answer(assign, 'ok');
    const res = await accepting;
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).proposal).toMatchObject({ status: 'moved', auto: false, newCs2ServerId: cs2B });
    expect((await matchRow(request, slug))?.serverId).toBe(cs2B);

    // Decided: a second accept is refused.
    const again = await request.post(`/api/game/cs2/matches/${slug}/failover/${proposal.id}/accept`, {
      headers: getAuthHeader(),
      data: {},
    });
    expect(again.status()).toBe(409);
  });

  test('settings: validated, admin only', async ({ request, playwright, baseURL }) => {
    const bad = await request.put('/api/fleet/failover/settings', { headers: getAuthHeader(), data: { reserve: -1 } });
    expect(bad.status()).toBe(400);
    const badAuto = await request.put('/api/fleet/failover/settings', { headers: getAuthHeader(), data: { auto: 'yes' } });
    expect(badAuto.status()).toBe(400);
    const set = await setFailover(request, { reserve: 0 });
    expect(set.settings).toMatchObject({ auto: true, reserve: 0 });
    expect(set.reserve.effective).toBe(0);

    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/fleet/failover/settings')).status()).toBe(401);
    expect((await anon.get('/api/game/cs2/matches/some-match/failover')).status()).toBe(401);
    expect((await anon.post('/api/game/cs2/matches/some-match/failover/move', { data: {} })).status()).toBe(401);
    await anon.dispose();
  });
});
