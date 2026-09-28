/**
 * The fleet match state store (FLEET.md §9, Ready Up's
 * docs/fleet-step3-platform-notes.md §3): one MatchState per match, kept in
 * step with the Ready Up server that plays it.
 *
 * - `state.snapshot` replaces the stored state when its epoch is the match's
 *   current one (or newer); `periodic` / `hello` snapshots are also a drift
 *   check against what the patches built (logged, then the snapshot wins).
 *   `state: null` is an idle server and changes nothing here.
 * - `state.patch` and every `event.*` carry `rev` and a merge `patch`. One
 *   counter: `rev == live_rev + 1` is applied, `rev <= live_rev` is a
 *   duplicate (ignored), `rev > live_rev + 1` is a gap: the patch is held and
 *   the caller sends `state.request`; the snapshot that answers it releases
 *   the held patches that follow on from it.
 * - Epoch fence (§11.4): anything from an epoch below the match's current one
 *   is `stale_epoch` and ignored, so a zombie server cannot move the match.
 * - Round summaries per map (`event.round_end`), pruned by
 *   `event.rounds_voided` and seeded from a snapshot's `map_stats`, so the
 *   normalizer can report per-player map totals while a map is live.
 *
 * Every change is stored (`cs2_match_live_state`, migration 006) and then
 * announced on `onLiveStateChange`. Calls for one match are serialized.
 *
 * The persistence is an interface so the rules can be tested without a
 * database (`createMemoryLiveStatePersistence`); the process-wide store
 * (`liveStateStore`) uses Postgres.
 */

import { EventEmitter } from 'events';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { applyMergePatch, diffPaths } from './mergePatch';
import type {
  MapStats,
  MatchState,
  MatchStatePatch,
  RoundSummary,
  StateSnapshotPayload,
} from './protocol/v1';

/** What the platform knows about one match's live state. */
export interface LiveMatchRecord {
  matchSlug: string;
  /** The match's current assignment epoch (0 = never assigned). */
  epoch: number;
  /** The fleet server holding that epoch. */
  serverId: string | null;
  /** Rev of the last applied patch (the server's `live_rev`). */
  liveRev: number;
  /** The config_rev the server last reported (the `match.update` CAS base). */
  configRev: number;
  /** null until the first snapshot of this epoch. */
  state: MatchState | null;
  /** The last `map_stats` a snapshot carried. */
  mapStats: MapStats | null;
  /** Round summaries per 1-based map number, in round order. */
  mapRounds: Record<string, RoundSummary[]>;
  /** A rev gap is waiting for a `state.snapshot`. */
  needsSnapshot: boolean;
  /** Unix seconds. */
  updatedAt: number;
}

export type PatchOutcome =
  | { kind: 'applied'; record: LiveMatchRecord }
  | { kind: 'duplicate'; record: LiveMatchRecord }
  /** Held until a snapshot; `requestSnapshot` = the caller should send `state.request` now. */
  | { kind: 'gap'; expected: number; got: number; requestSnapshot: boolean }
  /** No state for this epoch yet: held, same as a gap. */
  | { kind: 'no_baseline'; requestSnapshot: boolean }
  | { kind: 'stale_epoch'; currentEpoch: number };

export type SnapshotOutcome =
  | { kind: 'replaced'; record: LiveMatchRecord; drift: string[]; released: number }
  | { kind: 'idle' }
  | { kind: 'stale_epoch'; currentEpoch: number };

export type LiveStateChangeCause = 'assign' | 'snapshot' | 'patch' | 'rounds' | 'config';

export interface LiveStateChange {
  matchSlug: string;
  cause: LiveStateChangeCause;
  /** The fleet message type behind the change (`state.patch`, `event.round_end`, …), when there is one. */
  type?: string;
  record: LiveMatchRecord;
}

/** Where records live. Postgres in the app, memory in unit tests. */
export interface LiveStatePersistence {
  load(matchSlug: string): Promise<LiveMatchRecord | null>;
  save(record: LiveMatchRecord): Promise<void>;
  /**
   * Bump the match's epoch (at least 1, above anything stored) for a new
   * assignment to `serverId`, clear its state, and return the new record.
   */
  allocateEpoch(matchSlug: string, serverId: string, configRev: number): Promise<LiveMatchRecord>;
  listByServer(serverId: string): Promise<LiveMatchRecord[]>;
}

/** Re-send a `state.request` for the same gap at most this often. */
const REQUEST_EVERY_MS = 5_000;
/** Held patches per match; beyond this the oldest go (a snapshot replaces them anyway). */
const MAX_HELD = 256;

interface HeldPatch {
  epoch: number;
  rev: number;
  patch: MatchStatePatch;
  type: string;
}

const nowS = () => Math.floor(Date.now() / 1000);

function emptyRecord(matchSlug: string): LiveMatchRecord {
  return {
    matchSlug,
    epoch: 0,
    serverId: null,
    liveRev: 0,
    configRev: 0,
    state: null,
    mapStats: null,
    mapRounds: {},
    needsSnapshot: false,
    updatedAt: nowS(),
  };
}

export class LiveStateStore {
  private readonly emitter = new EventEmitter();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly held = new Map<string, HeldPatch[]>();
  private readonly requestedAt = new Map<string, number>();

  constructor(private readonly persistence: LiveStatePersistence) {
    this.emitter.setMaxListeners(50);
  }

  // --- reads -----------------------------------------------------------------

  /** The stored record of a match, or null when the fleet never reported it. */
  getLiveState(matchSlug: string): Promise<LiveMatchRecord | null> {
    return this.persistence.load(matchSlug);
  }

  /** Matches whose current epoch is held by this server. */
  listForServer(serverId: string): Promise<LiveMatchRecord[]> {
    return this.persistence.listByServer(serverId);
  }

  /** Listen to every stored change. Returns the unsubscribe function. */
  onLiveStateChange(listener: (change: LiveStateChange) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }

  // --- writes by the platform (the driver) ------------------------------------

  /**
   * A new assignment of `matchSlug` to `serverId` (FLEET.md §7.1, §11.4):
   * returns the new epoch to put in `match.assign`. The stored state is
   * cleared; the server's `state.snapshot {assign}` fills it.
   */
  beginAssignment(matchSlug: string, serverId: string, configRev = 1): Promise<LiveMatchRecord> {
    return this.locked(matchSlug, async () => {
      const record = await this.persistence.allocateEpoch(matchSlug, serverId, configRev);
      this.held.delete(matchSlug);
      this.requestedAt.delete(matchSlug);
      this.emit(record, 'assign');
      return record;
    });
  }

  /** The server acked a `match.update` (`cmd.result ok`, `rev` = config_rev). */
  setConfigRev(matchSlug: string, configRev: number): Promise<LiveMatchRecord | null> {
    return this.locked(matchSlug, async () => {
      const record = await this.persistence.load(matchSlug);
      if (!record) return null;
      const next = { ...record, configRev, updatedAt: nowS() };
      await this.persistence.save(next);
      this.emit(next, 'config');
      return next;
    });
  }

  // --- writes from the server --------------------------------------------------

  /** A `state.snapshot` from `serverId` (ephemeral). */
  applySnapshot(serverId: string, payload: StateSnapshotPayload): Promise<SnapshotOutcome> {
    const state = payload.state;
    if (!state) return Promise.resolve({ kind: 'idle' as const });
    const slug = state.match_id;
    return this.locked(slug, async () => {
      const record = (await this.persistence.load(slug)) ?? emptyRecord(slug);
      if (state.epoch < record.epoch) {
        log.warn(
          `[FLEET] ${serverId}: ignoring a ${payload.reason} snapshot of ${slug} for epoch ${state.epoch} (current ${record.epoch})`
        );
        return { kind: 'stale_epoch' as const, currentEpoch: record.epoch };
      }
      if (state.epoch > record.epoch && record.epoch > 0) {
        log.warn(
          `[FLEET] ${serverId}: ${slug} snapshot has epoch ${state.epoch}, platform had ${record.epoch}; taking it`
        );
      }

      let drift: string[] = [];
      if (
        (payload.reason === 'periodic' || payload.reason === 'hello') &&
        record.state &&
        record.epoch === state.epoch &&
        record.liveRev === state.live_rev
      ) {
        drift = diffPaths(record.state, state);
        if (drift.length) {
          log.warn(
            `[FLEET] ${serverId}: ${slug} drifted from its ${payload.reason} snapshot at rev ${state.live_rev}: ${drift.join(', ')}`
          );
        }
      }

      const mapRounds = state.epoch === record.epoch ? { ...record.mapRounds } : {};
      if (payload.map_stats) {
        mapRounds[String(state.series.current_map)] = [...payload.map_stats.rounds].sort(
          (a, b) => a.round_number - b.round_number
        );
      }
      let next: LiveMatchRecord = {
        matchSlug: slug,
        epoch: state.epoch,
        serverId,
        liveRev: state.live_rev,
        configRev: state.config_rev,
        state,
        mapStats: payload.map_stats ?? (state.epoch === record.epoch ? record.mapStats : null),
        mapRounds,
        needsSnapshot: false,
        updatedAt: nowS(),
      };

      // Patches held during a gap that follow on from this snapshot.
      let released = 0;
      const held = (this.held.get(slug) ?? [])
        .filter((h) => h.epoch === next.epoch)
        .sort((a, b) => a.rev - b.rev);
      const keep: HeldPatch[] = [];
      for (const h of held) {
        if (h.rev <= next.liveRev) continue;
        if (h.rev === next.liveRev + 1) {
          next = {
            ...next,
            state: applyMergePatch<MatchState>(next.state, h.patch),
            liveRev: h.rev,
          };
          released += 1;
        } else {
          keep.push(h);
        }
      }
      if (keep.length) {
        next.needsSnapshot = true;
        this.held.set(slug, keep);
      } else {
        this.held.delete(slug);
        this.requestedAt.delete(slug);
      }

      await this.persistence.save(next);
      this.emit(next, 'snapshot', 'state.snapshot');
      return { kind: 'replaced' as const, record: next, drift, released };
    });
  }

  /**
   * A `state.patch` or `event.*` for `matchSlug` from `serverId`: its envelope
   * `epoch` (undefined = the current one), payload `rev` and `patch`.
   */
  applyPatch(
    serverId: string,
    input: { matchSlug: string; epoch?: number; rev: number; patch: MatchStatePatch; type: string }
  ): Promise<PatchOutcome> {
    return this.locked(input.matchSlug, async () => {
      const slug = input.matchSlug;
      const record = await this.persistence.load(slug);
      const epoch = input.epoch ?? record?.epoch ?? 0;
      if (record && epoch < record.epoch) {
        return { kind: 'stale_epoch' as const, currentEpoch: record.epoch };
      }
      const hold = () => {
        const list = this.held.get(slug) ?? [];
        list.push({ epoch, rev: input.rev, patch: input.patch, type: input.type });
        while (list.length > MAX_HELD) list.shift();
        this.held.set(slug, list);
        const last = this.requestedAt.get(slug) ?? 0;
        const requestSnapshot = Date.now() - last >= REQUEST_EVERY_MS;
        if (requestSnapshot) this.requestedAt.set(slug, Date.now());
        return requestSnapshot;
      };

      if (!record || !record.state || epoch > record.epoch) {
        const requestSnapshot = hold();
        if (record && !record.needsSnapshot)
          await this.persistence.save({ ...record, needsSnapshot: true });
        return { kind: 'no_baseline' as const, requestSnapshot };
      }
      if (input.rev <= record.liveRev) return { kind: 'duplicate' as const, record };
      if (input.rev > record.liveRev + 1) {
        const requestSnapshot = hold();
        if (!record.needsSnapshot) await this.persistence.save({ ...record, needsSnapshot: true });
        log.warn(
          `[FLEET] ${serverId}: ${slug} rev gap: have ${record.liveRev}, got ${input.rev} (${input.type})`
        );
        return {
          kind: 'gap' as const,
          expected: record.liveRev + 1,
          got: input.rev,
          requestSnapshot,
        };
      }
      const next: LiveMatchRecord = {
        ...record,
        serverId,
        liveRev: input.rev,
        state: applyMergePatch<MatchState>(record.state, input.patch),
        updatedAt: nowS(),
      };
      await this.persistence.save(next);
      this.emit(next, 'patch', input.type);
      return { kind: 'applied' as const, record: next };
    });
  }

  /**
   * An `event.round_end` summary for map `mapNumber` (1-based). A round that
   * is already there (the round replayed after a restore) is replaced.
   * Ignored for a stale epoch.
   */
  recordRound(
    matchSlug: string,
    epoch: number | undefined,
    mapNumber: number,
    round: RoundSummary
  ): Promise<RoundSummary[] | null> {
    return this.locked(matchSlug, async () => {
      const record = await this.persistence.load(matchSlug);
      if (!record || (epoch !== undefined && epoch < record.epoch)) return null;
      const key = String(mapNumber);
      const rounds = (record.mapRounds[key] ?? []).filter(
        (r) => r.round_number !== round.round_number
      );
      rounds.push(round);
      rounds.sort((a, b) => a.round_number - b.round_number);
      const next = {
        ...record,
        mapRounds: { ...record.mapRounds, [key]: rounds },
        updatedAt: nowS(),
      };
      await this.persistence.save(next);
      this.emit(next, 'rounds', 'event.round_end');
      return rounds;
    });
  }

  /** `event.rounds_voided`: drop the rounds `>= fromRound` of that map. Returns how many went. */
  voidRounds(
    matchSlug: string,
    epoch: number | undefined,
    mapNumber: number,
    fromRound: number
  ): Promise<number> {
    return this.locked(matchSlug, async () => {
      const record = await this.persistence.load(matchSlug);
      if (!record || (epoch !== undefined && epoch < record.epoch)) return 0;
      const key = String(mapNumber);
      const before = record.mapRounds[key] ?? [];
      const after = before.filter((r) => r.round_number < fromRound);
      if (after.length === before.length) return 0;
      const next = {
        ...record,
        mapRounds: { ...record.mapRounds, [key]: after },
        updatedAt: nowS(),
      };
      await this.persistence.save(next);
      this.emit(next, 'rounds', 'event.rounds_voided');
      return before.length - after.length;
    });
  }

  /** Held patches of a match (tests, diagnostics). */
  heldCount(matchSlug: string): number {
    return this.held.get(matchSlug)?.length ?? 0;
  }

  // --- internals ---------------------------------------------------------------

  private emit(record: LiveMatchRecord, cause: LiveStateChangeCause, type?: string): void {
    const change: LiveStateChange = {
      matchSlug: record.matchSlug,
      cause,
      record,
      ...(type ? { type } : {}),
    };
    for (const listener of this.emitter.listeners('change') as Array<
      (c: LiveStateChange) => void
    >) {
      try {
        listener(change);
      } catch (error) {
        log.warn(`[FLEET] live state listener failed: ${(error as Error).message}`);
      }
    }
  }

  private locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface LiveStateRow {
  match_slug: string;
  epoch: number;
  server_id: string | null;
  live_rev: number;
  config_rev: number;
  state: string | null;
  map_stats: string | null;
  map_rounds: string | null;
  needs_snapshot: number;
  updated_at: number;
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function fromRow(row: LiveStateRow): LiveMatchRecord {
  return {
    matchSlug: row.match_slug,
    epoch: Number(row.epoch),
    serverId: row.server_id,
    liveRev: Number(row.live_rev),
    configRev: Number(row.config_rev),
    state: parse<MatchState>(row.state),
    mapStats: parse<MapStats>(row.map_stats),
    mapRounds: parse<Record<string, RoundSummary[]>>(row.map_rounds) ?? {},
    needsSnapshot: Number(row.needs_snapshot) === 1,
    updatedAt: Number(row.updated_at),
  };
}

const COLUMNS =
  'match_slug, epoch, server_id, live_rev, config_rev, state, map_stats, map_rounds, needs_snapshot, updated_at';

export function createPostgresLiveStatePersistence(): LiveStatePersistence {
  return {
    async load(matchSlug) {
      const row = await db.queryOneAsync<LiveStateRow>(
        `SELECT ${COLUMNS} FROM cs2_match_live_state WHERE match_slug = ?`,
        [matchSlug]
      );
      return row ? fromRow(row) : null;
    },
    async save(r) {
      await db.runAsync(
        `INSERT INTO cs2_match_live_state (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_slug) DO UPDATE SET
           epoch = EXCLUDED.epoch, server_id = EXCLUDED.server_id, live_rev = EXCLUDED.live_rev,
           config_rev = EXCLUDED.config_rev, state = EXCLUDED.state, map_stats = EXCLUDED.map_stats,
           map_rounds = EXCLUDED.map_rounds, needs_snapshot = EXCLUDED.needs_snapshot, updated_at = EXCLUDED.updated_at`,
        [
          r.matchSlug,
          r.epoch,
          r.serverId,
          r.liveRev,
          r.configRev,
          r.state ? JSON.stringify(r.state) : null,
          r.mapStats ? JSON.stringify(r.mapStats) : null,
          JSON.stringify(r.mapRounds),
          r.needsSnapshot ? 1 : 0,
          r.updatedAt,
        ]
      );
    },
    async allocateEpoch(matchSlug, serverId, configRev) {
      const row = await db.queryOneAsync<LiveStateRow>(
        `INSERT INTO cs2_match_live_state (match_slug, epoch, server_id, live_rev, config_rev, state, map_stats, map_rounds, needs_snapshot, updated_at)
         VALUES (?, 1, ?, 0, ?, NULL, NULL, '{}', 0, ?)
         ON CONFLICT (match_slug) DO UPDATE SET
           epoch = cs2_match_live_state.epoch + 1, server_id = EXCLUDED.server_id, live_rev = 0,
           config_rev = EXCLUDED.config_rev, state = NULL, map_stats = NULL, map_rounds = '{}',
           needs_snapshot = 0, updated_at = EXCLUDED.updated_at
         RETURNING ${COLUMNS}`,
        [matchSlug, serverId, configRev, nowS()]
      );
      if (!row) throw new Error(`fleet: could not allocate an epoch for ${matchSlug}`);
      return fromRow(row);
    },
    async listByServer(serverId) {
      const rows = await db.queryAsync<LiveStateRow>(
        `SELECT ${COLUMNS} FROM cs2_match_live_state WHERE server_id = ? ORDER BY updated_at DESC`,
        [serverId]
      );
      return rows.map(fromRow);
    },
  };
}

/** In-memory persistence for unit tests (same rules, no database). */
export function createMemoryLiveStatePersistence(): LiveStatePersistence & {
  records: Map<string, LiveMatchRecord>;
} {
  const records = new Map<string, LiveMatchRecord>();
  const copy = (r: LiveMatchRecord): LiveMatchRecord =>
    JSON.parse(JSON.stringify(r)) as LiveMatchRecord;
  return {
    records,
    async load(slug) {
      const r = records.get(slug);
      return r ? copy(r) : null;
    },
    async save(r) {
      records.set(r.matchSlug, copy(r));
    },
    async allocateEpoch(slug, serverId, configRev) {
      const prev = records.get(slug);
      const r: LiveMatchRecord = {
        ...emptyRecord(slug),
        epoch: (prev?.epoch ?? 0) + 1,
        serverId,
        configRev,
      };
      records.set(slug, copy(r));
      return copy(r);
    },
    async listByServer(serverId) {
      return [...records.values()].filter((r) => r.serverId === serverId).map(copy);
    },
  };
}

/** The process-wide store, on Postgres. */
export const liveStateStore = new LiveStateStore(createPostgresLiveStatePersistence());

/** Shorthand for `liveStateStore.getLiveState`. */
export function getLiveState(matchSlug: string): Promise<LiveMatchRecord | null> {
  return liveStateStore.getLiveState(matchSlug);
}
