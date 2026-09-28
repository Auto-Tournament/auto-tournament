/**
 * The platform end of Ready Up's demo stream (FLEET.md §12.2, §12.4; schemas
 * `protocol/v1/messages/demo.*.json`). A Ready Up server streams the GOTV
 * demo over the fleet link while it records; this module stores it where
 * HTTP-uploaded demos go and attaches it to the match the same way.
 *
 * - `demo.begin` (announce / resume): a new demo_id is checked against the
 *   assignments the server holds or held (`not_assigned` / `stale_epoch`),
 *   gets a row in `cs2_fleet_demo_streams` and an empty part file
 *   (`DATA_DIR/demos/.incoming/<demo_id>.part`). The answer is
 *   `demo.ack {offset}` = the bytes stored contiguously from 0, or
 *   `complete: true` for a demo already verified. `restart: true` drops what
 *   was stored.
 * - `demo.chunk {offset, size, data}`: `offset > stored` → `gap` (nothing
 *   written); else written at `offset` (below `stored` overwrites: CS2
 *   rewrites the header when the recording stops), synced to disk, then
 *   `stored = max(stored, offset + size)` in the row, then the ack.
 * - `demo.end {size, sha256}`: `stored < size` → `{offset: stored}`; else the
 *   part file is cut to `size` and hashed. A match moves it to
 *   `demos/<match>/map<N>/<file>` (N 1-based, as the server names it),
 *   points `matches` / `match_map_results` at it (utils/demoFiles.ts
 *   `linkStoredDemo`, like an upload), reports the upload finished to the
 *   turnover tracker and answers `complete: true` (again for a repeated
 *   demo.end). A mismatch discards the copy: `{offset: 0, error: checksum}`.
 * - `too_large`: a chunk or a demo.end past `FLEET_DEMO_MAX_BYTES` (2 GiB);
 *   the stream is refused for good (the server keeps its file). `storage`:
 *   the disk or the database failed; the server announces again later.
 * - Unfinished streams (and part files nobody owns) idle for
 *   `FLEET_DEMO_STREAM_EXPIRE_DAYS` (7) are deleted, hourly.
 *
 * Every message of one demo runs under a per-demo lock, so a reconnect whose
 * new session overlaps the old one's last chunk cannot interleave. The gateway
 * runs all three types on the session's low-priority chain; the chunk
 * handler paces its acks to `FLEET_DEMO_BYTES_PER_MINUTE` (Ready Up keeps at
 * most 1 MiB unacknowledged, so that is its rate), which keeps the socket
 * within the byte budget ./limits.ts gives a `demo.stream.v1` server.
 *
 * `DemoStreamReceiver` holds the rules and takes its storage (rows, a
 * directory) and the platform lookups as parameters, so unit tests run it on
 * a temp dir and in-memory rows; `startDemoStreams` wires it to Postgres,
 * `DEMOS_DIR` and the gateway.
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { DEMOS_DIR, ensureDemosDir, linkStoredDemo } from '../utils/demoFiles';
import { serverTurnoverTracker } from '../utils/serverTurnover';
import { registerInboundHandler, type InboundContext } from './inbound';
import { fleetLimits } from './limits';
import { toFleetMapNumber, toPlatformMapNumber } from './normalize';
import type {
  DemoAckErrorCode,
  DemoAckPayload,
  DemoBeginPayload,
  DemoChunkPayload,
  DemoEndPayload,
  Envelope,
} from './protocol/v1';

/** Part files, under the demos dir. Dot-named so no match slug can collide with it. */
export const INCOMING_DIR_NAME = '.incoming';

export type DemoStreamState = 'receiving' | 'complete' | 'rejected';

export interface DemoStreamRow {
  demoId: string;
  serverId: string;
  matchSlug: string;
  /** Platform map number (0-based). */
  mapNumber: number;
  epoch: number | null;
  file: string;
  chunkSize: number;
  recording: boolean;
  /** Relative to the demos dir. */
  partPath: string;
  /** Relative to the demos dir; set once verified. */
  path: string | null;
  receivedOffset: number;
  size: number | null;
  sha256: string | null;
  state: DemoStreamState;
  error: string | null;
  checksumFailures: number;
  /** Unix ms. */
  startedAt: number | null;
  /** Unix s. */
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** Where the rows live: Postgres in the API, memory in the unit tests. */
export interface DemoStreamPersistence {
  get(demoId: string): Promise<DemoStreamRow | null>;
  insert(row: DemoStreamRow): Promise<void>;
  update(demoId: string, patch: Partial<DemoStreamRow>): Promise<void>;
  delete(demoId: string): Promise<void>;
  /** Unfinished rows (receiving / rejected) not updated since `before` (unix s). */
  listStale(before: number): Promise<DemoStreamRow[]>;
  /** Every part path a row still owns. */
  partPaths(): Promise<Set<string>>;
}

export type AssignmentCheck = 'ok' | 'not_assigned' | 'stale_epoch';

/** What the receiver needs from the rest of the platform. */
export interface DemoStreamPlatform {
  /** Does `serverId` hold, or did it hold, `matchSlug` (at `epoch`, when given)? */
  checkAssignment(serverId: string, matchSlug: string, epoch: number | undefined): Promise<AssignmentCheck>;
  /** A demo was verified and moved into place. Failures are logged, never undo the ack. */
  stored(row: DemoStreamRow): Promise<void>;
  /** A demo was refused for good (too_large): nothing will arrive for that map. */
  refused(row: DemoStreamRow, code: DemoAckErrorCode): Promise<void>;
}

export interface DemoStreamOptions {
  dir: string;
  persistence: DemoStreamPersistence;
  platform: DemoStreamPlatform;
  maxBytes: number;
  now?: () => number;
}

class DemoStorageError extends Error {}

function ack(demoId: string, offset: number, extra: Partial<DemoAckPayload> = {}): DemoAckPayload {
  return { demo_id: demoId, offset, ...extra };
}

function fail(demoId: string, offset: number, code: DemoAckErrorCode, message?: string): DemoAckPayload {
  return ack(demoId, offset, { error: { code, ...(message ? { message: message.slice(0, 500) } : {}) } });
}

/** Standard base64 (RFC 4648 §4) with padding, strictly: Buffer.from would skip junk silently. */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeChunkData(data: string): Buffer | null {
  if (!BASE64_RE.test(data)) return null;
  return Buffer.from(data, 'base64');
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class DemoStreamReceiver {
  private readonly dir: string;
  private readonly rows: DemoStreamPersistence;
  private readonly platform: DemoStreamPlatform;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: DemoStreamOptions) {
    this.dir = path.resolve(options.dir);
    this.rows = options.persistence;
    this.platform = options.platform;
    this.maxBytes = options.maxBytes;
    this.now = options.now ?? (() => Date.now());
  }

  private nowS(): number {
    return Math.floor(this.now() / 1000);
  }

  /** Absolute path of a path relative to the demos dir; refuses anything outside it. */
  private abs(relative: string): string {
    const full = path.resolve(this.dir, relative);
    if (full !== this.dir && !full.startsWith(this.dir + path.sep)) {
      throw new DemoStorageError(`path escapes the demos dir: ${relative}`);
    }
    return full;
  }

  static partPathOf(demoId: string): string {
    return path.join(INCOMING_DIR_NAME, `${demoId}.part`);
  }

  /** demos/<match>/map<N>/<file>, N as the server numbers maps (1-based). */
  static finalPathOf(row: Pick<DemoStreamRow, 'matchSlug' | 'mapNumber' | 'file'>): string {
    return path.join(row.matchSlug, `map${toFleetMapNumber(row.mapNumber)}`, path.basename(row.file));
  }

  /** Run `fn` with the demo's lock held (messages of one demo never interleave). */
  private locked<T>(demoId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(demoId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(demoId, tail);
    void tail.then(() => {
      if (this.locks.get(demoId) === tail) this.locks.delete(demoId);
    });
    return run;
  }

  private async withStorage(demoId: string, offset: number, fn: () => Promise<DemoAckPayload>): Promise<DemoAckPayload> {
    try {
      return await fn();
    } catch (error) {
      log.error(`[FLEET] demo ${demoId}: storage failed: ${(error as Error).message}`);
      return fail(demoId, offset, 'storage', 'the platform could not store the demo; try again later');
    }
  }

  /** Create (or empty) the part file. */
  private async resetPart(row: Pick<DemoStreamRow, 'partPath'>): Promise<void> {
    const file = this.abs(row.partPath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, Buffer.alloc(0));
  }

  /** Bytes of the part file, or null when it is gone. */
  private async partSize(row: Pick<DemoStreamRow, 'partPath'>): Promise<number | null> {
    try {
      return (await fs.promises.stat(this.abs(row.partPath))).size;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async deletePart(row: Pick<DemoStreamRow, 'partPath'>): Promise<void> {
    await fs.promises.rm(this.abs(row.partPath), { force: true });
  }

  private refusal(row: DemoStreamRow): DemoAckPayload {
    const code = (row.error as DemoAckErrorCode | null) ?? 'too_large';
    return fail(row.demoId, row.receivedOffset, code, `demo refused (${code})`);
  }

  private completeAck(row: DemoStreamRow): DemoAckPayload {
    return ack(row.demoId, row.size ?? row.receivedOffset, { complete: true });
  }

  private async refuseTooLarge(row: DemoStreamRow, bytes: number): Promise<DemoAckPayload> {
    await this.deletePart(row).catch(() => undefined);
    await this.rows.update(row.demoId, { state: 'rejected', error: 'too_large', updatedAt: this.nowS() });
    const refused = { ...row, state: 'rejected' as const, error: 'too_large' };
    log.warn(
      `[FLEET] ${row.serverId}: demo ${row.demoId} (${row.matchSlug} map ${toFleetMapNumber(row.mapNumber)}) is over ${this.maxBytes} bytes (${bytes}); refused`
    );
    await this.platform.refused(refused, 'too_large').catch((error) => {
      log.warn(`[FLEET] demo ${row.demoId}: refused hook failed: ${(error as Error).message}`);
    });
    return fail(row.demoId, row.receivedOffset, 'too_large', `demos are limited to ${this.maxBytes} bytes`);
  }

  // --- demo.begin ------------------------------------------------------------

  begin(serverId: string, epoch: number | undefined, p: DemoBeginPayload): Promise<DemoAckPayload> {
    return this.locked(p.demo_id, () => this.withStorage(p.demo_id, 0, () => this.beginLocked(serverId, epoch, p)));
  }

  private async beginLocked(serverId: string, epoch: number | undefined, p: DemoBeginPayload): Promise<DemoAckPayload> {
    const now = this.nowS();
    const row = await this.rows.get(p.demo_id);

    if (!row) {
      const check = await this.platform.checkAssignment(serverId, p.match_id, epoch);
      if (check !== 'ok') {
        log.warn(
          `[FLEET] ${serverId}: demo ${p.demo_id} for ${p.match_id} (epoch ${epoch ?? '-'}) refused: ${check}`
        );
        return fail(
          p.demo_id,
          0,
          check,
          check === 'not_assigned'
            ? `this server never held match ${p.match_id}`
            : `this server never held epoch ${epoch} of match ${p.match_id}`
        );
      }
      const fresh: DemoStreamRow = {
        demoId: p.demo_id,
        serverId,
        matchSlug: p.match_id,
        mapNumber: toPlatformMapNumber(p.map_number),
        epoch: epoch ?? null,
        file: path.basename(p.file),
        chunkSize: p.chunk_size,
        recording: p.recording,
        partPath: DemoStreamReceiver.partPathOf(p.demo_id),
        path: null,
        receivedOffset: 0,
        size: null,
        sha256: null,
        state: 'receiving',
        error: null,
        checksumFailures: 0,
        startedAt: p.started_at,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      await this.resetPart(fresh);
      await this.rows.insert(fresh);
      log.info(
        `[FLEET] ${serverId}: demo ${p.demo_id} started (${p.match_id} map ${p.map_number}, ${fresh.file})`
      );
      return ack(p.demo_id, 0);
    }

    if (row.serverId !== serverId) {
      log.warn(`[FLEET] ${serverId}: demo.begin for ${p.demo_id}, which ${row.serverId} streams; refused`);
      return fail(p.demo_id, 0, 'not_assigned', 'another server streams this demo');
    }

    if (p.restart) {
      // Drop what was stored (the server's file was replaced, or our copy
      // failed the check). A verified copy stays in place until the new one
      // replaces it.
      await this.resetPart(row);
      await this.rows.update(row.demoId, {
        state: 'receiving',
        error: null,
        receivedOffset: 0,
        size: null,
        sha256: null,
        recording: p.recording,
        chunkSize: p.chunk_size,
        updatedAt: now,
      });
      log.info(`[FLEET] ${serverId}: demo ${p.demo_id} restarted from 0`);
      return ack(p.demo_id, 0);
    }

    if (row.state === 'complete') return this.completeAck(row);
    if (row.state === 'rejected') return this.refusal(row);

    // Resume. The part file is the truth for what survived: a lost file (or
    // a shorter one) moves the offset back.
    let offset = row.receivedOffset;
    const onDisk = await this.partSize(row);
    if (onDisk === null) {
      await this.resetPart(row);
      offset = 0;
    } else if (onDisk < offset) {
      offset = onDisk;
    }
    await this.rows.update(row.demoId, {
      receivedOffset: offset,
      recording: p.recording,
      chunkSize: p.chunk_size,
      updatedAt: now,
    });
    return ack(p.demo_id, offset);
  }

  // --- demo.chunk ------------------------------------------------------------

  chunk(serverId: string, p: DemoChunkPayload): Promise<DemoAckPayload> {
    return this.locked(p.demo_id, async () => {
      const row = await this.rows.get(p.demo_id).catch(() => undefined);
      if (row === undefined) return fail(p.demo_id, 0, 'storage', 'the platform could not read the demo');
      return this.withStorage(p.demo_id, row?.receivedOffset ?? 0, () => this.chunkLocked(serverId, row, p));
    });
  }

  private async chunkLocked(serverId: string, row: DemoStreamRow | null, p: DemoChunkPayload): Promise<DemoAckPayload> {
    if (!row || row.serverId !== serverId) return fail(p.demo_id, 0, 'unknown_demo');
    if (row.state === 'complete') return this.completeAck(row);
    if (row.state === 'rejected') return this.refusal(row);

    const stored = row.receivedOffset;
    if (p.offset > stored) {
      return fail(p.demo_id, stored, 'gap', `chunk at ${p.offset}, stored ${stored}`);
    }
    const bytes = decodeChunkData(p.data);
    if (!bytes || bytes.length !== p.size) {
      // Not what the server meant to send; it continues from `stored`.
      return fail(p.demo_id, stored, 'gap', `chunk at ${p.offset}: data is not ${p.size} bytes of base64`);
    }
    if (p.offset + p.size > this.maxBytes) return this.refuseTooLarge(row, p.offset + p.size);

    const file = this.abs(row.partPath);
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, 'r+');
    } catch (error) {
      if (!isMissing(error)) throw error;
      // The part file is gone (disk cleaned up under us): start over at 0.
      await this.resetPart(row);
      await this.rows.update(row.demoId, { receivedOffset: 0, updatedAt: this.nowS() });
      return fail(p.demo_id, 0, 'gap', 'the stored bytes were lost; continue from 0');
    }
    try {
      await handle.write(bytes, 0, bytes.length, p.offset);
      await handle.datasync();
    } finally {
      await handle.close();
    }
    const next = Math.max(stored, p.offset + p.size);
    await this.rows.update(row.demoId, { receivedOffset: next, updatedAt: this.nowS() });
    return ack(p.demo_id, next);
  }

  // --- demo.end --------------------------------------------------------------

  end(serverId: string, p: DemoEndPayload): Promise<DemoAckPayload> {
    return this.locked(p.demo_id, async () => {
      const row = await this.rows.get(p.demo_id).catch(() => undefined);
      if (row === undefined) return fail(p.demo_id, 0, 'storage', 'the platform could not read the demo');
      return this.withStorage(p.demo_id, row?.receivedOffset ?? 0, () => this.endLocked(serverId, row, p));
    });
  }

  private async endLocked(serverId: string, row: DemoStreamRow | null, p: DemoEndPayload): Promise<DemoAckPayload> {
    if (!row || row.serverId !== serverId) return fail(p.demo_id, 0, 'unknown_demo');
    if (row.state === 'complete') {
      if (row.size === p.size && row.sha256 === p.sha256) return this.completeAck(row);
      // A different final file than the one verified: the server restarts
      // (demo.begin restart), which replaces ours.
      return fail(p.demo_id, 0, 'checksum', 'a different file was already stored for this demo');
    }
    if (row.state === 'rejected') return this.refusal(row);
    if (p.size > this.maxBytes) return this.refuseTooLarge(row, p.size);

    const stored = row.receivedOffset;
    if (stored < p.size) return ack(p.demo_id, stored);

    const part = this.abs(row.partPath);
    const onDisk = await this.partSize(row);
    if (onDisk === null || onDisk < p.size) {
      // The row said more than the disk has: resume from what is there.
      const offset = onDisk ?? 0;
      if (onDisk === null) await this.resetPart(row);
      await this.rows.update(row.demoId, { receivedOffset: offset, updatedAt: this.nowS() });
      return ack(p.demo_id, offset);
    }
    await fs.promises.truncate(part, p.size);
    const actual = await sha256OfFile(part);
    if (actual !== p.sha256) {
      await this.resetPart(row);
      await this.rows.update(row.demoId, {
        receivedOffset: 0,
        checksumFailures: row.checksumFailures + 1,
        updatedAt: this.nowS(),
      });
      log.warn(
        `[FLEET] ${serverId}: demo ${p.demo_id} failed its sha256 check (${actual} != ${p.sha256}); discarded, the server starts over`
      );
      return fail(p.demo_id, 0, 'checksum', 'the stored copy did not match; send it again from 0');
    }

    const finalPath = DemoStreamReceiver.finalPathOf(row);
    const target = this.abs(finalPath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.rename(part, target);
    const now = this.nowS();
    const done: DemoStreamRow = {
      ...row,
      state: 'complete',
      error: null,
      path: finalPath,
      receivedOffset: p.size,
      size: p.size,
      sha256: p.sha256,
      recording: false,
      updatedAt: now,
      completedAt: now,
    };
    await this.rows.update(row.demoId, {
      state: done.state,
      error: null,
      path: done.path,
      receivedOffset: done.receivedOffset,
      size: done.size,
      sha256: done.sha256,
      recording: false,
      updatedAt: now,
      completedAt: now,
    });
    log.success(
      `[FLEET] ${serverId}: demo ${p.demo_id} stored (${row.matchSlug} map ${toFleetMapNumber(row.mapNumber)}, ${p.size} bytes, ${finalPath})`
    );
    await this.platform.stored(done).catch((error) => {
      log.warn(`[FLEET] demo ${p.demo_id}: linking it to the match failed: ${(error as Error).message}`);
    });
    return this.completeAck(done);
  }

  // --- cleanup ---------------------------------------------------------------

  /**
   * Drop unfinished streams not touched for `days` (their part files too), and
   * part files no row owns that are that old. Returns how many rows went.
   */
  async expire(days: number): Promise<number> {
    const cutoff = this.nowS() - Math.floor(days * 86_400);
    const stale = await this.rows.listStale(cutoff);
    for (const row of stale) {
      await this.locked(row.demoId, async () => {
        const current = await this.rows.get(row.demoId);
        if (!current || current.state === 'complete' || current.updatedAt >= cutoff) return;
        await this.deletePart(current).catch(() => undefined);
        await this.rows.delete(current.demoId);
        log.info(
          `[FLEET] demo ${current.demoId} (${current.matchSlug} map ${toFleetMapNumber(current.mapNumber)}) expired unfinished at ${current.receivedOffset} bytes`
        );
      });
    }
    // Part files without a row (a crash between the file and the row).
    const incoming = path.join(this.dir, INCOMING_DIR_NAME);
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(incoming);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (names.length) {
      const owned = await this.rows.partPaths();
      for (const name of names) {
        const rel = path.join(INCOMING_DIR_NAME, name);
        if (owned.has(rel)) continue;
        const stat = await fs.promises.stat(path.join(incoming, name)).catch(() => null);
        if (stat && Math.floor(stat.mtimeMs / 1000) < cutoff) {
          await fs.promises.rm(path.join(incoming, name), { force: true }).catch(() => undefined);
        }
      }
    }
    return stale.length;
  }
}

// ---------------------------------------------------------------------------
// Pacing: demo.ack at the demo rate
// ---------------------------------------------------------------------------

/**
 * A token bucket per server over the frame bytes of demo chunks. `take`
 * resolves when the bytes fit; the ack is sent after it, so the server's
 * window (at most 1 MiB unacknowledged) turns this into its sending rate.
 * Each frame costs at least 1/25 s of the rate, so small chunks cannot run
 * the socket over its 50 messages/s either.
 */
export class DemoPacer {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly perMs: number;
  private readonly burst: number;
  private readonly minCost: number;

  constructor(bytesPerMinute: number, private readonly now: () => number = () => Date.now()) {
    this.perMs = bytesPerMinute / 60_000;
    this.burst = Math.max(2 * 1024 * 1024, bytesPerMinute / 30);
    this.minCost = (bytesPerMinute / 60) / 25;
  }

  /** Milliseconds to wait before `bytes` more may be acked for `serverId` (and books them). */
  reserve(serverId: string, bytes: number): number {
    const now = this.now();
    const b = this.buckets.get(serverId) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.perMs);
    b.at = now;
    b.tokens -= Math.max(bytes, this.minCost);
    this.buckets.set(serverId, b);
    return b.tokens >= 0 ? 0 : Math.ceil(-b.tokens / this.perMs);
  }

  async take(serverId: string, bytes: number): Promise<void> {
    const wait = this.reserve(serverId, bytes);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  forget(serverId: string): void {
    this.buckets.delete(serverId);
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface FleetDemoNotice {
  kind: 'stored' | 'refused';
  serverId: string;
  demoId: string;
  matchSlug: string;
  /** Platform map number (0-based). */
  mapNumber: number;
  /** Relative to DATA_DIR/demos (stored). */
  path: string | null;
  size: number | null;
  sha256: string | null;
  error: DemoAckErrorCode | null;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

/** Every demo stored (verified, linked to its match) or refused for good. Returns the unsubscribe. */
export function onFleetDemo(listener: (notice: FleetDemoNotice) => void): () => void {
  emitter.on('demo', listener);
  return () => emitter.off('demo', listener);
}

function notify(row: DemoStreamRow, kind: FleetDemoNotice['kind'], error: DemoAckErrorCode | null): void {
  const notice: FleetDemoNotice = {
    kind,
    serverId: row.serverId,
    demoId: row.demoId,
    matchSlug: row.matchSlug,
    mapNumber: row.mapNumber,
    path: row.path,
    size: row.size,
    sha256: row.sha256,
    error,
  };
  for (const listener of emitter.listeners('demo') as Array<(n: FleetDemoNotice) => void>) {
    try {
      listener(notice);
    } catch (e) {
      log.warn(`[FLEET] demo listener failed: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Postgres + the platform
// ---------------------------------------------------------------------------

interface DbRow {
  demo_id: string;
  server_id: string;
  match_slug: string;
  map_number: number;
  epoch: number | null;
  file: string;
  chunk_size: number;
  recording: number;
  part_path: string;
  path: string | null;
  received_offset: string | number;
  size: string | number | null;
  sha256: string | null;
  state: DemoStreamState;
  error: string | null;
  checksum_failures: number;
  started_at: string | number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: string | number | null): number | null => (v === null ? null : num(v));

function fromDb(r: DbRow): DemoStreamRow {
  return {
    demoId: r.demo_id,
    serverId: r.server_id,
    matchSlug: r.match_slug,
    mapNumber: num(r.map_number),
    epoch: r.epoch === null ? null : num(r.epoch),
    file: r.file,
    chunkSize: num(r.chunk_size),
    recording: num(r.recording) === 1,
    partPath: r.part_path,
    path: r.path,
    receivedOffset: num(r.received_offset),
    size: numOrNull(r.size),
    sha256: r.sha256,
    state: r.state,
    error: r.error,
    checksumFailures: num(r.checksum_failures),
    startedAt: numOrNull(r.started_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    completedAt: r.completed_at === null ? null : num(r.completed_at),
  };
}

const COLUMN: Record<keyof DemoStreamRow, string> = {
  demoId: 'demo_id',
  serverId: 'server_id',
  matchSlug: 'match_slug',
  mapNumber: 'map_number',
  epoch: 'epoch',
  file: 'file',
  chunkSize: 'chunk_size',
  recording: 'recording',
  partPath: 'part_path',
  path: 'path',
  receivedOffset: 'received_offset',
  size: 'size',
  sha256: 'sha256',
  state: 'state',
  error: 'error',
  checksumFailures: 'checksum_failures',
  startedAt: 'started_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  completedAt: 'completed_at',
};

function toDbValue(key: keyof DemoStreamRow, value: unknown): unknown {
  if (key === 'recording') return value ? 1 : 0;
  return value;
}

export const pgDemoStreamPersistence: DemoStreamPersistence = {
  async get(demoId) {
    const row = await db.queryOneAsync<DbRow>('SELECT * FROM cs2_fleet_demo_streams WHERE demo_id = ?', [demoId]);
    return row ? fromDb(row) : null;
  },
  async insert(row) {
    const keys = Object.keys(COLUMN) as Array<keyof DemoStreamRow>;
    await db.runAsync(
      `INSERT INTO cs2_fleet_demo_streams (${keys.map((k) => COLUMN[k]).join(', ')})
       VALUES (${keys.map(() => '?').join(', ')})
       ON CONFLICT (demo_id) DO NOTHING`,
      keys.map((k) => toDbValue(k, row[k]))
    );
  },
  async update(demoId, patch) {
    const keys = (Object.keys(patch) as Array<keyof DemoStreamRow>).filter((k) => k !== 'demoId');
    if (!keys.length) return;
    await db.runAsync(
      `UPDATE cs2_fleet_demo_streams SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(', ')} WHERE demo_id = ?`,
      [...keys.map((k) => toDbValue(k, patch[k])), demoId]
    );
  },
  async delete(demoId) {
    await db.runAsync('DELETE FROM cs2_fleet_demo_streams WHERE demo_id = ?', [demoId]);
  },
  async listStale(before) {
    const rows = await db.queryAsync<DbRow>(
      `SELECT * FROM cs2_fleet_demo_streams WHERE state <> 'complete' AND updated_at < ? ORDER BY updated_at ASC LIMIT 1000`,
      [before]
    );
    return rows.map(fromDb);
  },
  async partPaths() {
    const rows = await db.queryAsync<{ part_path: string }>(
      `SELECT part_path FROM cs2_fleet_demo_streams WHERE state <> 'complete'`
    );
    return new Set(rows.map((r) => r.part_path));
  },
};

/**
 * Does `serverId` hold or did it hold `matchSlug` at `epoch`? The match must
 * exist; the server must be the current holder (cs2_match_live_state) or have
 * been sent a match.assign for it (cs2_fleet_commands). `not_assigned` when it
 * never held the match, `stale_epoch` when it held another epoch of it.
 */
export async function checkFleetAssignment(
  serverId: string,
  matchSlug: string,
  epoch: number | undefined
): Promise<AssignmentCheck> {
  const match = await db.queryOneAsync<{ id: number }>('SELECT id FROM matches WHERE slug = ?', [matchSlug]);
  if (!match) return 'not_assigned';
  const held = new Set<number>();
  const live = await db.queryOneAsync<{ server_id: string | null; epoch: number }>(
    'SELECT server_id, epoch FROM cs2_match_live_state WHERE match_slug = ?',
    [matchSlug]
  );
  if (live?.server_id === serverId) held.add(Number(live.epoch));
  const assigned = await db.queryAsync<{ epoch: number | null }>(
    `SELECT DISTINCT epoch FROM cs2_fleet_commands WHERE server_id = ? AND match_slug = ? AND type = 'match.assign'`,
    [serverId, matchSlug]
  );
  for (const row of assigned) if (row.epoch !== null) held.add(Number(row.epoch));
  if (held.size === 0) return 'not_assigned';
  if (epoch === undefined || held.has(epoch)) return 'ok';
  return 'stale_epoch';
}

/** The turnover tracker's view: the upload of that map is over (stored or refused). */
async function reportUploadEnded(row: DemoStreamRow): Promise<void> {
  const cs2 = await db.queryOneAsync<{ id: string }>('SELECT id FROM cs2_servers WHERE fleet_server_id = ?', [
    row.serverId,
  ]);
  const match = await db.queryOneAsync<{ id: number }>('SELECT id FROM matches WHERE slug = ?', [row.matchSlug]);
  if (!cs2 || !match) return;
  serverTurnoverTracker.recordEvent(
    cs2.id,
    { event: 'demo_upload_ended', matchid: match.id, map_number: row.mapNumber },
    Math.floor(Date.now() / 1000)
  );
}

export const platformDemoHooks: DemoStreamPlatform = {
  checkAssignment: checkFleetAssignment,
  async stored(row) {
    if (row.path) {
      const mapLinked = await linkStoredDemo(row.matchSlug, row.path, row.mapNumber, '[FLEET demo]');
      if (!mapLinked) {
        log.warn(
          `[FLEET] demo ${row.demoId}: ${row.matchSlug} has no result for map ${toFleetMapNumber(row.mapNumber)} yet; only the match points at it`
        );
      }
    }
    await reportUploadEnded(row);
    notify(row, 'stored', null);
  },
  async refused(row, code) {
    await reportUploadEnded(row);
    notify(row, 'refused', code);
  },
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const EXPIRE_INTERVAL_MS = 60 * 60 * 1000;

let receiver: DemoStreamReceiver | null = null;
let pacer: DemoPacer | null = null;
let unregister: Array<() => void> = [];
let expireTimer: NodeJS.Timeout | null = null;

export function demoStreamReceiver(): DemoStreamReceiver | null {
  return receiver;
}

function sendAck(ctx: InboundContext, env: Envelope, answer: DemoAckPayload): void {
  ctx.sendEphemeral('demo.ack', answer as unknown as Record<string, unknown>, { ref: env.id });
}

async function runExpiry(): Promise<void> {
  if (!receiver) return;
  const dropped = await receiver.expire(fleetLimits().demoStreamExpireDays);
  if (dropped) log.info(`[FLEET] dropped ${dropped} unfinished demo stream(s)`);
}

/** Register the demo.* handlers and the expiry job. Idempotent; call before the gateway starts. */
export function startDemoStreams(options: Partial<DemoStreamOptions> = {}): DemoStreamReceiver {
  if (receiver) return receiver;
  const limits = fleetLimits();
  const dir = options.dir ?? DEMOS_DIR;
  if (!options.dir) ensureDemosDir();
  receiver = new DemoStreamReceiver({
    dir,
    persistence: options.persistence ?? pgDemoStreamPersistence,
    platform: options.platform ?? platformDemoHooks,
    maxBytes: options.maxBytes ?? limits.demoMaxBytes,
    ...(options.now ? { now: options.now } : {}),
  });
  pacer = new DemoPacer(limits.demoBytesPerMinute);
  const r = receiver;
  const pace = pacer;

  unregister = [
    registerInboundHandler('demo.begin', {
      priority: 'low',
      async handle(ctx, env) {
        const answer = await r.begin(ctx.serverId, env.epoch, env.payload as unknown as DemoBeginPayload);
        sendAck(ctx, env, answer);
      },
    }),
    registerInboundHandler('demo.chunk', {
      priority: 'low',
      async handle(ctx, env) {
        const payload = env.payload as unknown as DemoChunkPayload;
        const answer = await r.chunk(ctx.serverId, payload);
        await pace.take(ctx.serverId, payload.data.length + 256);
        sendAck(ctx, env, answer);
      },
    }),
    registerInboundHandler('demo.end', {
      priority: 'low',
      async handle(ctx, env) {
        const answer = await r.end(ctx.serverId, env.payload as unknown as DemoEndPayload);
        sendAck(ctx, env, answer);
      },
    }),
  ];

  void runExpiry().catch((error) => log.warn(`[FLEET] demo stream expiry failed: ${(error as Error).message}`));
  expireTimer = setInterval(() => {
    void runExpiry().catch((error) => log.warn(`[FLEET] demo stream expiry failed: ${(error as Error).message}`));
  }, EXPIRE_INTERVAL_MS);
  expireTimer.unref?.();
  return receiver;
}

export function stopDemoStreams(): void {
  for (const off of unregister) off();
  unregister = [];
  if (expireTimer) clearInterval(expireTimer);
  expireTimer = null;
  receiver = null;
  pacer = null;
}
