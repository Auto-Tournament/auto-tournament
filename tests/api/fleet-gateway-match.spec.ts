import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  newInstallId,
  resetEnrollRateLimit,
  type Enrolled,
} from '../helpers/fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import { validateMessage, type Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The gateway's step-3 path (Ready Up's docs/fleet-step3-platform-notes.md
 * §2-§5), driven by a fake Ready Up client that replays Ready Up's own frames
 * (tests/fixtures/fleet/v1) against the running API:
 *
 * - reliable server messages are stored before they are acked, applied, and
 *   a replayed seq is neither stored nor applied twice;
 * - the state store takes the assign snapshot and the patches in rev order;
 *   a rev gap gets a `state.request` and the answering snapshot releases the
 *   held patch;
 * - `sendReliable`: a match.assign reaches the server with the epoch in the
 *   envelope, is replayed after a reconnect until acked, and its cmd.result
 *   is stored against it (a match.update conflict moves the config_rev);
 * - fleet events reach the core: going live marks the match live, and a map
 *   result + series end finish a BO1 through matchLifecycle.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

let key: { id: string; value: string };

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

async function assign(
  request: APIRequestContext,
  matchSlug: string,
  serverId: string
): Promise<number> {
  const res = await request.post('/api/test/fleet/assign', {
    headers: getAuthHeader(),
    data: { matchSlug, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).epoch as number;
}

async function liveState(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/test/fleet/live-state/${slug}`, { headers: getAuthHeader() });
  if (res.status() === 404) return null;
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).record;
}

async function storedEvents(request: APIRequestContext, serverId: string) {
  const res = await request.get(`/api/test/fleet/events/${serverId}`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).events as Array<{
    seq: number;
    type: string;
    rev: number | null;
    match_slug: string | null;
    processed_at: number | null;
    error: string | null;
  }>;
}

async function command(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/test/fleet/commands/${id}`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).command;
}

async function matchStatus(request: APIRequestContext, slug: string): Promise<string | undefined> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  if (!res.ok()) return undefined;
  const body = await res.json();
  return (body.match ?? body)?.status as string | undefined;
}

/** The assign snapshot Ready Up sent in its live test, for `slug` / `epoch`. */
function assignSnapshot(slug: string, epoch: number, liveRev = 0): Envelope {
  const frame = example('live.state.snapshot.json');
  const payload = JSON.parse(JSON.stringify(frame.payload)) as {
    state: Record<string, unknown>;
    reason: string;
  };
  payload.state.match_id = slug;
  payload.state.epoch = epoch;
  payload.state.live_rev = liveRev;
  const { seq: _seq, ack: _ack, ...rest } = frame;
  return { ...rest, id: ulid(), ts: Date.now(), epoch, payload };
}

/** A reliable frame from the examples, re-keyed to `slug` / `epoch` / `seq` / `rev`. */
function reliable(
  file: string,
  opts: {
    slug: string;
    epoch: number;
    seq: number;
    rev?: number;
    data?: Record<string, unknown>;
    mapNumber?: number;
  }
): Envelope {
  const frame = example(file);
  const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown> & {
    patch?: Record<string, unknown>;
  };
  if ('match_id' in payload) payload.match_id = opts.slug;
  if (opts.rev !== undefined) {
    payload.rev = opts.rev;
    payload.patch = { ...(payload.patch ?? {}), live_rev: opts.rev };
  }
  if (opts.data) payload.data = opts.data;
  if (opts.mapNumber !== undefined) payload.map_number = opts.mapNumber;
  const { ack: _ack, ...rest } = frame;
  const env = { ...rest, id: ulid(), ts: Date.now(), seq: opts.seq, epoch: opts.epoch, payload };
  expect(validateMessage(env), `${file}: ${JSON.stringify(validateMessage(env).errors)}`).toEqual({
    ok: true,
    errors: [],
  });
  return env;
}

/**
 * The platform acked `seq`: a standalone ack, or one piggybacked on a
 * heartbeat, or on any other frame (a `match.unassign` the fleet driver sends
 * a fenced server carries it too). Other frames (state.request, match.*) are
 * left in the queue for the test to read.
 */
async function acked(client: FleetTestClient, seq: number): Promise<void> {
  const carries = (m: Envelope) => typeof m.ack === 'number' && m.ack >= seq;
  const control = (m: Envelope) => ['ack', 'ping', 'pong'].includes(m.type);
  for (const deadline = Date.now() + 5000; Date.now() < deadline; ) {
    const i = client.received.findIndex((m) => carries(m) && control(m));
    if (i >= 0) {
      client.received.splice(i, 1);
      return;
    }
    if (client.received.some(carries)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`seq ${seq} not acked; received: ${JSON.stringify(client.received.map((m) => m.type))}`);
}

test.describe.serial('Fleet gateway: match state and events (step 3)', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'gateway-match-tests' });
  });

  test('reliable messages are stored before the ack, applied once; a gap asks for a snapshot', async ({
    request,
  }) => {
    const server = await enrollNew(request);
    const slug = `fleet-t-${Date.now()}`;
    const epoch = await assign(request, slug, server.server_id);
    expect(epoch).toBe(1);

    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'match-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });

    // The assign snapshot (ephemeral): the baseline at rev 0.
    client.send(assignSnapshot(slug, epoch));
    await expect.poll(async () => (await liveState(request, slug))?.state?.phase).toBe('loading');

    // Ready Up's live state.patch as rev 1: stored, acked, applied.
    client.send(reliable('live.state.patch.json', { slug, epoch, seq: 1, rev: 1 }));
    await acked(client, 1);
    await expect.poll(async () => (await liveState(request, slug))?.liveRev).toBe(1);
    const rec = await liveState(request, slug);
    expect(rec.state.teams.team1.score).toBe(1);
    expect(rec.state.series.maps['1'].score).toEqual({ team1: 1, team2: 0 });

    // The same seq again (a replay after a lost ack): acked, not stored twice.
    client.send(reliable('live.state.patch.json', { slug, epoch, seq: 1, rev: 1 }));
    await acked(client, 1);
    let rows = await storedEvents(request, server.server_id);
    expect(rows.filter((r) => r.seq === 1)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'state.patch', rev: 1, match_slug: slug, error: null });
    expect(rows[0].processed_at).toBeGreaterThan(0);

    // An event with rev 3: a gap. Held, and the platform asks for a snapshot
    // (the request carries the ack for seq 2).
    client.send(
      reliable('live.event.phase.json', {
        slug,
        epoch,
        seq: 2,
        rev: 3,
        data: { from: 'loading', to: 'knife', reason: 'flow' },
      })
    );
    const request1 = await client.nextOfType('state.request');
    expect(validateMessage(request1).ok).toBe(true);
    expect(request1.epoch).toBe(epoch);
    expect(request1.seq).toBeUndefined();
    expect(request1.ack).toBe(2);
    expect((await liveState(request, slug)).needsSnapshot).toBe(true);

    // The answer at rev 2 releases the held rev 3.
    const answer = assignSnapshot(slug, epoch, 2);
    (answer.payload as { reason: string }).reason = 'request';
    client.send(answer);
    await expect.poll(async () => (await liveState(request, slug))?.liveRev).toBe(3);
    const after = await liveState(request, slug);
    expect(after.state.phase).toBe('knife');
    expect(after.needsSnapshot).toBe(false);

    // Reassigned (epoch 2): the epoch-1 server is fenced. Its event is stored
    // and acked, but does not move the match.
    const epoch2 = await assign(request, slug, server.server_id);
    expect(epoch2).toBe(epoch + 1);
    client.send(reliable('live.event.pause.json', { slug, epoch, seq: 3, rev: 4 }));
    await acked(client, 3);
    await expect
      .poll(async () => (await storedEvents(request, server.server_id))[2]?.processed_at ?? 0)
      .toBeGreaterThan(0);
    rows = await storedEvents(request, server.server_id);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const fenced = await liveState(request, slug);
    expect(fenced).toMatchObject({ epoch: epoch2, liveRev: 0, state: null });
    // ...and the fleet driver tells it to stop (FLEET.md §11.4).
    const zombie = await client.nextOfType('match.unassign');
    expect(zombie.payload).toMatchObject({ match_id: slug, epoch, reason: 'superseded' });
    client.close();
  });

  test('sendReliable: match.assign with the epoch in the envelope, replayed until acked, answered by cmd.result', async ({
    request,
  }) => {
    const server = await enrollNew(request);
    const slug = `fleet-t-${Date.now()}`;
    const epoch = await assign(request, slug, server.server_id);
    const assignFrame = example('match.assign.json');
    const payload = { ...(assignFrame.payload as Record<string, unknown>), match_id: slug, epoch };

    // Invalid payloads never reach the outbox.
    const bad = await request.post('/api/test/fleet/send', {
      headers: getAuthHeader(),
      data: { serverId: server.server_id, type: 'match.assign', payload: { ...payload, epoch: 0 } },
    });
    expect(bad.status()).toBe(400);

    // Sent while offline: waits in the outbox.
    const sentRes = await request.post('/api/test/fleet/send', {
      headers: getAuthHeader(),
      data: { serverId: server.server_id, type: 'match.assign', payload },
    });
    expect(sentRes.ok(), await sentRes.text()).toBe(true);
    const sent = await sentRes.json();
    expect(sent).toMatchObject({ delivered: false, answered: true });
    expect((await command(request, sent.id)).status).toBe('pending');

    // First connect: delivered, not acked (the socket dies).
    const first = await FleetTestClient.connect(server.token);
    await first.handshake(server.server_id, server.installId, {
      stream: { id: 'cmd-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });
    const got1 = await first.nextOfType('match.assign');
    expect(validateMessage(got1)).toEqual({ ok: true, errors: [] });
    expect(got1).toMatchObject({ id: sent.id, seq: sent.seq, epoch });
    first.ws.terminate();

    // Reconnect without having processed it: replayed, same id and seq.
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'cmd-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });
    const got2 = await client.nextOfType('match.assign');
    expect(got2).toMatchObject({ id: sent.id, seq: sent.seq, epoch });

    // Ready Up acks it and answers with exactly one cmd.result (ref = its id).
    const result = reliable('live.cmd.result.json', { slug, epoch, seq: 1 });
    client.send({ ...result, ack: got2.seq, ref: got2.id });
    await acked(client, 1);
    await expect.poll(async () => (await command(request, sent.id)).status).toBe('ok');
    const cmd = await command(request, sent.id);
    expect(cmd).toMatchObject({ type: 'match.assign', matchSlug: slug, epoch, seq: sent.seq });

    // match.update answered with a conflict: the server's config_rev is the new CAS base.
    const updRes = await request.post('/api/test/fleet/send', {
      headers: getAuthHeader(),
      data: {
        serverId: server.server_id,
        type: 'match.update',
        payload: {
          match_id: slug,
          epoch,
          base_config_rev: 0,
          config_rev: 2,
          ops: [{ op: 'rename_team', team: 'team1', name: 'Renamed' }],
        },
      },
    });
    expect(updRes.ok(), await updRes.text()).toBe(true);
    const upd = await updRes.json();
    expect(upd.delivered).toBe(true);
    const gotUpd = await client.nextOfType('match.update');
    expect(gotUpd.epoch).toBe(epoch);
    const conflict = reliable('live.cmd.result.conflict.json', { slug, epoch, seq: 2 });
    client.send({ ...conflict, ack: gotUpd.seq, ref: gotUpd.id });
    await acked(client, 2);
    await expect.poll(async () => (await command(request, upd.id)).errorCode).toBe('conflict');
    await expect.poll(async () => (await liveState(request, slug))?.configRev).toBe(1);

    // A cmd.result for a message the platform never sent is stored and logged, nothing else.
    client.send({ ...reliable('live.cmd.result.json', { slug, epoch, seq: 3 }), ref: ulid() });
    await acked(client, 3);
    client.close();
  });

  test('fleet events reach the core: live on going live, completed after map result + series end', async ({
    request,
  }) => {
    const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, format: 'bo1' });
    expect(setup).toBeTruthy();
    const matches = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
    const slug = matches.matches?.[0]?.slug as string;
    expect(slug).toBeTruthy();

    const server = await enrollNew(request);
    const epoch = await assign(request, slug, server.server_id);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'core-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });
    client.send(assignSnapshot(slug, epoch));
    await expect.poll(async () => (await liveState(request, slug))?.epoch).toBe(epoch);

    // warmup -> live on map 1: series.started + map.started -> the match is live.
    client.send(
      reliable('live.event.phase.json', {
        slug,
        epoch,
        seq: 1,
        rev: 1,
        data: { from: 'warmup', to: 'live', reason: 'flow' },
      })
    );
    await acked(client, 1);
    await expect.poll(() => matchStatus(request, slug), { timeout: 10_000 }).toBe('live');

    // Map 1 won by team1 13-5, series 1-0; then the series end.
    const mapResult = example('live.event.map_result.json');
    // The example's players are dev bots, which are not stored outside a
    // simulation: one becomes a person, so its map stats are kept.
    const botId = '12731676150871359538';
    const personId = `7656119${String(Date.now()).slice(-10)}`;
    const mapData = JSON.parse(
      JSON.stringify(mapResult.payload.data).split(botId).join(personId)
    ) as { stats: { players: Array<{ id: string; bot: boolean }> } };
    for (const p of mapData.stats.players) if (p.id === personId) p.bot = false;
    const data = {
      ...(mapData as unknown as Record<string, unknown>),
      slug,
      winner: 'team1',
      team1_score: 13,
      team2_score: 5,
      team1_series_score: 1,
      team2_series_score: 0,
      series_over: true,
    };
    client.send(reliable('live.event.map_result.json', { slug, epoch, seq: 2, rev: 2, data }));
    await acked(client, 2);
    const seriesEnd = example('live.event.series_end.natural.json');
    client.send(
      reliable('live.event.series_end.natural.json', {
        slug,
        epoch,
        seq: 3,
        rev: 3,
        data: {
          ...(seriesEnd.payload.data as Record<string, unknown>),
          slug,
          winner: 'team1',
          team1_series_score: 1,
          team2_series_score: 0,
        },
      })
    );
    await acked(client, 3);
    await expect.poll(() => matchStatus(request, slug), { timeout: 15_000 }).toBe('completed');

    await expect
      .poll(
        async () =>
          (await storedEvents(request, server.server_id)).filter((r) => r.processed_at).length
      )
      .toBe(3);
    const rows = await storedEvents(request, server.server_id);
    expect(rows.map((r) => r.type)).toEqual([
      'event.phase',
      'event.map_result',
      'event.series_end',
    ]);
    expect(rows.map((r) => r.error)).toEqual([null, null, null]);

    // The map's extra numbers (cs2_player_map_stats) reach the CS2 profile.
    const profile = await request.get(`/api/game/cs2/players/${personId}/profile`);
    expect(profile.ok()).toBe(true);
    const detail = (await profile.json()).detail?.player;
    expect(detail?.maps).toBe(1);
    expect(detail?.roundsPlayed).toBe(4);
    expect(typeof detail?.rating).toBe('number');
    expect(detail.ct.rounds + detail.t.rounds).toBe(4);
    client.close();
  });
});
