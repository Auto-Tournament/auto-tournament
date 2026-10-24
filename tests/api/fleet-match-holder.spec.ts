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
import {
  LiveStateStore,
  createMemoryLiveStatePersistence,
} from '../../api/src/integrations/cs2/fleet/state';
import {
  validateMessage,
  type Envelope,
  type MatchState,
  type StateSnapshotPayload,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * A match's live state, events and demos are taken only from the Ready Up
 * server holding that match at its epoch (fleet/state.ts, fleet/inbound.ts,
 * fleet/driver.ts, routes/demos.ts): another server's snapshot, patch, event
 * or demo upload changes nothing, whatever epoch it names or leaves out, and
 * a snapshot never brings an epoch the platform did not give its sender.
 *
 * @tag api
 * @tag fleet
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

function snapshotPayload(slug: string, epoch: number, liveRev = 0): StateSnapshotPayload {
  const frame = JSON.parse(
    fs.readFileSync(path.join(EXAMPLES, 'live.state.snapshot.json'), 'utf8')
  ) as Envelope;
  const payload = JSON.parse(JSON.stringify(frame.payload)) as StateSnapshotPayload;
  const state = payload.state as MatchState;
  payload.state = { ...state, match_id: slug, epoch, live_rev: liveRev };
  return payload;
}

const patch = (epoch?: number) => ({
  matchSlug: 'm-holder',
  ...(epoch !== undefined ? { epoch } : {}),
  rev: 1,
  patch: { live_rev: 1, phase: 'live' },
  type: 'state.patch',
});

test.describe('live state store: the holder only (no server)', () => {
  test("another server's snapshot and patches, with any epoch or none, are refused", async () => {
    const store = new LiveStateStore(createMemoryLiveStatePersistence());
    const { epoch } = await store.beginAssignment('m-holder', 'fs_a', 1);
    expect(epoch).toBe(1);

    for (const e of [1, 2]) {
      expect((await store.applySnapshot('fs_b', snapshotPayload('m-holder', e))).kind).toBe(
        'stale_epoch'
      );
    }
    expect((await store.applyPatch('fs_b', patch())).kind).toBe('stale_epoch');
    expect((await store.applyPatch('fs_b', patch(1))).kind).toBe('stale_epoch');
    expect((await store.applyPatch('fs_b', patch(2))).kind).toBe('stale_epoch');
    expect(store.heldCount('m-holder')).toBe(0);
    expect(await store.getLiveState('m-holder')).toMatchObject({
      epoch: 1,
      serverId: 'fs_a',
      state: null,
    });

    // The holder: its own epoch, and a patch with none is at its epoch.
    expect((await store.applySnapshot('fs_a', snapshotPayload('m-holder', 1))).kind).toBe(
      'replaced'
    );
    expect((await store.applyPatch('fs_a', patch())).kind).toBe('applied');
    expect((await store.getLiveState('m-holder'))!.state!.phase).toBe('live');
  });

  test('a snapshot never brings an epoch that was not given to its sender', async () => {
    const store = new LiveStateStore(createMemoryLiveStatePersistence());
    await store.beginAssignment('m-holder', 'fs_a', 1);
    expect((await store.applySnapshot('fs_a', snapshotPayload('m-holder', 5))).kind).toBe(
      'stale_epoch'
    );
    expect((await store.getLiveState('m-holder'))!.epoch).toBe(1);
    // A match never assigned has no holder.
    expect((await store.applySnapshot('fs_a', snapshotPayload('m-none', 1))).kind).toBe(
      'stale_epoch'
    );
    expect(await store.getLiveState('m-none')).toBeNull();
  });
});

let key: { id: string; value: string };

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

async function connect(server: Enrolled & { installId: string }): Promise<FleetTestClient> {
  const client = await FleetTestClient.connect(server.token);
  await client.handshake(server.server_id, server.installId, {
    stream: { id: `holder-${server.server_id}`, last_tx_seq: 0, last_rx_seq: 0 },
  });
  return client;
}

async function liveState(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/test/fleet/live-state/${slug}`, { headers: getAuthHeader() });
  if (res.status() === 404) return null;
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).record;
}

async function matchStatus(request: APIRequestContext, slug: string): Promise<string | undefined> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  if (!res.ok()) return undefined;
  const body = await res.json();
  return (body.match ?? body)?.status as string | undefined;
}

async function processed(request: APIRequestContext, serverId: string): Promise<number> {
  const res = await request.get(`/api/test/fleet/events/${serverId}`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()).events as Array<{ processed_at: number | null }>).filter(
    (e) => e.processed_at
  ).length;
}

function snapshotFrame(slug: string, epoch: number): Envelope {
  const frame = example('live.state.snapshot.json');
  const { seq: _seq, ack: _ack, ...rest } = frame;
  return { ...rest, id: ulid(), ts: Date.now(), epoch, payload: snapshotPayload(slug, epoch) };
}

function phaseLive(slug: string, seq: number, epoch: number | undefined): Envelope {
  const frame = example('live.event.phase.json');
  const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown>;
  payload.match_id = slug;
  payload.rev = 1;
  payload.patch = { ...((payload.patch as object) ?? {}), live_rev: 1 };
  payload.data = { from: 'warmup', to: 'live', reason: 'flow' };
  const { ack: _ack, epoch: _epoch, ...rest } = frame;
  const env = {
    ...rest,
    id: ulid(),
    ts: Date.now(),
    seq,
    ...(epoch !== undefined ? { epoch } : {}),
    payload,
  } as Envelope;
  expect(validateMessage(env).errors).toEqual([]);
  return env;
}

function forfeitFrame(slug: string, seq: number, epoch: number | undefined): Envelope {
  const frame = example('live.event.phase.json');
  const { ack: _ack, epoch: _epoch, ...rest } = frame;
  const env = {
    ...rest,
    type: 'event.forfeit',
    id: ulid(),
    ts: Date.now(),
    seq,
    ...(epoch !== undefined ? { epoch } : {}),
    payload: {
      match_id: slug,
      map_number: 1,
      rev: 1,
      patch: { live_rev: 1 },
      data: { team: 'team1', reason: 'ff' },
    },
  } as Envelope;
  expect(validateMessage(env).errors).toEqual([]);
  return env;
}

/** How many times a forfeit notice was raised for `slug` (match slugs repeat across tournaments). */
async function forfeitNotices(request: APIRequestContext, slug: string): Promise<number> {
  const res = await request.get('/api/admin-notices?limit=200', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return (
    (await res.json()).notices as Array<{
      kind: string;
      count: number;
      data: { matchSlug?: string };
    }>
  )
    .filter((n) => n.kind === 'match_forfeit' && n.data.matchSlug === slug)
    .reduce((sum, n) => sum + n.count, 0);
}

test.describe.serial('Fleet: the server holding the match', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'holder-tests' });
  });

  test("another server's snapshot, events and demo do not touch the match", async ({ request }) => {
    const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, format: 'bo1' });
    expect(setup).toBeTruthy();
    const matches = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
    const match = matches.matches?.[0] as { slug: string; id: number };
    expect(match?.slug).toBeTruthy();
    const slug = match.slug;

    const a = await enrollNew(request);
    const b = await enrollNew(request);
    const assigned = await request.post('/api/test/fleet/assign', {
      headers: getAuthHeader(),
      data: { matchSlug: slug, serverId: a.server_id },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
    const epoch = (await assigned.json()).epoch as number;

    const holder = await connect(a);
    const other = await connect(b);
    holder.send(snapshotFrame(slug, epoch));
    await expect.poll(async () => (await liveState(request, slug))?.state?.phase).toBe('loading');

    // The other server: a snapshot at the match's epoch and at the next one.
    other.send(snapshotFrame(slug, epoch));
    other.send(snapshotFrame(slug, epoch + 1));
    // Its events, with the match's epoch and with none: stored and applied, no effect.
    other.send(phaseLive(slug, 1, epoch));
    other.send(phaseLive(slug, 2, undefined));
    await expect.poll(() => processed(request, b.server_id)).toBe(2);
    expect(await liveState(request, slug)).toMatchObject({
      epoch,
      serverId: a.server_id,
      liveRev: 0,
    });
    expect(await matchStatus(request, slug)).not.toBe('live');

    // Its demo upload for the match.
    const upload = (token: string) =>
      request.post(`/api/demos/${slug}/upload`, {
        headers: {
          'X-Auto-Tournament-Token': token,
          'Content-Type': 'application/octet-stream',
          'Auto-Tournament-FileName': `holder-${Date.now()}.dem`,
          'Auto-Tournament-MatchId': String(match.id),
          'Auto-Tournament-MapNumber': '1',
          'Auto-Tournament-RoundNumber': '0',
        },
        data: Buffer.from('fake demo bytes'),
      });
    expect((await upload(b.token)).status()).toBe(403);

    // The holder: its event at no epoch is at its own, and moves the match.
    holder.send(phaseLive(slug, 1, undefined));
    await expect.poll(() => matchStatus(request, slug), { timeout: 10_000 }).toBe('live');
    const ok = await upload(a.token);
    expect(ok.ok(), await ok.text()).toBe(true);
    holder.close();
    other.close();
  });

  test("another server's forfeit raises no admin notice", async ({ request }) => {
    const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, format: 'bo1' });
    expect(setup).toBeTruthy();
    const matches = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
    const slug = (matches.matches?.[0] as { slug: string }).slug;
    expect(slug).toBeTruthy();

    const a = await enrollNew(request);
    const b = await enrollNew(request);
    const assigned = await request.post('/api/test/fleet/assign', {
      headers: getAuthHeader(),
      data: { matchSlug: slug, serverId: a.server_id },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
    const epoch = (await assigned.json()).epoch as number;

    const holder = await connect(a);
    const other = await connect(b);
    holder.send(snapshotFrame(slug, epoch));
    await expect.poll(async () => (await liveState(request, slug))?.state?.phase).toBe('loading');
    const before = await forfeitNotices(request, slug);

    other.send(forfeitFrame(slug, 1, epoch));
    other.send(forfeitFrame(slug, 2, undefined));
    await expect.poll(() => processed(request, b.server_id)).toBe(2);
    // The notice is raised after the event is stored; give a stray one time to land.
    await new Promise((r) => setTimeout(r, 500));
    expect(await forfeitNotices(request, slug)).toBe(before);

    holder.send(forfeitFrame(slug, 1, undefined));
    await expect.poll(() => forfeitNotices(request, slug), { timeout: 10_000 }).toBe(before + 1);
    holder.close();
    other.close();
  });
});
