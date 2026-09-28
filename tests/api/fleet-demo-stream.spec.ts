import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  DemoPacer,
  DemoStreamReceiver,
  INCOMING_DIR_NAME,
  decodeChunkData,
  type AssignmentCheck,
  type DemoStreamPersistence,
  type DemoStreamPlatform,
  type DemoStreamRow,
} from '../../api/src/integrations/cs2/fleet/demoStream';
import {
  DEMO_STREAM_CAPABILITY,
  FLEET_LIMIT_DEFAULTS,
  socketBytesPerMinute,
} from '../../api/src/integrations/cs2/fleet/limits';
import {
  FLEET_MESSAGES,
  isKnownMessageType,
  validateMessage,
  validatePayload,
  type DemoAckPayload,
  type Envelope,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * The platform's demo stream receiver (FLEET.md §12.2; Ready Up's
 * demo.{begin,chunk,end,ack}.json), on a temp dir and in-memory rows:
 *
 * - offsets: `demo.ack.offset` is the bytes stored contiguously from 0; a
 *   chunk past it is a gap (nothing written), one below it overwrites;
 * - demo.end: short → the stored offset; size + sha256 match → the file moves
 *   to <match>/map<N>/<file>, complete (also when repeated); a mismatch
 *   discards the copy (checksum) and `restart` starts over;
 * - resume after a reconnect / platform restart continues from the stored
 *   offset (and from what is on disk when the file lost bytes);
 * - guards: unknown_demo, not_assigned, stale_epoch, too_large, storage;
 * - expiry of abandoned streams; the ack pacer; the socket byte budget.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

const DEMO = '01J8ZQ4T8W6N3X0F2R5K7M9D01';
const SERVER = 's_demo_test';
const CHUNK = 4096;

class MemoryRows implements DemoStreamPersistence {
  rows = new Map<string, DemoStreamRow>();
  failNext = false;
  private maybeFail(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('database is down');
    }
  }
  async get(id: string) {
    this.maybeFail();
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async insert(row: DemoStreamRow) {
    this.maybeFail();
    if (!this.rows.has(row.demoId)) this.rows.set(row.demoId, { ...row });
  }
  async update(id: string, patch: Partial<DemoStreamRow>) {
    this.maybeFail();
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async listStale(before: number) {
    return [...this.rows.values()].filter((r) => r.state !== 'complete' && r.updatedAt < before);
  }
  async partPaths() {
    return new Set([...this.rows.values()].filter((r) => r.state !== 'complete').map((r) => r.partPath));
  }
}

interface Harness {
  dir: string;
  rows: MemoryRows;
  stored: DemoStreamRow[];
  refused: Array<{ row: DemoStreamRow; code: string }>;
  assignment: AssignmentCheck;
  clock: { now: number };
  receiver: DemoStreamReceiver;
  /** A new receiver over the same rows and dir (a platform restart). */
  restart(): DemoStreamReceiver;
}

function harness(maxBytes = 1024 * 1024): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-demo-'));
  const h = {
    dir,
    rows: new MemoryRows(),
    stored: [] as DemoStreamRow[],
    refused: [] as Array<{ row: DemoStreamRow; code: string }>,
    assignment: 'ok' as AssignmentCheck,
    clock: { now: Date.UTC(2026, 8, 29, 12) },
  } as Harness;
  const platform: DemoStreamPlatform = {
    checkAssignment: async () => h.assignment,
    stored: async (row) => {
      h.stored.push(row);
    },
    refused: async (row, code) => {
      h.refused.push({ row, code });
    },
  };
  const make = () =>
    new DemoStreamReceiver({ dir, persistence: h.rows, platform, maxBytes, now: () => h.clock.now });
  h.receiver = make();
  h.restart = () => {
    h.receiver = make();
    return h.receiver;
  };
  return h;
}

function demoBytes(size: number, seed = 1): Buffer {
  const out = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  out.write('HL2DEMO\0', 0, 'latin1');
  return out;
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function begin(extra: Record<string, unknown> = {}) {
  return {
    demo_id: DEMO,
    match_id: 'ko-r1-m3',
    map_number: 2,
    file: '2026-09-29_18-02-11_ko-r1-m3_de_mirage_Alpha_vs_Bravo.dem',
    started_at: 1790340011000,
    chunk_size: CHUNK,
    recording: true,
    ...extra,
  };
}

function chunkOf(file: Buffer, offset: number, size = CHUNK) {
  const bytes = file.subarray(offset, Math.min(offset + size, file.length));
  return { demo_id: DEMO, offset, size: bytes.length, data: bytes.toString('base64') };
}

/** Every chunk of `file` from `from`, in order; returns the last ack. */
async function sendFrom(r: DemoStreamReceiver, file: Buffer, from: number): Promise<DemoAckPayload> {
  let last: DemoAckPayload = { demo_id: DEMO, offset: from };
  for (let off = from; off < file.length; off += CHUNK) {
    last = await r.chunk(SERVER, chunkOf(file, off));
    expect(last.error, JSON.stringify(last)).toBeUndefined();
    expect(last.offset).toBe(Math.min(off + CHUNK, file.length));
  }
  return last;
}

const finalFile = (h: Harness) =>
  path.join(h.dir, 'ko-r1-m3', 'map2', '2026-09-29_18-02-11_ko-r1-m3_de_mirage_Alpha_vs_Bravo.dem');
const partFile = (h: Harness) => path.join(h.dir, INCOMING_DIR_NAME, `${DEMO}.part`);

test.describe('Fleet demo stream receiver', () => {
  test('schemas: the demo.* types are registered, Ready Up examples validate', () => {
    for (const type of ['demo.begin', 'demo.chunk', 'demo.end']) {
      expect(isKnownMessageType(type), type).toBe(true);
      expect(FLEET_MESSAGES[type as keyof typeof FLEET_MESSAGES]).toEqual({ direction: 'server_to_platform', reliable: false });
    }
    expect(FLEET_MESSAGES['demo.ack']).toEqual({ direction: 'platform_to_server', reliable: false });
    for (const file of ['demo.begin', 'demo.chunk', 'demo.end', 'demo.ack', 'demo.ack.gap', 'demo.ack.complete']) {
      const msg = example(`${file}.json`);
      expect(validateMessage(msg), file).toEqual({ ok: true, errors: [] });
    }
    // The receiver's answers are valid demo.ack payloads.
    expect(validatePayload('demo.ack', { demo_id: DEMO, offset: 0, error: { code: 'not_assigned', message: 'x' } }).ok).toBe(true);
    expect(validatePayload('demo.ack', { demo_id: DEMO, offset: 0, error: { code: 'nope' } }).ok).toBe(false);
    expect(validatePayload('demo.chunk', { demo_id: DEMO, offset: 0, size: 600000, data: 'AAAA' }).ok).toBe(false);
    expect(validatePayload('demo.begin', begin({ file: '../etc/passwd.dem' })).ok).toBe(false);
    // The example chunk's data really is its size.
    const chunk = example('demo.chunk.json').payload as { size: number; data: string };
    expect(decodeChunkData(chunk.data)?.length).toBe(chunk.size);
  });

  test('offsets: contiguous from 0; a gap writes nothing; below the offset overwrites', async () => {
    const h = harness();
    const file = demoBytes(3 * CHUNK + 100);
    expect(await h.receiver.begin(SERVER, 3, begin())).toEqual({ demo_id: DEMO, offset: 0 });
    expect(h.rows.rows.get(DEMO)).toMatchObject({ matchSlug: 'ko-r1-m3', mapNumber: 1, epoch: 3, state: 'receiving' });
    expect(fs.statSync(partFile(h)).size).toBe(0);

    expect(await h.receiver.chunk(SERVER, chunkOf(file, 0))).toEqual({ demo_id: DEMO, offset: CHUNK });
    // Past the offset: a gap, nothing written.
    const gap = await h.receiver.chunk(SERVER, chunkOf(file, 2 * CHUNK));
    expect(gap).toMatchObject({ offset: CHUNK, error: { code: 'gap' } });
    expect(validatePayload('demo.ack', gap).ok).toBe(true);
    expect(fs.statSync(partFile(h)).size).toBe(CHUNK);
    // The same chunk again (a resend): the offset does not move.
    expect((await h.receiver.chunk(SERVER, chunkOf(file, 0))).offset).toBe(CHUNK);
    expect((await h.receiver.chunk(SERVER, chunkOf(file, CHUNK))).offset).toBe(2 * CHUNK);

    // CS2 rewrites the header at the end: a chunk below the offset overwrites
    // and leaves the offset alone.
    const header = Buffer.from(file.subarray(0, CHUNK));
    header.write('REWRITTEN', 8, 'latin1');
    file.set(header, 0);
    expect((await h.receiver.chunk(SERVER, chunkOf(file, 0))).offset).toBe(2 * CHUNK);
    expect(fs.readFileSync(partFile(h)).subarray(0, CHUNK).equals(header)).toBe(true);

    // Data that is not `size` bytes of base64: a gap at the stored offset.
    expect(await h.receiver.chunk(SERVER, { demo_id: DEMO, offset: 2 * CHUNK, size: 12, data: 'not base64!!' })).toMatchObject({
      offset: 2 * CHUNK,
      error: { code: 'gap' },
    });
    expect(await h.receiver.chunk(SERVER, { demo_id: DEMO, offset: 2 * CHUNK, size: 5, data: 'AAAA' })).toMatchObject({
      offset: 2 * CHUNK,
      error: { code: 'gap' },
    });

    await sendFrom(h.receiver, file, 2 * CHUNK);
    // End before everything arrived is answered with the offset (here: all there).
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: file.length + 10, sha256: sha(file) })).toEqual({
      demo_id: DEMO,
      offset: file.length,
    });
    const done = await h.receiver.end(SERVER, { demo_id: DEMO, size: file.length, sha256: sha(file) });
    expect(done).toEqual({ demo_id: DEMO, offset: file.length, complete: true });
    expect(sha(fs.readFileSync(finalFile(h)))).toBe(sha(file));
    expect(fs.existsSync(partFile(h))).toBe(false);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0]).toMatchObject({
      state: 'complete',
      path: path.join('ko-r1-m3', 'map2', '2026-09-29_18-02-11_ko-r1-m3_de_mirage_Alpha_vs_Bravo.dem'),
      mapNumber: 1,
      size: file.length,
      sha256: sha(file),
    });

    // Repeated demo.end, a later begin, a stray chunk: complete, nothing new stored.
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: file.length, sha256: sha(file) })).toEqual(done);
    expect(await h.receiver.begin(SERVER, 3, begin({ recording: false }))).toEqual(done);
    expect(await h.receiver.chunk(SERVER, chunkOf(file, 0))).toEqual(done);
    expect(h.stored).toHaveLength(1);
  });

  test('demo.end truncates a longer copy to the final size', async () => {
    const h = harness();
    const file = demoBytes(2 * CHUNK);
    await h.receiver.begin(SERVER, 1, begin());
    await sendFrom(h.receiver, file, 0);
    // The final file is shorter than what was streamed (the last chunk shrank).
    const final = file.subarray(0, 2 * CHUNK - 300);
    const ack = await h.receiver.end(SERVER, { demo_id: DEMO, size: final.length, sha256: sha(final) });
    expect(ack).toEqual({ demo_id: DEMO, offset: final.length, complete: true });
    expect(fs.readFileSync(finalFile(h)).equals(final)).toBe(true);
  });

  test('checksum mismatch discards the copy; restart streams it again from 0', async () => {
    const h = harness();
    const file = demoBytes(2 * CHUNK + 7);
    await h.receiver.begin(SERVER, 1, begin());
    const corrupt = Buffer.from(file);
    corrupt[CHUNK + 1] ^= 0x5a;
    await sendFrom(h.receiver, corrupt, 0);
    const bad = await h.receiver.end(SERVER, { demo_id: DEMO, size: file.length, sha256: sha(file) });
    expect(bad).toMatchObject({ offset: 0, error: { code: 'checksum' } });
    expect(fs.statSync(partFile(h)).size).toBe(0);
    expect(h.rows.rows.get(DEMO)).toMatchObject({ receivedOffset: 0, checksumFailures: 1, state: 'receiving' });
    expect(h.stored).toHaveLength(0);

    // Ready Up: demo.begin {restart: true}, then everything from 0.
    expect(await h.receiver.begin(SERVER, 1, begin({ restart: true, recording: false }))).toEqual({ demo_id: DEMO, offset: 0 });
    await sendFrom(h.receiver, file, 0);
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: file.length, sha256: sha(file) })).toMatchObject({ complete: true });
    expect(sha(fs.readFileSync(finalFile(h)))).toBe(sha(file));
  });

  test('restart mid-stream drops the stored bytes; restart after complete replaces the verified file', async () => {
    const h = harness();
    const first = demoBytes(3 * CHUNK, 7);
    await h.receiver.begin(SERVER, 1, begin());
    await h.receiver.chunk(SERVER, chunkOf(first, 0));
    await h.receiver.chunk(SERVER, chunkOf(first, CHUNK));
    expect(await h.receiver.begin(SERVER, 1, begin({ restart: true }))).toEqual({ demo_id: DEMO, offset: 0 });
    expect(fs.statSync(partFile(h)).size).toBe(0);
    // A chunk past 0 now is a gap.
    expect(await h.receiver.chunk(SERVER, chunkOf(first, CHUNK))).toMatchObject({ offset: 0, error: { code: 'gap' } });
    await sendFrom(h.receiver, first, 0);
    await h.receiver.end(SERVER, { demo_id: DEMO, size: first.length, sha256: sha(first) });

    // The server's file was replaced after it was confirmed.
    const second = demoBytes(CHUNK + 1, 9);
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: second.length, sha256: sha(second) })).toMatchObject({
      offset: 0,
      error: { code: 'checksum' },
    });
    expect(sha(fs.readFileSync(finalFile(h)))).toBe(sha(first)); // still the verified one
    expect(await h.receiver.begin(SERVER, 1, begin({ restart: true }))).toEqual({ demo_id: DEMO, offset: 0 });
    await sendFrom(h.receiver, second, 0);
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: second.length, sha256: sha(second) })).toMatchObject({ complete: true });
    expect(sha(fs.readFileSync(finalFile(h)))).toBe(sha(second));
    expect(h.stored).toHaveLength(2);
  });

  test('resume: a new session (and a platform restart) continues from the stored offset', async () => {
    const h = harness();
    const file = demoBytes(5 * CHUNK + 1234, 3);
    await h.receiver.begin(SERVER, 2, begin());
    await h.receiver.chunk(SERVER, chunkOf(file, 0));
    await h.receiver.chunk(SERVER, chunkOf(file, CHUNK));
    // Reconnect: demo.begin again (idempotent), resume at 2 chunks.
    expect(await h.receiver.begin(SERVER, 2, begin())).toEqual({ demo_id: DEMO, offset: 2 * CHUNK });
    await h.receiver.chunk(SERVER, chunkOf(file, 2 * CHUNK));
    // Platform restart: a new receiver over the same rows and files.
    const r2 = h.restart();
    expect(await r2.begin(SERVER, 2, begin())).toEqual({ demo_id: DEMO, offset: 3 * CHUNK });
    // The disk lost the tail (row says 3 chunks, file has 2.5): resume from the disk.
    fs.truncateSync(partFile(h), 2 * CHUNK + 100);
    expect(await r2.begin(SERVER, 2, begin())).toEqual({ demo_id: DEMO, offset: 2 * CHUNK + 100 });
    await r2.chunk(SERVER, chunkOf(file, 2 * CHUNK)); // re-sent from its chunk boundary
    await sendFrom(r2, file, 3 * CHUNK);
    expect(await r2.end(SERVER, { demo_id: DEMO, size: file.length, sha256: sha(file) })).toMatchObject({ complete: true });
    expect(sha(fs.readFileSync(finalFile(h)))).toBe(sha(file));

    // A part file that vanished entirely: back to 0.
    const other = harness();
    await other.receiver.begin(SERVER, 1, begin());
    await other.receiver.chunk(SERVER, chunkOf(file, 0));
    fs.rmSync(partFile(other));
    expect(await other.receiver.begin(SERVER, 1, begin())).toEqual({ demo_id: DEMO, offset: 0 });
    fs.rmSync(partFile(other));
    expect(await other.receiver.chunk(SERVER, chunkOf(file, 0))).toMatchObject({ offset: 0, error: { code: 'gap' } });
    expect(await other.receiver.chunk(SERVER, chunkOf(file, 0))).toEqual({ demo_id: DEMO, offset: CHUNK });
  });

  test('messages of one demo are serialized', async () => {
    const h = harness();
    const file = demoBytes(6 * CHUNK, 5);
    await h.receiver.begin(SERVER, 1, begin());
    // Fired together (two sessions overlapping): applied in order, every one lands.
    const acks = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => h.receiver.chunk(SERVER, chunkOf(file, i * CHUNK))));
    expect(acks.map((a) => a.offset)).toEqual([1, 2, 3, 4, 5, 6].map((i) => i * CHUNK));
    expect(fs.readFileSync(partFile(h)).equals(file)).toBe(true);
  });

  test('guards: unknown_demo, not_assigned, stale_epoch, another server, too_large, storage', async () => {
    const h = harness(3 * CHUNK);
    const file = demoBytes(4 * CHUNK);
    expect(await h.receiver.chunk(SERVER, chunkOf(file, 0))).toMatchObject({ offset: 0, error: { code: 'unknown_demo' } });
    expect(await h.receiver.end(SERVER, { demo_id: DEMO, size: 1, sha256: sha(file) })).toMatchObject({
      offset: 0,
      error: { code: 'unknown_demo' },
    });

    h.assignment = 'not_assigned';
    expect(await h.receiver.begin(SERVER, 1, begin())).toMatchObject({ offset: 0, error: { code: 'not_assigned' } });
    h.assignment = 'stale_epoch';
    expect(await h.receiver.begin(SERVER, 9, begin())).toMatchObject({ offset: 0, error: { code: 'stale_epoch' } });
    expect(h.rows.rows.size).toBe(0);
    expect(fs.existsSync(partFile(h))).toBe(false);

    h.assignment = 'ok';
    await h.receiver.begin(SERVER, 1, begin());
    // Another server claiming the demo.
    expect(await h.receiver.begin('s_other', 1, begin())).toMatchObject({ error: { code: 'not_assigned' } });
    expect(await h.receiver.chunk('s_other', chunkOf(file, 0))).toMatchObject({ error: { code: 'unknown_demo' } });

    // Over the size cap: refused for good, the part file goes.
    await sendFrom(h.receiver, file.subarray(0, 3 * CHUNK), 0);
    const big = await h.receiver.chunk(SERVER, chunkOf(file, 3 * CHUNK));
    expect(big).toMatchObject({ offset: 3 * CHUNK, error: { code: 'too_large' } });
    expect(fs.existsSync(partFile(h))).toBe(false);
    expect(h.refused.map((r) => r.code)).toEqual(['too_large']);
    expect(await h.receiver.begin(SERVER, 1, begin())).toMatchObject({ error: { code: 'too_large' } });
    expect(await h.receiver.chunk(SERVER, chunkOf(file, 0))).toMatchObject({ error: { code: 'too_large' } });

    // demo.end announcing more than the cap.
    const h2 = harness(3 * CHUNK);
    await h2.receiver.begin(SERVER, 1, begin());
    expect(await h2.receiver.end(SERVER, { demo_id: DEMO, size: 4 * CHUNK, sha256: sha(file) })).toMatchObject({
      error: { code: 'too_large' },
    });

    // Storage: the database fails, the disk fails.
    const h3 = harness();
    h3.rows.failNext = true;
    expect(await h3.receiver.begin(SERVER, 1, begin())).toMatchObject({ offset: 0, error: { code: 'storage' } });
    await h3.receiver.begin(SERVER, 1, begin());
    h3.rows.failNext = true;
    expect(await h3.receiver.chunk(SERVER, chunkOf(file, 0))).toMatchObject({ error: { code: 'storage' } });
    // The dir for final files is a file: moving the verified demo fails.
    const small = file.subarray(0, 100);
    await h3.receiver.chunk(SERVER, chunkOf(small, 0, 100));
    fs.writeFileSync(path.join(h3.dir, 'ko-r1-m3'), 'not a directory');
    expect(await h3.receiver.end(SERVER, { demo_id: DEMO, size: 100, sha256: sha(small) })).toMatchObject({
      offset: 100,
      error: { code: 'storage' },
    });
    fs.rmSync(path.join(h3.dir, 'ko-r1-m3'));
    expect(await h3.receiver.end(SERVER, { demo_id: DEMO, size: 100, sha256: sha(small) })).toMatchObject({ complete: true });
  });

  test('expiry: abandoned unfinished streams go with their part files; complete ones stay', async () => {
    const h = harness();
    const file = demoBytes(2 * CHUNK);
    await h.receiver.begin(SERVER, 1, begin());
    await h.receiver.chunk(SERVER, chunkOf(file, 0));
    const doneId = '01J8ZQ4T8W6N3X0F2R5K7M9D02';
    await h.receiver.begin(SERVER, 1, { ...begin(), demo_id: doneId, map_number: 1 });
    await h.receiver.chunk(SERVER, { ...chunkOf(file, 0, 100), demo_id: doneId });
    await h.receiver.end(SERVER, { demo_id: doneId, size: 100, sha256: sha(file.subarray(0, 100)) });
    const orphan = path.join(h.dir, INCOMING_DIR_NAME, '01J8ZQ4T8W6N3X0F2R5K7M9D03.part');
    fs.writeFileSync(orphan, 'left over');
    const old = new Date(h.clock.now - 30 * 86_400_000);
    fs.utimesSync(orphan, old, old);

    // Not idle long enough yet.
    h.clock.now += 6 * 86_400_000;
    expect(await h.receiver.expire(7)).toBe(0);
    expect(fs.existsSync(partFile(h))).toBe(true);

    h.clock.now += 2 * 86_400_000;
    expect(await h.receiver.expire(7)).toBe(1);
    expect(h.rows.rows.has(DEMO)).toBe(false);
    expect(fs.existsSync(partFile(h))).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(h.rows.rows.get(doneId)?.state).toBe('complete');
    // An expired demo announced again starts over.
    expect(await h.receiver.begin(SERVER, 1, begin())).toEqual({ demo_id: DEMO, offset: 0 });
  });

  test('pacer: acks follow the demo rate; small frames cost a floor', () => {
    let now = 0;
    const perMinute = 60 * 1024 * 1024; // 1 MiB/s
    const pacer = new DemoPacer(perMinute, () => now);
    // The burst (2 MiB) goes through at once.
    expect(pacer.reserve('a', 1024 * 1024)).toBe(0);
    expect(pacer.reserve('a', 1024 * 1024)).toBe(0);
    // Then 1 MiB costs a second.
    expect(pacer.reserve('a', 1024 * 1024)).toBe(1000);
    // Other servers have their own bucket.
    expect(pacer.reserve('b', 1024 * 1024)).toBe(0);
    now += 5000;
    expect(pacer.reserve('a', 512 * 1024)).toBe(0);
    // 4 KiB frames still cost 1/25 s each once the bucket is empty.
    const tiny = new DemoPacer(perMinute, () => now);
    let waits = 0;
    for (let i = 0; i < 100; i++) waits = tiny.reserve('c', 4096);
    expect(waits).toBeGreaterThan(0);
    expect(waits).toBeLessThanOrEqual(4000);
  });

  test('socket budget: 8 MiB/min, raised for demo.stream.v1', () => {
    expect(socketBytesPerMinute(['match.v1'])).toBe(FLEET_LIMIT_DEFAULTS.bytesPerMinute);
    expect(socketBytesPerMinute(undefined)).toBe(FLEET_LIMIT_DEFAULTS.bytesPerMinute);
    const raised = socketBytesPerMinute(['match.v1', DEMO_STREAM_CAPABILITY]);
    expect(raised).toBeGreaterThan(FLEET_LIMIT_DEFAULTS.bytesPerMinute + FLEET_LIMIT_DEFAULTS.demoBytesPerMinute);
    expect(
      socketBytesPerMinute([DEMO_STREAM_CAPABILITY], {
        ...FLEET_LIMIT_DEFAULTS,
        bytesPerMinute: 1024,
        demoBytesPerMinute: 2048,
      })
    ).toBe(1024 + 2048 + 4 * 1024 * 1024);
  });
});
