import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
  type Enrolled,
} from '../helpers/fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import { validateMessage, type Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Demo streaming over the fleet link (FLEET.md §12.2, §12.4), end to end: a
 * fake Ready Up client streams a real file to the running API across a
 * reconnect, the way fleet.so does (demo.begin → chunks → reconnect →
 * demo.begin again, resume at the platform's offset → the rest → demo.end),
 * and the demo then shows up like an HTTP-uploaded one: on the map result
 * and through the download route, byte for byte.
 *
 * Also: a demo for a match the server never held is refused (not_assigned),
 * a chunk for an unknown demo answers unknown_demo.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

const CHUNK = 64 * 1024;
const CAPABILITIES = ['match.v1', 'stats.v1', 'demo.stream.v1'];

let key: { id: string; value: string };

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

async function assign(request: APIRequestContext, matchSlug: string, serverId: string): Promise<number> {
  const res = await request.post('/api/test/fleet/assign', {
    headers: getAuthHeader(),
    data: { matchSlug, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).epoch as number;
}

async function acked(client: FleetTestClient, seq: number): Promise<void> {
  await client.next((m) => ['ack', 'ping', 'pong'].includes(m.type) && typeof m.ack === 'number' && m.ack >= seq, 5000);
}

/** A reliable frame from the examples, re-keyed to `slug` / `epoch` / `seq` / `rev`. */
function reliable(file: string, o: { slug: string; epoch: number; seq: number; rev: number; data?: Record<string, unknown> }): Envelope {
  const frame = example(file);
  const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown> & { patch?: Record<string, unknown> };
  payload.match_id = o.slug;
  payload.rev = o.rev;
  payload.patch = { ...(payload.patch ?? {}), live_rev: o.rev };
  if (o.data) payload.data = o.data;
  const { ack: _ack, ...rest } = frame;
  return { ...rest, id: ulid(), ts: Date.now(), seq: o.seq, epoch: o.epoch, payload };
}

function assignSnapshot(slug: string, epoch: number): Envelope {
  const frame = example('live.state.snapshot.json');
  const payload = JSON.parse(JSON.stringify(frame.payload)) as { state: Record<string, unknown> };
  payload.state.match_id = slug;
  payload.state.epoch = epoch;
  payload.state.live_rev = 0;
  const { seq: _seq, ack: _ack, ...rest } = frame;
  return { ...rest, id: ulid(), ts: Date.now(), epoch, payload };
}

/** A small "demo": a real GOTV header followed by deterministic bytes. */
function demoFile(size: number): Buffer {
  const out = crypto.createHash('sha256').update('seed').digest();
  const buf = Buffer.alloc(size);
  let block = out;
  for (let i = 0; i < size; i += block.length) {
    block.copy(buf, i);
    block = crypto.createHash('sha256').update(block).digest();
  }
  buf.write('HL2DEMO\0', 0, 'latin1');
  return buf;
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** Send a demo.* frame, return the demo.ack answering it (ref = its id). */
async function send(client: FleetTestClient, type: string, payload: object, epoch?: number): Promise<Envelope> {
  const msg = envelope(type, payload, epoch !== undefined ? { epoch } : {});
  expect(validateMessage(msg), JSON.stringify(validateMessage(msg).errors)).toEqual({ ok: true, errors: [] });
  client.send(msg);
  const answer = await client.next((m) => m.type === 'demo.ack' && m.ref === msg.id, 10_000);
  expect(validateMessage(answer)).toEqual({ ok: true, errors: [] });
  return answer;
}

function chunk(demoId: string, file: Buffer, offset: number) {
  const bytes = file.subarray(offset, Math.min(offset + CHUNK, file.length));
  return { demo_id: demoId, offset, size: bytes.length, data: bytes.toString('base64') };
}

test.describe.serial('Fleet demo stream (gateway)', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'demo-stream-tests' });
  });

  test('a demo streamed across a reconnect is stored, verified and shows up like an uploaded one', async ({ request }) => {
    const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, format: 'bo1' });
    expect(setup).toBeTruthy();
    const matches = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
    const slug = matches.matches?.[0]?.slug as string;
    expect(slug).toBeTruthy();

    const server = await enrollNew(request);
    const epoch = await assign(request, slug, server.server_id);
    const stream = { id: 'demo-stream', last_tx_seq: 0, last_rx_seq: 0 };
    let client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, { capabilities: CAPABILITIES, stream });
    client.send(assignSnapshot(slug, epoch));

    // Live, then map 1's result, so the map has its result row (as when the
    // demo finishes after the map ended).
    client.send(reliable('live.event.phase.json', { slug, epoch, seq: 1, rev: 1, data: { from: 'warmup', to: 'live', reason: 'flow' } }));
    await acked(client, 1);
    const mapResult = example('live.event.map_result.json');
    client.send(
      reliable('live.event.map_result.json', {
        slug,
        epoch,
        seq: 2,
        rev: 2,
        data: {
          ...(mapResult.payload.data as Record<string, unknown>),
          winner: 'team1',
          team1_score: 13,
          team2_score: 5,
          team1_series_score: 1,
          team2_series_score: 0,
          series_over: false,
        },
      })
    );
    await acked(client, 2);

    const file = demoFile(5 * CHUNK + 4321);
    const demoId = ulid();
    const name = `2026-09-29_18-02-11_${slug.replace(/[^A-Za-z0-9_-]/g, '_')}_de_dust2_A_vs_B.dem`;
    const begin = {
      demo_id: demoId,
      match_id: slug,
      map_number: 1,
      file: name,
      started_at: Date.now() - 60_000,
      chunk_size: CHUNK,
      recording: true,
    };

    // A chunk before any demo.begin: unknown_demo.
    expect((await send(client, 'demo.chunk', chunk(demoId, file, 0))).payload).toMatchObject({
      demo_id: demoId,
      offset: 0,
      error: { code: 'unknown_demo' },
    });

    expect((await send(client, 'demo.begin', begin, epoch)).payload).toEqual({ demo_id: demoId, offset: 0 });
    expect((await send(client, 'demo.chunk', chunk(demoId, file, 0))).payload).toEqual({ demo_id: demoId, offset: CHUNK });
    expect((await send(client, 'demo.chunk', chunk(demoId, file, CHUNK))).payload).toEqual({ demo_id: demoId, offset: 2 * CHUNK });
    // A chunk past the offset: a gap.
    expect((await send(client, 'demo.chunk', chunk(demoId, file, 3 * CHUNK))).payload).toMatchObject({
      offset: 2 * CHUNK,
      error: { code: 'gap' },
    });
    // The third chunk is lost with the connection.
    client.send(envelope('demo.chunk', chunk(demoId, file, 2 * CHUNK)));
    client.ws.terminate();
    await client.waitClosed();

    // Reconnect: demo.begin again, resume where the platform is.
    client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      capabilities: CAPABILITIES,
      stream: { ...stream, last_tx_seq: 2 },
    });
    const resumed = (await send(client, 'demo.begin', { ...begin, recording: false }, epoch)).payload as { offset: number };
    expect([2 * CHUNK, 3 * CHUNK]).toContain(resumed.offset);
    // CS2 rewrote the header when the recording stopped: re-sent below the offset.
    file.write('HL2DEMO\0\x04', 0, 'latin1');
    expect((await send(client, 'demo.chunk', chunk(demoId, file, 0))).payload).toEqual({ demo_id: demoId, offset: resumed.offset });
    for (let off = resumed.offset; off < file.length; off += CHUNK) {
      const ack = (await send(client, 'demo.chunk', chunk(demoId, file, off))).payload;
      expect(ack).toEqual({ demo_id: demoId, offset: Math.min(off + CHUNK, file.length) });
    }
    // A wrong hash: the copy is discarded, Ready Up restarts.
    expect((await send(client, 'demo.end', { demo_id: demoId, size: file.length, sha256: 'f'.repeat(64) })).payload).toMatchObject({
      offset: 0,
      error: { code: 'checksum' },
    });
    expect((await send(client, 'demo.begin', { ...begin, recording: false, restart: true }, epoch)).payload).toEqual({
      demo_id: demoId,
      offset: 0,
    });
    for (let off = 0; off < file.length; off += CHUNK) await send(client, 'demo.chunk', chunk(demoId, file, off));
    const done = await send(client, 'demo.end', { demo_id: demoId, size: file.length, sha256: sha(file) });
    expect(done.payload).toEqual({ demo_id: demoId, offset: file.length, complete: true });
    // demo.end again (Ready Up repeats it until it sees complete): same answer.
    expect((await send(client, 'demo.end', { demo_id: demoId, size: file.length, sha256: sha(file) })).payload).toEqual(done.payload);

    // Like an uploaded demo: on the map result, and downloadable byte for byte.
    const matchRes = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
    expect(matchRes.ok()).toBe(true);
    const body = await matchRes.json();
    const match = body.match ?? body;
    const map0 = (match.mapResults as Array<{ mapNumber: number; demoFilePath: string | null }>).find((m) => m.mapNumber === 0);
    expect(map0?.demoFilePath).toContain(name);
    const download = await request.get(`/api/demos/${slug}/download/0`, { headers: getAuthHeader() });
    expect(download.status()).toBe(200);
    expect(sha(Buffer.from(await download.body()))).toBe(sha(file));
    const info = await (await request.get(`/api/demos/${slug}/info`, { headers: getAuthHeader() })).json();
    expect(info).toMatchObject({ hasDemo: true, size: file.length, filename: name });
    client.close();
  });

  test('a demo for a match the server never held is refused (not_assigned)', async ({ request }) => {
    const server = await enrollNew(request);
    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, { capabilities: CAPABILITIES });
    const demoId = ulid();
    const answer = await send(
      client,
      'demo.begin',
      {
        demo_id: demoId,
        match_id: `not-held-${Date.now()}`,
        map_number: 1,
        file: 'nothing.dem',
        started_at: Date.now(),
        chunk_size: CHUNK,
        recording: true,
      },
      1
    );
    expect(answer.payload).toMatchObject({ demo_id: demoId, offset: 0, error: { code: 'not_assigned' } });
    client.close();
  });
});
