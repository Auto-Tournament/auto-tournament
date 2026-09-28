/**
 * "Restore to round N" (FLEET.md §7.4 `cmd restore_round`, §11.2, D8), for
 * both transports, with an audit row per request (`cs2_match_round_restores`,
 * migration `007-round-backups`).
 *
 * Fleet (a match with a live assignment, ./state.ts): the admin picks one of
 * the stored backups (./backups.ts). The platform writes the audit row, then
 * sends `cmd restore_round {map_number, round, backup}` to the server that
 * holds the match's current epoch, with the backup **inline** so a server
 * that does not have the file (the match moved after a failover) can load
 * it. A file too large for one frame (> 700 000 base64 characters) goes
 * without `backup` to the server that wrote it (it uses its own file), and is
 * refused for any other. The answer is the command's one `cmd.result`
 * (`awaitCommandResult`); the command expires after `COMMAND_TTL_MS`, so a
 * server that is offline does not restore minutes later.
 *
 * RCON (the Auto Tournament CS2 plugin): `css_restore <round>` on the match's
 * server, the same as `POST /api/rcon/restore-backup`; the plugin keeps its
 * own backups, so there is no list.
 *
 * For the fleet driver: `restoreRoundBackup` is the call behind the admin
 * route; `inlineBackupFor(slug, map, round)` gives the `InlineBackup` a
 * failover `match.assign.resume.backup` needs.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { ulid } from './credentials';
import { fleetInbound } from './inbound';
import {
  fitsInline,
  roundBackupStore,
  toInlineBackup,
  type RoundBackupStore,
  type StoredRoundBackup,
} from './backups';
import type { CmdPayload, InlineBackup } from './protocol/v1';
import type { LiveMatchRecord } from './state';
import type { FleetCommandRecord, ReliableSendResult } from './reliable';

/** A queued restore that has not reached the server by then is answered `expired`. */
export const COMMAND_TTL_MS = 2 * 60 * 1000;

/** How long the route waits for the `cmd.result`. */
export const DEFAULT_RESULT_TIMEOUT_MS = 15_000;

export type RestoreTransport = 'fleet' | 'rcon';
export type RestoreStatus = 'pending' | 'ok' | 'rejected' | 'failed' | 'expired';

export interface RestoreRecord {
  id: string;
  matchSlug: string;
  mapNumber: number;
  round: number;
  transport: RestoreTransport;
  serverId: string | null;
  epoch: number | null;
  backupId: number | null;
  backupSha256: string | null;
  inline: boolean;
  commandId: string | null;
  actor: string | null;
  status: RestoreStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  answeredAt: number | null;
}

/** The audit log. Postgres in the API, memory in the unit tests. */
export interface RestoreAuditPersistence {
  insert(record: RestoreRecord): Promise<void>;
  update(
    id: string,
    patch: Partial<Pick<RestoreRecord, 'commandId' | 'status' | 'errorCode' | 'errorMessage' | 'answeredAt'>>
  ): Promise<void>;
  list(matchSlug: string, limit: number): Promise<RestoreRecord[]>;
}

/** Why a restore could not even be sent; `status` is the HTTP status for the route. */
export class RestoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}

export interface RestoreDeps {
  backups: RoundBackupStore;
  audit: RestoreAuditPersistence;
  getLiveState(matchSlug: string): Promise<LiveMatchRecord | null>;
  sendCmd(serverId: string, payload: CmdPayload, epoch: number): Promise<ReliableSendResult>;
  awaitResult(id: string, timeoutMs: number): Promise<FleetCommandRecord | null>;
  /** The match's RCON server (matches.server_id), or null. */
  rconServerFor(matchSlug: string): Promise<string | null>;
  rconRestore(serverId: string, round: number): Promise<{ success: boolean; error?: string }>;
  now(): number;
}

export interface RestoreRequest {
  matchSlug: string;
  /** Fleet map number (1-based). */
  mapNumber: number;
  round: number;
  actor: { id: string | null; name: string };
  timeoutMs?: number;
}

export interface RestoreResult {
  restore: RestoreRecord;
  /** Written to an open socket (fleet); false = queued until the server reconnects. */
  delivered: boolean;
}

/** Where a match's restores go: the fleet server of its assignment, else its RCON server. */
export async function restoreTransportFor(
  deps: Pick<RestoreDeps, 'getLiveState' | 'rconServerFor'>,
  matchSlug: string
): Promise<{ transport: RestoreTransport | null; serverId: string | null; epoch: number | null }> {
  const record = await deps.getLiveState(matchSlug);
  if (record && record.serverId && record.epoch >= 1) {
    return { transport: 'fleet', serverId: record.serverId, epoch: record.epoch };
  }
  const rcon = await deps.rconServerFor(matchSlug);
  if (rcon) return { transport: 'rcon', serverId: rcon, epoch: null };
  return { transport: null, serverId: null, epoch: null };
}

function commandStatus(record: FleetCommandRecord | null): RestoreStatus {
  if (!record || record.status === 'pending') return 'pending';
  return record.status;
}

export async function restoreRoundBackup(deps: RestoreDeps, req: RestoreRequest): Promise<RestoreResult> {
  if (!Number.isInteger(req.mapNumber) || req.mapNumber < 1 || req.mapNumber > 9) {
    throw new RestoreError('bad_args', 'mapNumber must be 1-9', 400);
  }
  if (!Number.isInteger(req.round) || req.round < 1 || req.round > 999) {
    throw new RestoreError('bad_args', 'round must be 1-999', 400);
  }
  const target = await restoreTransportFor(deps, req.matchSlug);
  if (!target.transport || !target.serverId) {
    throw new RestoreError('not_assigned', 'The match has no server to restore on', 409);
  }

  const base: RestoreRecord = {
    id: ulid(),
    matchSlug: req.matchSlug,
    mapNumber: req.mapNumber,
    round: req.round,
    transport: target.transport,
    serverId: target.serverId,
    epoch: target.epoch,
    backupId: null,
    backupSha256: null,
    inline: false,
    commandId: null,
    actor: req.actor.id,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
    createdAt: Math.floor(deps.now() / 1000),
    answeredAt: null,
  };

  if (target.transport === 'rcon') {
    await deps.audit.insert(base);
    const result = await deps.rconRestore(target.serverId, req.round);
    const done: RestoreRecord = {
      ...base,
      status: result.success ? 'ok' : 'failed',
      errorCode: result.success ? null : 'rcon',
      errorMessage: result.success ? null : (result.error ?? 'RCON command failed').slice(0, 500),
      answeredAt: Math.floor(deps.now() / 1000),
    };
    await deps.audit.update(base.id, done);
    log.info(
      `[RESTORE] ${req.matchSlug}: rcon restore to round ${req.round} on ${target.serverId} by ${req.actor.id ?? 'unknown'} -> ${done.status}`
    );
    return { restore: done, delivered: result.success };
  }

  const backup = await deps.backups.get(req.matchSlug, req.mapNumber, req.round);
  if (!backup) {
    throw new RestoreError('no_backup', `No stored backup for map ${req.mapNumber} round ${req.round}`, 404);
  }
  const inline = fitsInline(backup);
  if (!inline && backup.serverId !== target.serverId) {
    throw new RestoreError(
      'too_large',
      'This backup is too large to send inline, and the match is on another server than the one that wrote it',
      422
    );
  }
  const record: RestoreRecord = {
    ...base,
    backupId: backup.id,
    backupSha256: backup.sha256,
    inline,
  };
  await deps.audit.insert(record);

  const payload: CmdPayload = {
    match_id: req.matchSlug,
    epoch: target.epoch as number,
    name: 'restore_round',
    args: {
      map_number: req.mapNumber,
      round: req.round,
      ...(inline ? { backup: toInlineBackup(backup) } : {}),
    },
    issued_by: { user_id: (req.actor.id ?? 'unknown').slice(0, 64), name: req.actor.name.slice(0, 128), root: false },
    expires_at: deps.now() + COMMAND_TTL_MS,
    audit_id: record.id,
  };

  let sent: ReliableSendResult;
  try {
    sent = await deps.sendCmd(target.serverId, payload, target.epoch as number);
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    await deps.audit.update(record.id, {
      status: 'failed',
      errorCode: 'send_failed',
      errorMessage: message.slice(0, 500),
      answeredAt: Math.floor(deps.now() / 1000),
    });
    throw new RestoreError('send_failed', message, 500);
  }
  await deps.audit.update(record.id, { commandId: sent.id });

  const answer = await deps.awaitResult(sent.id, req.timeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS);
  const status = commandStatus(answer);
  const errorCode = answer?.result?.error?.code ?? answer?.errorCode ?? null;
  const errorMessage = answer?.result?.error?.message ?? null;
  const done: RestoreRecord = {
    ...record,
    commandId: sent.id,
    status,
    errorCode,
    errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
    answeredAt: status === 'pending' ? null : Math.floor(deps.now() / 1000),
  };
  if (status !== 'pending') {
    await deps.audit.update(record.id, {
      status,
      errorCode,
      errorMessage: done.errorMessage,
      answeredAt: done.answeredAt,
    });
  }
  log.info(
    `[RESTORE] ${req.matchSlug}: restore_round map ${req.mapNumber} round ${req.round} (backup ${backup.sha256.slice(0, 12)}${inline ? ', inline' : ''}) on ${target.serverId} epoch ${target.epoch} by ${req.actor.id ?? 'unknown'} -> ${status}${errorCode ? ` ${errorCode}` : ''}`
  );
  return { restore: done, delivered: sent.delivered };
}

/**
 * The stored backup of (match, map, round) as one `InlineBackup` part, for a
 * failover `match.assign.resume.backup`; null when there is none or it is too
 * large for one frame (then send `backup_ref` to the server that has it).
 */
export async function inlineBackupFor(
  matchSlug: string,
  mapNumber: number,
  round: number,
  store: RoundBackupStore = roundBackupStore
): Promise<InlineBackup | null> {
  const row: StoredRoundBackup | null = await store.get(matchSlug, mapNumber, round);
  return row && fitsInline(row) ? toInlineBackup(row) : null;
}

/**
 * When a restore answer arrives after the route stopped waiting: settle the
 * audit row from the command. Called from the `cmd.result` hook.
 */
export async function settleRestoreFromCommand(
  audit: RestoreAuditPersistence,
  command: FleetCommandRecord,
  now: number
): Promise<void> {
  const auditId = command.result?.audit_id;
  if (command.name !== 'restore_round' || !auditId || command.status === 'pending') return;
  await audit.update(auditId, {
    status: command.status,
    errorCode: command.result?.error?.code ?? command.errorCode ?? null,
    errorMessage: command.result?.error?.message?.slice(0, 500) ?? null,
    answeredAt: Math.floor(now / 1000),
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function createMemoryRestoreAudit(): RestoreAuditPersistence & { records: RestoreRecord[] } {
  const records: RestoreRecord[] = [];
  return {
    records,
    async insert(record) {
      records.push({ ...record });
    },
    async update(id, patch) {
      const row = records.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
    async list(slug, limit) {
      return records
        .filter((r) => r.matchSlug === slug)
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
}

interface RestoreRow {
  id: string;
  match_slug: string;
  map_number: number;
  round: number;
  transport: RestoreTransport;
  server_id: string | null;
  epoch: number | null;
  backup_id: string | number | null;
  backup_sha256: string | null;
  inline: number;
  command_id: string | null;
  actor: string | null;
  status: RestoreStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  answered_at: number | null;
}

function fromRestoreRow(row: RestoreRow): RestoreRecord {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id,
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    round: Number(row.round),
    transport: row.transport,
    serverId: row.server_id,
    epoch: n(row.epoch),
    backupId: n(row.backup_id),
    backupSha256: row.backup_sha256,
    inline: Number(row.inline) === 1,
    commandId: row.command_id,
    actor: row.actor,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: Number(row.created_at),
    answeredAt: n(row.answered_at),
  };
}

const PATCH_COLUMNS: Record<string, string> = {
  commandId: 'command_id',
  status: 'status',
  errorCode: 'error_code',
  errorMessage: 'error_message',
  answeredAt: 'answered_at',
};

export function createDbRestoreAudit(): RestoreAuditPersistence {
  return {
    async insert(r) {
      await db.runAsync(
        `INSERT INTO cs2_match_round_restores
           (id, match_slug, map_number, round, transport, server_id, epoch, backup_id, backup_sha256, inline, command_id, actor, status, error_code, error_message, created_at, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.matchSlug,
          r.mapNumber,
          r.round,
          r.transport,
          r.serverId,
          r.epoch,
          r.backupId,
          r.backupSha256,
          r.inline ? 1 : 0,
          r.commandId,
          r.actor,
          r.status,
          r.errorCode,
          r.errorMessage,
          r.createdAt,
          r.answeredAt,
        ]
      );
    },
    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
        if (key in patch) {
          sets.push(`${column} = ?`);
          params.push((patch as Record<string, unknown>)[key] ?? null);
        }
      }
      if (!sets.length) return;
      await db.runAsync(`UPDATE cs2_match_round_restores SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    },
    async list(slug, limit) {
      const rows = await db.queryAsync<RestoreRow>(
        'SELECT * FROM cs2_match_round_restores WHERE match_slug = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        [slug, limit]
      );
      return rows.map(fromRestoreRow);
    },
  };
}

export const restoreAudit = createDbRestoreAudit();

/** The API's wiring: Postgres, the live state store, `sendReliable`, RCON. */
export function defaultRestoreDeps(): RestoreDeps {
  return {
    backups: roundBackupStore,
    audit: restoreAudit,
    async getLiveState(slug) {
      const { liveStateStore } = await import('./state');
      return liveStateStore.getLiveState(slug);
    },
    async sendCmd(serverId, payload, epoch) {
      const { sendReliable } = await import('./reliable');
      return sendReliable(serverId, { type: 'cmd', payload, epoch });
    },
    async awaitResult(id, timeoutMs) {
      const { awaitCommandResult } = await import('./commands');
      return awaitCommandResult(id, timeoutMs);
    },
    async rconServerFor(slug) {
      const row = await db.queryOneAsync<{ server_id: string | null }>(
        'SELECT server_id FROM matches WHERE slug = ?',
        [slug]
      );
      return row?.server_id ?? null;
    },
    async rconRestore(serverId, round) {
      const { rconService } = await import('../services/rconService');
      const result = await rconService.sendCommand(serverId, `css_restore ${round}`);
      return { success: result.success, ...(result.error ? { error: result.error } : {}) };
    },
    now: () => Date.now(),
  };
}

let unsubscribeResults: (() => void) | null = null;

/** Settle restore audit rows whose answer came after the route stopped waiting. Idempotent. */
export function startRestoreAudit(): void {
  if (unsubscribeResults) return;
  unsubscribeResults = fleetInbound.onCommandResult((notice) => {
    if (!notice.command || notice.command.name !== 'restore_round') return;
    void settleRestoreFromCommand(restoreAudit, notice.command, Date.now()).catch((error) => {
      log.warn(`[RESTORE] settling the audit row failed: ${(error as Error).message}`);
    });
  });
}

export function stopRestoreAudit(): void {
  unsubscribeResults?.();
  unsubscribeResults = null;
}
