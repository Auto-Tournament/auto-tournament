/**
 * The round backup store (FLEET.md §12.1, §12.3; Ready Up's
 * docs/fleet-step3-platform-notes.md §7).
 *
 * CS2 writes a backup file at every round start; Ready Up sends it inline
 * (`event.backup`, reliable and critical). This module keeps them, one per
 * (match, map, round): table `cs2_match_round_backups` (migration
 * `007-round-backups`). The admin's "restore to round N" (./restore.ts) and a
 * failover resume (`match.assign.resume.backup`) send one back inline, so a
 * different server can load it.
 *
 * - The file is checked before it is stored: base64, `size` and `sha256` of
 *   the whole file. A bad one is logged and dropped (the raw message is still
 *   in `cs2_fleet_events`).
 * - Files sent in parts (`part` / `parts`, same file / size / sha256) are
 *   staged in `cs2_match_round_backup_parts` until the last part arrives,
 *   then put together and checked like a single one.
 * - Idempotent: the same file again (a replayed event) changes nothing. A
 *   different file for the same round (the round was replayed after a
 *   restore) replaces it: the newest is kept.
 * - A backup from a fenced (stale epoch) server is not stored: a zombie's
 *   rounds must not replace the live server's.
 * - `event.rounds_voided {from_round}` marks the backups of the rounds after
 *   it superseded (they are from the abandoned timeline); a new backup of
 *   such a round clears the mark.
 * - Retention (`FLEET_BACKUP_RETENTION_DAYS`, default 14; 0 = keep forever):
 *   the backups of a match that ended (completed / cancelled) more than N
 *   days ago, and of a match that no longer exists, stored more than N days
 *   ago. Live and recent matches keep every backup. Runs hourly.
 *
 * Map numbers here are the fleet's (1-based), as in the protocol.
 */

import crypto from 'crypto';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { fleetInbound, type FleetEventNotice } from './inbound';
import type { FleetEventData, FleetEventPayload, InlineBackup, Score } from './protocol/v1';

/** The schema's limit for a whole backup file (`inlineBackup.size`). */
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;

/** The schema's limit for one inline `data` field (base64 characters). */
export const MAX_INLINE_DATA_CHARS = 700_000;

/** Days to keep the backups of an ended match. */
export const DEFAULT_BACKUP_RETENTION_DAYS = 14;

/** Staged parts of a file that never completed are dropped after this long. */
const PART_TTL_S = 24 * 60 * 60;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** A stored backup without its file. */
export interface RoundBackupMeta {
  id: number;
  matchSlug: string;
  /** Fleet map number (1-based). */
  mapNumber: number;
  /** The round the backup starts (1-based). */
  round: number;
  epoch: number | null;
  serverId: string | null;
  file: string;
  size: number;
  sha256: string;
  /** Map score at the start of the round. */
  score: Score;
  /** Unix seconds; set when a restore voided this round. */
  supersededAt: number | null;
  /** Unix seconds: first stored. */
  storedAt: number;
  /** Unix seconds: last replaced. */
  updatedAt: number;
}

export interface StoredRoundBackup extends RoundBackupMeta {
  /** The whole file, base64. */
  data: string;
}

export type BackupIngestOutcome =
  | { kind: 'stored'; backup: RoundBackupMeta }
  | { kind: 'replaced'; backup: RoundBackupMeta; previousSha256: string }
  | { kind: 'duplicate'; backup: RoundBackupMeta }
  | { kind: 'partial'; received: number; parts: number }
  | { kind: 'rejected'; reason: string };

export interface BackupIngestInput {
  matchSlug: string;
  serverId: string | null;
  epoch: number | null;
  backup: InlineBackup;
}

/** A row to write: everything but the ids and times. */
export interface RoundBackupWrite {
  matchSlug: string;
  mapNumber: number;
  round: number;
  epoch: number | null;
  serverId: string | null;
  file: string;
  size: number;
  sha256: string;
  score: Score;
  data: string;
}

export interface BackupPartKey {
  matchSlug: string;
  mapNumber: number;
  round: number;
  sha256: string;
}

/** Where the store keeps its rows: Postgres in the API, memory in the unit tests. */
export interface RoundBackupPersistence {
  get(matchSlug: string, mapNumber: number, round: number): Promise<StoredRoundBackup | null>;
  getById(id: number): Promise<StoredRoundBackup | null>;
  /** Insert, or replace the row of (match, map, round); clears `supersededAt`. */
  upsert(row: RoundBackupWrite, now: number): Promise<RoundBackupMeta>;
  list(matchSlug: string): Promise<RoundBackupMeta[]>;
  /** Stage one part (a repeat of the same part replaces it); returns how many parts of that file are staged. */
  stagePart(
    key: BackupPartKey,
    part: number,
    parts: number,
    data: string,
    now: number
  ): Promise<number>;
  /** The staged parts of a file, by part number. */
  takeParts(key: BackupPartKey): Promise<Array<{ part: number; data: string }>>;
  dropParts(key: BackupPartKey): Promise<void>;
  /** Mark the backups of rounds > `afterRound` superseded; returns how many. */
  markSuperseded(
    matchSlug: string,
    mapNumber: number,
    afterRound: number,
    now: number
  ): Promise<number>;
  /** Delete every backup (and staged part) of a match; returns how many backups. */
  deleteMatch(matchSlug: string): Promise<number>;
  /**
   * Delete the backups of matches that ended before `endedBefore` and of
   * matches that do not exist stored before it, and parts staged before
   * `partsBefore`. Returns the number of backups deleted.
   */
  prune(endedBefore: number, partsBefore: number): Promise<number>;
}

const nowS = () => Math.floor(Date.now() / 1000);

/** Base64 that round-trips (Node's decoder skips junk silently). */
function decodeBase64(data: string): Buffer | null {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  return Buffer.from(data, 'base64');
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function toMeta(row: StoredRoundBackup): RoundBackupMeta {
  const meta: RoundBackupMeta & { data?: string } = { ...row };
  delete meta.data;
  return meta;
}

/** The `InlineBackup` of a stored backup, as `cmd restore_round` / `resume` send it (single part). */
export function toInlineBackup(row: StoredRoundBackup): InlineBackup {
  return {
    map_number: row.mapNumber,
    round: row.round,
    file: row.file,
    size: row.size,
    sha256: row.sha256,
    score: { team1: row.score.team1, team2: row.score.team2 },
    encoding: 'base64',
    data: row.data,
  };
}

/** Whether a stored backup fits in one inline frame (`data` ≤ 700 000 characters). */
export function fitsInline(row: Pick<StoredRoundBackup, 'data'>): boolean {
  return row.data.length <= MAX_INLINE_DATA_CHARS;
}

export class RoundBackupStore {
  constructor(private readonly persistence: RoundBackupPersistence) {}

  /** Check and store one `event.backup` payload (or part of one). */
  async ingest(input: BackupIngestInput, now = nowS()): Promise<BackupIngestOutcome> {
    const b = input.backup;
    if (b.encoding !== 'base64')
      return { kind: 'rejected', reason: `encoding ${String(b.encoding)}` };
    if (!Number.isInteger(b.size) || b.size < 1 || b.size > MAX_BACKUP_BYTES) {
      return { kind: 'rejected', reason: `size ${b.size} is outside 1..${MAX_BACKUP_BYTES}` };
    }
    const parts = b.parts ?? 1;
    const part = b.part ?? 1;
    if (
      !Number.isInteger(parts) ||
      parts < 1 ||
      !Number.isInteger(part) ||
      part < 1 ||
      part > parts
    ) {
      return { kind: 'rejected', reason: `part ${part} of ${parts}` };
    }
    const decoded = decodeBase64(b.data);
    if (!decoded) return { kind: 'rejected', reason: 'data is not base64' };

    let file: Buffer = decoded;
    if (parts > 1) {
      const key: BackupPartKey = {
        matchSlug: input.matchSlug,
        mapNumber: b.map_number,
        round: b.round,
        sha256: b.sha256,
      };
      const staged = await this.persistence.stagePart(key, part, parts, b.data, now);
      if (staged < parts) return { kind: 'partial', received: staged, parts };
      const pieces = await this.persistence.takeParts(key);
      const buffers: Buffer[] = [];
      for (let n = 1; n <= parts; n++) {
        const piece = pieces.find((p) => p.part === n);
        const buf = piece ? decodeBase64(piece.data) : null;
        if (!buf) return { kind: 'partial', received: pieces.length, parts };
        buffers.push(buf);
      }
      await this.persistence.dropParts(key);
      file = Buffer.concat(buffers);
    }

    if (file.length !== b.size) {
      return {
        kind: 'rejected',
        reason: `size mismatch: ${file.length} bytes, expected ${b.size}`,
      };
    }
    const sha = sha256Hex(file);
    if (sha !== b.sha256) return { kind: 'rejected', reason: 'sha256 mismatch' };

    const existing = await this.persistence.get(input.matchSlug, b.map_number, b.round);
    if (existing && existing.sha256 === sha && existing.supersededAt === null) {
      return { kind: 'duplicate', backup: toMeta(existing) };
    }
    const stored = await this.persistence.upsert(
      {
        matchSlug: input.matchSlug,
        mapNumber: b.map_number,
        round: b.round,
        epoch: input.epoch,
        serverId: input.serverId,
        file: b.file,
        size: b.size,
        sha256: sha,
        score: { team1: b.score.team1, team2: b.score.team2 },
        data: parts > 1 ? file.toString('base64') : b.data,
      },
      now
    );
    if (existing && existing.sha256 !== sha) {
      return { kind: 'replaced', backup: stored, previousSha256: existing.sha256 };
    }
    return { kind: 'stored', backup: stored };
  }

  /**
   * A fresh assignment (not a resume) starts the match from round 1: backups
   * already stored under its slug belong to an earlier match that had the same
   * slug (a deleted and recreated tournament reuses r1m1, ...), and a failover
   * would resume from them. Returns how many were deleted.
   */
  forget(matchSlug: string): Promise<number> {
    return this.persistence.deleteMatch(matchSlug);
  }

  /** `event.rounds_voided {from_round}`: the backups after `fromRound` are from the abandoned timeline. */
  roundsVoided(
    matchSlug: string,
    mapNumber: number,
    fromRound: number,
    now = nowS()
  ): Promise<number> {
    return this.persistence.markSuperseded(matchSlug, mapNumber, fromRound, now);
  }

  /** A match's backups, by map then round (no file contents). */
  async list(matchSlug: string): Promise<RoundBackupMeta[]> {
    const rows = await this.persistence.list(matchSlug);
    return rows.sort((a, b) => a.mapNumber - b.mapNumber || a.round - b.round);
  }

  get(matchSlug: string, mapNumber: number, round: number): Promise<StoredRoundBackup | null> {
    return this.persistence.get(matchSlug, mapNumber, round);
  }

  getById(id: number): Promise<StoredRoundBackup | null> {
    return this.persistence.getById(id);
  }

  /** Apply the retention (days; 0 or less keeps everything). Returns the backups deleted. */
  prune(retentionDays: number, now = nowS()): Promise<number> {
    const endedBefore =
      retentionDays > 0 ? now - Math.floor(retentionDays * 86400) : Number.NEGATIVE_INFINITY;
    return this.persistence.prune(endedBefore, now - PART_TTL_S);
  }
}

// ---------------------------------------------------------------------------
// Persistence: memory (tests) and Postgres
// ---------------------------------------------------------------------------

/**
 * In-memory persistence for the unit tests. `matchEndedAt(slug)` stands in
 * for the matches table: undefined = no such match, null = not ended.
 */
export function createMemoryRoundBackupPersistence(
  matchEndedAt: (slug: string) => number | null | undefined = () => null
): RoundBackupPersistence & { rows: StoredRoundBackup[]; partCount(): number } {
  const rows: StoredRoundBackup[] = [];
  const parts = new Map<
    string,
    { part: number; parts: number; data: string; receivedAt: number }[]
  >();
  let nextId = 1;
  const partKey = (k: BackupPartKey) => `${k.matchSlug}|${k.mapNumber}|${k.round}|${k.sha256}`;
  const find = (slug: string, map: number, round: number) =>
    rows.find((r) => r.matchSlug === slug && r.mapNumber === map && r.round === round);
  const copy = (r: StoredRoundBackup): StoredRoundBackup => ({ ...r, score: { ...r.score } });

  return {
    rows,
    partCount: () => [...parts.values()].reduce((n, list) => n + list.length, 0),
    async get(slug, map, round) {
      const row = find(slug, map, round);
      return row ? copy(row) : null;
    },
    async getById(id) {
      const row = rows.find((r) => r.id === id);
      return row ? copy(row) : null;
    },
    async upsert(w, now) {
      const existing = find(w.matchSlug, w.mapNumber, w.round);
      if (existing) {
        Object.assign(existing, {
          ...w,
          score: { ...w.score },
          supersededAt: null,
          updatedAt: now,
        });
        return toMeta(copy(existing));
      }
      const row: StoredRoundBackup = {
        ...w,
        score: { ...w.score },
        id: nextId++,
        supersededAt: null,
        storedAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return toMeta(copy(row));
    },
    async list(slug) {
      return rows.filter((r) => r.matchSlug === slug).map((r) => toMeta(copy(r)));
    },
    async stagePart(key, part, count, data, now) {
      const list = parts.get(partKey(key)) ?? [];
      const others = list.filter((p) => p.part !== part);
      others.push({ part, parts: count, data, receivedAt: now });
      parts.set(partKey(key), others);
      return others.length;
    },
    async takeParts(key) {
      return (parts.get(partKey(key)) ?? []).map((p) => ({ part: p.part, data: p.data }));
    },
    async dropParts(key) {
      parts.delete(partKey(key));
    },
    async deleteMatch(slug) {
      const keep = rows.filter((r) => r.matchSlug !== slug);
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      for (const k of [...parts.keys()]) if (k.startsWith(`${slug}|`)) parts.delete(k);
      return n;
    },
    async markSuperseded(slug, map, afterRound, now) {
      let n = 0;
      for (const r of rows) {
        if (
          r.matchSlug === slug &&
          r.mapNumber === map &&
          r.round > afterRound &&
          r.supersededAt === null
        ) {
          r.supersededAt = now;
          n++;
        }
      }
      return n;
    },
    async prune(endedBefore, partsBefore) {
      const keep = rows.filter((r) => {
        const ended = matchEndedAt(r.matchSlug);
        if (ended === undefined) return !(r.storedAt < endedBefore);
        if (ended === null) return true;
        return !(ended < endedBefore);
      });
      const deleted = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      for (const [k, list] of parts) {
        const left = list.filter((p) => p.receivedAt >= partsBefore);
        if (left.length) parts.set(k, left);
        else parts.delete(k);
      }
      return deleted;
    },
  };
}

interface BackupRow {
  id: string | number;
  match_slug: string;
  map_number: number;
  round: number;
  epoch: number | null;
  server_id: string | null;
  file: string;
  size: number;
  sha256: string;
  score_team1: number;
  score_team2: number;
  data?: string;
  superseded_at: number | null;
  stored_at: number;
  updated_at: number;
}

const META_COLUMNS =
  'id, match_slug, map_number, round, epoch, server_id, file, size, sha256, score_team1, score_team2, superseded_at, stored_at, updated_at';

function fromRow(row: BackupRow): StoredRoundBackup {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(row.id),
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    round: Number(row.round),
    epoch: n(row.epoch),
    serverId: row.server_id,
    file: row.file,
    size: Number(row.size),
    sha256: row.sha256,
    score: { team1: Number(row.score_team1), team2: Number(row.score_team2) },
    data: row.data ?? '',
    supersededAt: n(row.superseded_at),
    storedAt: Number(row.stored_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Matches that are over, for the retention. */
const ENDED_STATUSES = ['completed', 'cancelled'];

export function createDbRoundBackupPersistence(): RoundBackupPersistence {
  return {
    async get(slug, map, round) {
      const row = await db.queryOneAsync<BackupRow>(
        `SELECT ${META_COLUMNS}, data FROM cs2_match_round_backups WHERE match_slug = ? AND map_number = ? AND round = ?`,
        [slug, map, round]
      );
      return row ? fromRow(row) : null;
    },
    async getById(id) {
      const row = await db.queryOneAsync<BackupRow>(
        `SELECT ${META_COLUMNS}, data FROM cs2_match_round_backups WHERE id = ?`,
        [id]
      );
      return row ? fromRow(row) : null;
    },
    async upsert(w, now) {
      const row = await db.queryOneAsync<BackupRow>(
        `INSERT INTO cs2_match_round_backups
           (match_slug, map_number, round, epoch, server_id, file, size, sha256, score_team1, score_team2, data, superseded_at, stored_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (match_slug, map_number, round) DO UPDATE SET
           epoch = EXCLUDED.epoch, server_id = EXCLUDED.server_id, file = EXCLUDED.file,
           size = EXCLUDED.size, sha256 = EXCLUDED.sha256, score_team1 = EXCLUDED.score_team1,
           score_team2 = EXCLUDED.score_team2, data = EXCLUDED.data, superseded_at = NULL,
           updated_at = EXCLUDED.updated_at
         RETURNING ${META_COLUMNS}`,
        [
          w.matchSlug,
          w.mapNumber,
          w.round,
          w.epoch,
          w.serverId,
          w.file,
          w.size,
          w.sha256,
          w.score.team1,
          w.score.team2,
          w.data,
          now,
          now,
        ]
      );
      if (!row) throw new Error('round backup upsert returned no row');
      return toMeta(fromRow(row));
    },
    async list(slug) {
      const rows = await db.queryAsync<BackupRow>(
        `SELECT ${META_COLUMNS} FROM cs2_match_round_backups WHERE match_slug = ? ORDER BY map_number, round`,
        [slug]
      );
      return rows.map((r) => toMeta(fromRow(r)));
    },
    async stagePart(key, part, parts, data, now) {
      await db.runAsync(
        `INSERT INTO cs2_match_round_backup_parts (match_slug, map_number, round, sha256, part, parts, data, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_slug, map_number, round, sha256, part) DO UPDATE SET data = EXCLUDED.data, parts = EXCLUDED.parts, received_at = EXCLUDED.received_at`,
        [key.matchSlug, key.mapNumber, key.round, key.sha256, part, parts, data, now]
      );
      const count = await db.queryOneAsync<{ n: string | number }>(
        'SELECT COUNT(*) AS n FROM cs2_match_round_backup_parts WHERE match_slug = ? AND map_number = ? AND round = ? AND sha256 = ?',
        [key.matchSlug, key.mapNumber, key.round, key.sha256]
      );
      return Number(count?.n ?? 0);
    },
    async takeParts(key) {
      const rows = await db.queryAsync<{ part: number; data: string }>(
        'SELECT part, data FROM cs2_match_round_backup_parts WHERE match_slug = ? AND map_number = ? AND round = ? AND sha256 = ? ORDER BY part',
        [key.matchSlug, key.mapNumber, key.round, key.sha256]
      );
      return rows.map((r) => ({ part: Number(r.part), data: r.data }));
    },
    async dropParts(key) {
      await db.runAsync(
        'DELETE FROM cs2_match_round_backup_parts WHERE match_slug = ? AND map_number = ? AND round = ? AND sha256 = ?',
        [key.matchSlug, key.mapNumber, key.round, key.sha256]
      );
    },
    async deleteMatch(slug) {
      const result = await db.runAsync('DELETE FROM cs2_match_round_backups WHERE match_slug = ?', [
        slug,
      ]);
      await db.runAsync('DELETE FROM cs2_match_round_backup_parts WHERE match_slug = ?', [slug]);
      return result.changes;
    },
    async markSuperseded(slug, map, afterRound, now) {
      const result = await db.runAsync(
        'UPDATE cs2_match_round_backups SET superseded_at = ? WHERE match_slug = ? AND map_number = ? AND round > ? AND superseded_at IS NULL',
        [now, slug, map, afterRound]
      );
      return result.changes;
    },
    async prune(endedBefore, partsBefore) {
      let deleted = 0;
      if (Number.isFinite(endedBefore)) {
        const ended = await db.runAsync(
          `DELETE FROM cs2_match_round_backups b
            USING matches m
            WHERE m.slug = b.match_slug
              AND m.status IN (${ENDED_STATUSES.map(() => '?').join(', ')})
              AND COALESCE(m.completed_at, b.updated_at) < ?`,
          [...ENDED_STATUSES, endedBefore]
        );
        const orphans = await db.runAsync(
          `DELETE FROM cs2_match_round_backups b
            WHERE b.stored_at < ?
              AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.slug = b.match_slug)`,
          [endedBefore]
        );
        deleted = ended.changes + orphans.changes;
      }
      await db.runAsync('DELETE FROM cs2_match_round_backup_parts WHERE received_at < ?', [
        partsBefore,
      ]);
      return deleted;
    },
  };
}

export const roundBackupStore = new RoundBackupStore(createDbRoundBackupPersistence());

// ---------------------------------------------------------------------------
// Wiring: fleet events in, retention job
// ---------------------------------------------------------------------------

/** `FLEET_BACKUP_RETENTION_DAYS` (default 14; 0 keeps everything). */
export function backupRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FLEET_BACKUP_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BACKUP_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BACKUP_RETENTION_DAYS;
}

/**
 * What the store does with one fleet event: `event.backup` is stored,
 * `event.rounds_voided` supersedes the later rounds. Events of a fenced
 * (stale-epoch) server are ignored. Exported for the tests.
 */
export async function handleBackupEvent(
  store: RoundBackupStore,
  notice: Pick<FleetEventNotice, 'serverId' | 'envelope' | 'patch'>
): Promise<BackupIngestOutcome | number | null> {
  const env = notice.envelope;
  if (env.type !== 'event.backup' && env.type !== 'event.rounds_voided') return null;
  const payload = env.payload as unknown as FleetEventPayload<unknown>;
  if (notice.patch === 'stale_epoch') {
    log.warn(
      `[FLEET] ${notice.serverId}: ${env.type} for ${payload.match_id} from a fenced epoch (${env.epoch}); not stored`
    );
    return null;
  }
  if (env.type === 'event.rounds_voided') {
    const data = payload.data as FleetEventData['rounds_voided'];
    return store.roundsVoided(payload.match_id, payload.map_number, data.from_round);
  }
  const backup = payload.data as FleetEventData['backup'];
  const outcome = await store.ingest({
    matchSlug: payload.match_id,
    serverId: notice.serverId,
    epoch: env.epoch ?? null,
    backup,
  });
  const what = `${payload.match_id} map ${backup.map_number} round ${backup.round}`;
  switch (outcome.kind) {
    case 'rejected':
      log.warn(`[FLEET] ${notice.serverId}: backup of ${what} dropped: ${outcome.reason}`);
      break;
    case 'partial':
      log.debug(
        `[FLEET] ${notice.serverId}: backup of ${what}: part ${outcome.received}/${outcome.parts}`
      );
      break;
    case 'stored':
    case 'replaced':
      log.info(
        `[FLEET] ${notice.serverId}: backup of ${what} ${outcome.kind} (${backup.size} bytes, ${backup.score.team1}-${backup.score.team2})`
      );
      break;
    default:
      break;
  }
  return outcome;
}

let unsubscribe: (() => void) | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

async function pruneNow(): Promise<void> {
  const days = backupRetentionDays();
  const deleted = await roundBackupStore.prune(days);
  if (deleted > 0)
    log.info(`[FLEET] round backups: ${deleted} past the ${days}-day retention deleted`);
}

/** Listen for `event.backup` / `event.rounds_voided` and start the retention job. Idempotent. */
export function startRoundBackups(): void {
  if (!unsubscribe) {
    unsubscribe = fleetInbound.onEvent((notice) => {
      if (notice.envelope.type !== 'event.backup' && notice.envelope.type !== 'event.rounds_voided')
        return;
      void handleBackupEvent(roundBackupStore, notice).catch((error) => {
        log.error(
          `[FLEET] ${notice.serverId}: storing ${notice.envelope.type} seq ${notice.envelope.seq} failed: ${(error as Error).message}`
        );
      });
    });
  }
  if (!pruneTimer) {
    void pruneNow().catch((error) =>
      log.warn(`[FLEET] round backup retention failed: ${(error as Error).message}`)
    );
    pruneTimer = setInterval(() => {
      void pruneNow().catch((error) =>
        log.warn(`[FLEET] round backup retention failed: ${(error as Error).message}`)
      );
    }, PRUNE_INTERVAL_MS);
    pruneTimer.unref?.();
  }
}

export function stopRoundBackups(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
}
