/**
 * The host registry (FLEET.md §18, D17): csm host agents, their `rhs_` tokens,
 * one-time host codes, the platform's outbound stream per host, the commands
 * sent to hosts with their progress and `host.result`, and `host.health`
 * reports. Tables are `cs2_fleet_host*` (migration `009-fleet-hosts`).
 *
 * Mirrors ../registry.ts (servers) on purpose: same token format rules,
 * rotation, revocation and stream bookkeeping, with a separate identity so a
 * host token never opens the server channel and the other way round.
 *
 * Secrets never touch the database in the clear: `auth.rotate` and the fleet
 * key of a `server.create` are minted when the message is written to the
 * socket (./gateway.ts), and the outbox row holds no secret.
 */

import type { PoolClient } from 'pg';
import { db } from '../../../../config/database';
import {
  enrollmentCodeHash,
  issueEnrollmentCode,
  issueFleetKey,
  issueHostToken,
  parseFleetKey,
  parseHostToken,
  ulid,
  verifySecret,
} from '../credentials';
import { CODE_TTL_S, FLEET_TENANT, KEY_LOCK_AFTER_FAILURES, OLD_TOKEN_GRACE_S, TOKEN_ROTATE_AFTER_S } from '../registry';
import type { FleetKeyRow } from '../registry';
import type { Envelope } from '../protocol/v1';
import type {
  HostEnrollRequest,
  HostHealthPayload,
  HostInventoryPayload,
  HostProgressPayload,
  HostResultPayload,
} from '../protocol/host/v1';

/** How long a fleet key minted for a `server.create` stays usable (FLEET.md §4.1 B). */
export const CREATE_KEY_TTL_S = 24 * 3600;

const nowS = () => Math.floor(Date.now() / 1000);

export type FleetHostStatus = 'pending' | 'enrolled' | 'revoked';

export interface FleetHostRow {
  id: string;
  tenant_id: string;
  machine_id: string | null;
  name: string;
  status: FleetHostStatus;
  enrolled_via: 'code' | 'key' | null;
  enrollment_key_id: string | null;
  hostname: string | null;
  os: string | null;
  csm_version: string | null;
  capabilities: string | null;
  inventory: string | null;
  inventory_at: number | null;
  protocol: number | null;
  boot_id: string | null;
  session_id: string | null;
  online: number;
  connected_at: number | null;
  last_seen: number | null;
  rx_stream_id: string | null;
  rx_seq: number;
  tx_seq: number;
  tx_acked: number;
  rotate_requested_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface FleetHostTokenRow {
  id: string;
  tenant_id: string;
  host_id: string;
  secret_hash: string;
  created_at: number;
  last_used_at: number | null;
  rotated_from: string | null;
  expires_at: number | null;
  activated_at: number | null;
  revoked_at: number | null;
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function newHostId(): string {
  return `fh_${ulid().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface FleetHostView {
  id: string;
  tenantId: string;
  name: string;
  status: FleetHostStatus;
  machineId: string | null;
  enrolledVia: 'code' | 'key' | null;
  hostname: string | null;
  os: string | null;
  csmVersion: string | null;
  capabilities: string[];
  online: boolean;
  protocol: number | null;
  connectedAt: number | null;
  lastSeen: number | null;
  createdAt: number;
  inventory: HostInventoryPayload | null;
  inventoryAt: number | null;
  token: {
    id: string;
    createdAt: number;
    lastUsedAt: number | null;
    rotationDueAt: number;
    rotationPending: boolean;
  } | null;
  rotateRequested: boolean;
  codeExpiresAt: number | null;
}

function toView(h: FleetHostRow, tokens: FleetHostTokenRow[], codeExpiresAt: number | null): FleetHostView {
  const now = nowS();
  const live = tokens.filter((t) => t.expires_at === null || t.expires_at > now);
  const newest = live[0] ?? null;
  const pending = newest?.rotated_from && newest.activated_at === null;
  return {
    id: h.id,
    tenantId: h.tenant_id,
    name: h.name,
    status: h.status,
    machineId: h.machine_id,
    enrolledVia: h.enrolled_via,
    hostname: h.hostname,
    os: h.os,
    csmVersion: h.csm_version,
    capabilities: parseJson<string[]>(h.capabilities) ?? [],
    online: h.online === 1,
    protocol: h.protocol,
    connectedAt: h.connected_at,
    lastSeen: h.last_seen,
    createdAt: h.created_at,
    inventory: parseJson<HostInventoryPayload>(h.inventory),
    inventoryAt: h.inventory_at,
    token: newest
      ? {
          id: newest.id,
          createdAt: newest.created_at,
          lastUsedAt: newest.last_used_at,
          rotationDueAt: newest.created_at + TOKEN_ROTATE_AFTER_S,
          rotationPending: !!pending,
        }
      : null,
    rotateRequested: h.rotate_requested_at !== null,
    codeExpiresAt: h.status === 'pending' && codeExpiresAt && codeExpiresAt > now ? codeExpiresAt : null,
  };
}

export async function listHosts(): Promise<FleetHostView[]> {
  const hosts = await db.queryAsync<FleetHostRow>(
    'SELECT * FROM cs2_fleet_hosts WHERE tenant_id = ? ORDER BY created_at ASC, id ASC',
    [FLEET_TENANT]
  );
  if (hosts.length === 0) return [];
  const tokens = await db.queryAsync<FleetHostTokenRow>(
    `SELECT * FROM cs2_fleet_host_tokens WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`,
    [FLEET_TENANT]
  );
  const codes = await db.queryAsync<{ host_id: string; expires_at: number }>(
    `SELECT host_id, MAX(expires_at) AS expires_at FROM cs2_fleet_host_enrollment_codes
      WHERE tenant_id = ? AND used_at IS NULL GROUP BY host_id`,
    [FLEET_TENANT]
  );
  const codeBy = new Map(codes.map((c) => [c.host_id, Number(c.expires_at)]));
  return hosts.map((h) => toView(h, tokens.filter((t) => t.host_id === h.id), codeBy.get(h.id) ?? null));
}

export async function getHostView(id: string): Promise<FleetHostView | null> {
  return (await listHosts()).find((h) => h.id === id) ?? null;
}

export async function getHost(id: string): Promise<FleetHostRow | undefined> {
  return db.queryOneAsync<FleetHostRow>('SELECT * FROM cs2_fleet_hosts WHERE id = ? AND tenant_id = ?', [
    id,
    FLEET_TENANT,
  ]);
}

// ---------------------------------------------------------------------------
// One-time host codes ("Add machine")
// ---------------------------------------------------------------------------

export interface CreatedPendingHost {
  host: FleetHostView;
  /** Shown once. */
  code: string;
  expiresAt: number;
}

async function insertCode(c: PoolClient, hostId: string, createdBy: string | null) {
  const issued = issueEnrollmentCode();
  const expiresAt = nowS() + CODE_TTL_S;
  await c.query(
    `INSERT INTO cs2_fleet_host_enrollment_codes (id, tenant_id, code_hash, host_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ulid(), FLEET_TENANT, issued.hash, hostId, createdBy, expiresAt]
  );
  return { code: issued.code, expiresAt };
}

/** A pending machine and a one-time code for `csm link <url> <code>` (FLEET.md §18.1). */
export async function createPendingHost(input: { name?: string; createdBy: string | null }): Promise<CreatedPendingHost> {
  const id = newHostId();
  const name = input.name?.trim() || `Machine ${id.slice(-6)}`;
  const issued = await tx(async (c) => {
    await c.query(`INSERT INTO cs2_fleet_hosts (id, tenant_id, name, status, created_by) VALUES ($1, $2, $3, 'pending', $4)`, [
      id,
      FLEET_TENANT,
      name,
      input.createdBy,
    ]);
    return insertCode(c, id, input.createdBy);
  });
  const host = await getHostView(id);
  if (!host) throw new Error('fleet: pending host vanished');
  return { host, ...issued };
}

export async function reissueHostCode(
  hostId: string,
  createdBy: string | null
): Promise<{ code: string; expiresAt: number } | null> {
  const host = await getHost(hostId);
  if (!host || host.status !== 'pending') return null;
  return tx(async (c) => {
    await c.query(`DELETE FROM cs2_fleet_host_enrollment_codes WHERE host_id = $1 AND used_at IS NULL`, [hostId]);
    return insertCode(c, hostId, createdBy);
  });
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export type HostEnrollOutcome =
  | { ok: true; host: FleetHostRow; token: string; reenrolled: boolean }
  | { ok: false; status: 401 | 403; code: string; error: string };

const invalid = (code: string, error: string, status: 401 | 403 = 401): HostEnrollOutcome => ({
  ok: false,
  status,
  code,
  error,
});

async function issueTokenFor(c: PoolClient, hostId: string): Promise<string> {
  const now = nowS();
  await c.query(`UPDATE cs2_fleet_host_tokens SET revoked_at = $1 WHERE host_id = $2 AND revoked_at IS NULL`, [now, hostId]);
  const issued = issueHostToken();
  await c.query(`INSERT INTO cs2_fleet_host_tokens (id, tenant_id, host_id, secret_hash, created_at) VALUES ($1, $2, $3, $4, $5)`, [
    issued.id,
    FLEET_TENANT,
    hostId,
    issued.hash,
    now,
  ]);
  return issued.value;
}

async function findByMachine(c: PoolClient, machineId: string): Promise<FleetHostRow | undefined> {
  const r = await c.query<FleetHostRow>(`SELECT * FROM cs2_fleet_hosts WHERE tenant_id = $1 AND machine_id = $2 FOR UPDATE`, [
    FLEET_TENANT,
    machineId,
  ]);
  return r.rows[0];
}

/** `POST /api/fleet/host/enroll`, after schema validation. */
export async function enrollHost(req: HostEnrollRequest): Promise<HostEnrollOutcome> {
  if (req.code !== undefined) return enrollWithCode(req);
  return enrollWithKey(req);
}

async function enrollWithCode(req: HostEnrollRequest): Promise<HostEnrollOutcome> {
  const hash = enrollmentCodeHash(req.code);
  if (!hash) return invalid('invalid_code', 'Invalid or expired enrollment code');
  const now = nowS();
  return tx(async (c) => {
    const found = await c.query<{ id: string; host_id: string; expires_at: number; used_at: number | null }>(
      `SELECT id, host_id, expires_at, used_at FROM cs2_fleet_host_enrollment_codes WHERE code_hash = $1 AND tenant_id = $2 FOR UPDATE`,
      [hash, FLEET_TENANT]
    );
    const code = found.rows[0];
    if (!code || code.used_at !== null || Number(code.expires_at) <= now) {
      return invalid('invalid_code', 'Invalid or expired enrollment code');
    }
    await c.query(`UPDATE cs2_fleet_host_enrollment_codes SET used_at = $1 WHERE id = $2`, [now, code.id]);
    const existing = await findByMachine(c, req.machine_id);
    let hostId: string;
    let reenrolled = false;
    if (existing && existing.id !== code.host_id) {
      // This machine already has a record: keep it (and its servers), drop the placeholder.
      hostId = existing.id;
      reenrolled = true;
      await c.query(`DELETE FROM cs2_fleet_hosts WHERE id = $1 AND status = 'pending'`, [code.host_id]);
    } else {
      hostId = code.host_id;
      reenrolled = !!existing;
    }
    await c.query(
      `UPDATE cs2_fleet_hosts
          SET machine_id = $2, status = 'enrolled', enrolled_via = COALESCE(enrolled_via, 'code'),
              hostname = $3, os = $4, csm_version = $5, rotate_requested_at = NULL, updated_at = $6
        WHERE id = $1`,
      [hostId, req.machine_id, req.hostname, req.os ?? null, req.csm_version ?? null, now]
    );
    const token = await issueTokenFor(c, hostId);
    const host = (await c.query<FleetHostRow>(`SELECT * FROM cs2_fleet_hosts WHERE id = $1`, [hostId])).rows[0];
    return { ok: true as const, host, token, reenrolled };
  });
}

async function enrollWithKey(req: HostEnrollRequest): Promise<HostEnrollOutcome> {
  const parsed = parseFleetKey(req.key);
  if (!parsed) return invalid('invalid_key', 'Invalid fleet enrollment key');
  const now = nowS();
  const key = await db.queryOneAsync<FleetKeyRow & { host_id: string | null }>(
    'SELECT * FROM cs2_fleet_enrollment_keys WHERE id = ? AND tenant_id = ?',
    [parsed.id, FLEET_TENANT]
  );
  if (!key) return invalid('invalid_key', 'Invalid fleet enrollment key');
  if (key.locked_at !== null) return invalid('key_locked', 'This fleet key is locked after repeated failures; create a new one', 403);
  if (!verifySecret(parsed, key.secret_hash)) {
    await db.runAsync(
      `UPDATE cs2_fleet_enrollment_keys
          SET failed_attempts = failed_attempts + 1,
              locked_at = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_at END
        WHERE id = ?`,
      [KEY_LOCK_AFTER_FAILURES, now, key.id]
    );
    return invalid('invalid_key', 'Invalid fleet enrollment key');
  }
  if (key.revoked_at !== null) return invalid('key_revoked', 'This fleet key has been revoked', 403);
  if (key.expires_at !== null && key.expires_at <= now) return invalid('key_expired', 'This fleet key has expired', 403);
  // A key the platform minted for one machine's server.create enrolls servers, not machines.
  if (key.host_id) return invalid('key_scope', 'This fleet key only enrolls servers', 403);

  return tx(async (c) => {
    const existing = await findByMachine(c, req.machine_id);
    let hostId: string;
    if (existing) {
      if (existing.status === 'revoked') {
        return invalid('host_revoked', 'This machine was revoked on the platform. An admin must remove it before it can enroll again.', 403);
      }
      hostId = existing.id;
      await c.query(
        `UPDATE cs2_fleet_hosts SET status = 'enrolled', hostname = $2, os = $3, csm_version = $4,
                rotate_requested_at = NULL, updated_at = $5 WHERE id = $1`,
        [hostId, req.hostname, req.os ?? null, req.csm_version ?? null, now]
      );
    } else {
      hostId = newHostId();
      await c.query(
        `INSERT INTO cs2_fleet_hosts (id, tenant_id, machine_id, name, status, enrolled_via, enrollment_key_id, hostname, os, csm_version, created_by)
         VALUES ($1, $2, $3, $4, 'enrolled', 'key', $5, $6, $7, $8, $9)`,
        [hostId, FLEET_TENANT, req.machine_id, req.hostname.slice(0, 120), key.id, req.hostname, req.os ?? null, req.csm_version ?? null, `fleet-key:${key.id}`]
      );
    }
    await c.query(`UPDATE cs2_fleet_enrollment_keys SET last_used_at = $1, failed_attempts = 0 WHERE id = $2`, [now, key.id]);
    const token = await issueTokenFor(c, hostId);
    const host = (await c.query<FleetHostRow>(`SELECT * FROM cs2_fleet_hosts WHERE id = $1`, [hostId])).rows[0];
    return { ok: true as const, host, token, reenrolled: !!existing };
  });
}

// ---------------------------------------------------------------------------
// Tokens: verify, revoke, rotate
// ---------------------------------------------------------------------------

export type HostTokenCheck = { ok: true; host: FleetHostRow; token: FleetHostTokenRow } | { ok: false; reason: 'bad' | 'revoked' };

/** Check an `rhs_…` token for the host WS upgrade. */
export async function verifyHostToken(value: unknown): Promise<HostTokenCheck> {
  const parsed = parseHostToken(value);
  if (!parsed) return { ok: false, reason: 'bad' };
  const token = await db.queryOneAsync<FleetHostTokenRow>('SELECT * FROM cs2_fleet_host_tokens WHERE id = ? AND tenant_id = ?', [
    parsed.id,
    FLEET_TENANT,
  ]);
  if (!token || !verifySecret(parsed, token.secret_hash)) return { ok: false, reason: 'bad' };
  const now = nowS();
  if (token.revoked_at !== null || (token.expires_at !== null && token.expires_at <= now)) return { ok: false, reason: 'revoked' };
  const host = await getHost(token.host_id);
  if (!host || host.status !== 'enrolled') return { ok: false, reason: 'revoked' };
  await db.runAsync(
    `UPDATE cs2_fleet_host_tokens SET last_used_at = ?,
            activated_at = CASE WHEN rotated_from IS NOT NULL AND activated_at IS NULL THEN ? ELSE activated_at END
      WHERE id = ?`,
    [now, now, token.id]
  );
  return { ok: true, host, token };
}

/**
 * Revoke a machine: its tokens die, its pending codes go, and the fleet keys
 * minted for its `server.create`s are revoked. Servers already enrolled keep
 * their own tokens (FLEET.md §4.1 B).
 */
export async function revokeHost(id: string): Promise<boolean> {
  const now = nowS();
  return tx(async (c) => {
    const r = await c.query(`UPDATE cs2_fleet_hosts SET status = 'revoked', online = 0, updated_at = $2 WHERE id = $1 AND tenant_id = $3`, [
      id,
      now,
      FLEET_TENANT,
    ]);
    if ((r.rowCount ?? 0) === 0) return false;
    await c.query(`UPDATE cs2_fleet_host_tokens SET revoked_at = $1 WHERE host_id = $2 AND revoked_at IS NULL`, [now, id]);
    await c.query(`DELETE FROM cs2_fleet_host_enrollment_codes WHERE host_id = $1 AND used_at IS NULL`, [id]);
    await c.query(`UPDATE cs2_fleet_enrollment_keys SET revoked_at = $1 WHERE host_id = $2 AND revoked_at IS NULL`, [now, id]);
    return true;
  });
}

export async function renameHost(id: string, name: string): Promise<boolean> {
  const r = await db.runAsync('UPDATE cs2_fleet_hosts SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [
    name,
    nowS(),
    id,
    FLEET_TENANT,
  ]);
  return r.changes > 0;
}

export async function deleteHost(id: string): Promise<boolean> {
  return tx(async (c) => {
    await c.query(`UPDATE cs2_fleet_enrollment_keys SET revoked_at = $1 WHERE host_id = $2 AND revoked_at IS NULL`, [nowS(), id]);
    const r = await c.query('DELETE FROM cs2_fleet_hosts WHERE id = $1 AND tenant_id = $2', [id, FLEET_TENANT]);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function hostsDueForRotation(): Promise<string[]> {
  const cutoff = nowS() - TOKEN_ROTATE_AFTER_S;
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT h.id FROM cs2_fleet_hosts h
      WHERE h.tenant_id = ? AND h.status = 'enrolled'
        AND (h.rotate_requested_at IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM cs2_fleet_host_tokens t
           WHERE t.host_id = h.id AND t.revoked_at IS NULL AND t.expires_at IS NULL AND t.created_at > ?))`,
    [FLEET_TENANT, cutoff]
  );
  return rows.map((r) => r.id);
}

export async function requestHostRotation(hostId: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE cs2_fleet_hosts SET rotate_requested_at = ? WHERE id = ? AND tenant_id = ? AND status = 'enrolled'`,
    [nowS(), hostId, FLEET_TENANT]
  );
  return r.changes > 0;
}

/** Start a host token rotation (same rules as ../registry.ts beginRotation). */
export async function beginHostRotation(
  hostId: string
): Promise<{ tokenId: string; oldValidUntil: number; alreadyPending: boolean } | null> {
  const now = nowS();
  return tx(async (c) => {
    const live = await c.query<FleetHostTokenRow>(
      `SELECT * FROM cs2_fleet_host_tokens WHERE host_id = $1 AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at DESC, id DESC FOR UPDATE`,
      [hostId, now]
    );
    const newest = live.rows[0];
    if (!newest) return null;
    await c.query(`UPDATE cs2_fleet_hosts SET rotate_requested_at = NULL WHERE id = $1`, [hostId]);
    if (newest.rotated_from && newest.activated_at === null) {
      const old = live.rows.find((t) => t.id === newest.rotated_from);
      return { tokenId: newest.id, oldValidUntil: (old?.expires_at ?? now + OLD_TOKEN_GRACE_S) * 1000, alreadyPending: true };
    }
    const oldValidUntil = now + OLD_TOKEN_GRACE_S;
    const issued = issueHostToken();
    await c.query(`UPDATE cs2_fleet_host_tokens SET expires_at = $1 WHERE id = $2`, [oldValidUntil, newest.id]);
    await c.query(
      `INSERT INTO cs2_fleet_host_tokens (id, tenant_id, host_id, secret_hash, created_at, rotated_from) VALUES ($1, $2, $3, $4, $5, $6)`,
      [issued.id, FLEET_TENANT, hostId, '', now, newest.id]
    );
    return { tokenId: issued.id, oldValidUntil: oldValidUntil * 1000, alreadyPending: false };
  });
}

export async function mintHostRotationSecret(tokenId: string): Promise<string | null> {
  const issued = issueHostToken(tokenId);
  const r = await db.runAsync(
    `UPDATE cs2_fleet_host_tokens SET secret_hash = ? WHERE id = ? AND revoked_at IS NULL AND rotated_from IS NOT NULL AND activated_at IS NULL`,
    [issued.hash, tokenId]
  );
  return r.changes > 0 ? issued.value : null;
}

async function confirmHostRotation(c: PoolClient, hostId: string): Promise<void> {
  await c.query(
    `UPDATE cs2_fleet_host_tokens SET activated_at = $1 WHERE host_id = $2 AND rotated_from IS NOT NULL AND activated_at IS NULL AND revoked_at IS NULL`,
    [nowS(), hostId]
  );
}

// ---------------------------------------------------------------------------
// Fleet keys for server.create (FLEET.md §4.1 B, §18.1)
// ---------------------------------------------------------------------------

/**
 * A fresh fleet key for one `server.create` on this host: at most `count`
 * servers, 24 h, revoked with the host. Minted when the command is written to
 * the socket, so the secret is never stored; a replay mints another one (the
 * earlier ones stay valid until they expire, as csm may have written one).
 */
export async function mintCreateKey(input: {
  hostId: string;
  commandId: string;
  count: number;
  namePrefix: string | null;
}): Promise<string> {
  const host = await getHost(input.hostId);
  const issued = issueFleetKey();
  await db.runAsync(
    `INSERT INTO cs2_fleet_enrollment_keys (id, tenant_id, name, secret_hash, name_prefix, max_servers, expires_at, created_by, host_id, command_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issued.id,
      FLEET_TENANT,
      `${host?.name ?? input.hostId}: server.create`.slice(0, 100),
      issued.hash,
      input.namePrefix,
      input.count,
      nowS() + CREATE_KEY_TTL_S,
      `fleet-host:${input.hostId}`,
      input.hostId,
      input.commandId,
    ]
  );
  return issued.value;
}

// ---------------------------------------------------------------------------
// Presence and stream state
// ---------------------------------------------------------------------------

export async function markAllHostsOffline(): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_hosts SET online = 0, session_id = NULL WHERE online = 1');
}

export async function markHostConnected(
  hostId: string,
  sessionId: string,
  hello: { hostname: string; os?: string; csm_version: string; capabilities?: string[]; protocol: number; boot_id: string }
): Promise<void> {
  const now = nowS();
  await db.runAsync(
    `UPDATE cs2_fleet_hosts
        SET online = 1, session_id = ?, connected_at = ?, last_seen = ?, hostname = ?, os = COALESCE(?, os),
            csm_version = ?, capabilities = ?, protocol = ?, boot_id = ?, updated_at = ?
      WHERE id = ?`,
    [
      sessionId,
      now,
      now,
      hello.hostname,
      hello.os ?? null,
      hello.csm_version,
      JSON.stringify(hello.capabilities ?? []),
      hello.protocol,
      hello.boot_id,
      now,
      hostId,
    ]
  );
}

export async function markHostSeen(hostId: string): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_hosts SET last_seen = ? WHERE id = ?', [nowS(), hostId]);
}

export async function markHostDisconnected(hostId: string, sessionId: string): Promise<void> {
  await db.runAsync(`UPDATE cs2_fleet_hosts SET online = 0, session_id = NULL, last_seen = ? WHERE id = ? AND session_id = ?`, [
    nowS(),
    hostId,
    sessionId,
  ]);
}

export interface HostStreamState {
  rxStreamId: string | null;
  rxSeq: number;
  txSeq: number;
  txAcked: number;
}

export async function getHostStreamState(hostId: string): Promise<HostStreamState> {
  const row = await db.queryOneAsync<Pick<FleetHostRow, 'rx_stream_id' | 'rx_seq' | 'tx_seq' | 'tx_acked'>>(
    'SELECT rx_stream_id, rx_seq, tx_seq, tx_acked FROM cs2_fleet_hosts WHERE id = ?',
    [hostId]
  );
  return {
    rxStreamId: row?.rx_stream_id ?? null,
    rxSeq: Number(row?.rx_seq ?? 0),
    txSeq: Number(row?.tx_seq ?? 0),
    txAcked: Number(row?.tx_acked ?? 0),
  };
}

export async function setHostRxState(hostId: string, streamId: string, rxSeq: number, c?: PoolClient): Promise<void> {
  if (c) {
    await c.query('UPDATE cs2_fleet_hosts SET rx_stream_id = $1, rx_seq = $2 WHERE id = $3', [streamId, rxSeq, hostId]);
    return;
  }
  await db.runAsync('UPDATE cs2_fleet_hosts SET rx_stream_id = ?, rx_seq = ? WHERE id = ?', [streamId, rxSeq, hostId]);
}

export async function ensureHostTxSeqAtLeast(hostId: string, seq: number): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_hosts SET tx_seq = GREATEST(tx_seq, ?) WHERE id = ?', [seq, hostId]);
}

export async function appendHostOutbox(
  hostId: string,
  message: { id?: string; type: string; payload: Record<string, unknown> }
): Promise<Envelope> {
  return tx(async (c) => {
    const r = await c.query<{ tx_seq: number }>(`UPDATE cs2_fleet_hosts SET tx_seq = tx_seq + 1 WHERE id = $1 RETURNING tx_seq`, [hostId]);
    const seq = r.rows[0]?.tx_seq;
    if (!seq) throw new Error(`fleet: unknown host ${hostId}`);
    const envelope: Envelope = {
      v: 1,
      type: message.type,
      id: message.id ?? ulid(),
      seq: Number(seq),
      ts: Date.now(),
      payload: message.payload,
    };
    await c.query(`INSERT INTO cs2_fleet_host_outbox (host_id, seq, type, message) VALUES ($1, $2, $3, $4)`, [
      hostId,
      envelope.seq,
      envelope.type,
      JSON.stringify(envelope),
    ]);
    await c.query(`UPDATE cs2_fleet_host_commands SET seq = $1 WHERE message_id = $2`, [envelope.seq, envelope.id]);
    return envelope;
  });
}

/**
 * The machine's agent lost its stream state (linked again, reinstalled, or
 * another csm user on the same machine): it says it has received only up to
 * `lastRx`, below what the platform already had acknowledged. It takes
 * commands strictly in order, so the next one (after the old numbering) was
 * never delivered: it waited for messages that no longer exist, and the
 * command stayed "in progress" forever (csm #108). Renumber what is still
 * queued from `lastRx + 1` and carry on from there. Returns how many queued
 * messages were renumbered.
 */
export async function rebaseHostTx(hostId: string, lastRx: number): Promise<number> {
  return tx(async (c) => {
    const rows = (
      await c.query<{ message: string }>('SELECT message FROM cs2_fleet_host_outbox WHERE host_id = $1 ORDER BY seq ASC', [hostId])
    ).rows;
    await c.query('DELETE FROM cs2_fleet_host_outbox WHERE host_id = $1', [hostId]);
    let seq = lastRx;
    for (const row of rows) {
      seq += 1;
      const envelope = JSON.parse(row.message) as Envelope;
      envelope.seq = seq;
      await c.query(`INSERT INTO cs2_fleet_host_outbox (host_id, seq, type, message) VALUES ($1, $2, $3, $4)`, [
        hostId,
        seq,
        envelope.type,
        JSON.stringify(envelope),
      ]);
      await c.query(`UPDATE cs2_fleet_host_commands SET seq = $1 WHERE message_id = $2`, [seq, envelope.id]);
    }
    await c.query('UPDATE cs2_fleet_hosts SET tx_seq = $2, tx_acked = $3 WHERE id = $1', [hostId, seq, lastRx]);
    return rows.length;
  });
}

export async function pendingHostOutbox(hostId: string, afterSeq: number): Promise<Envelope[]> {
  const rows = await db.queryAsync<{ message: string }>(
    'SELECT message FROM cs2_fleet_host_outbox WHERE host_id = ? AND seq > ? ORDER BY seq ASC',
    [hostId, afterSeq]
  );
  return rows.map((r) => JSON.parse(r.message) as Envelope);
}

export async function ackHostOutbox(hostId: string, ack: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`DELETE FROM cs2_fleet_host_outbox WHERE host_id = $1 AND seq <= $2`, [hostId, ack]);
    await c.query(`UPDATE cs2_fleet_hosts SET tx_acked = GREATEST(tx_acked, $2) WHERE id = $1`, [hostId, ack]);
  });
}

// ---------------------------------------------------------------------------
// Host → platform messages (applied inside the caller's transaction)
// ---------------------------------------------------------------------------

export async function applyInventory(c: PoolClient, hostId: string, payload: HostInventoryPayload): Promise<void> {
  await c.query(
    `UPDATE cs2_fleet_hosts SET inventory = $1, inventory_at = $2, hostname = $3, csm_version = $4, os = $5, last_seen = $2 WHERE id = $6`,
    [JSON.stringify(payload), nowS(), payload.hostname, payload.csm_version, payload.os, hostId]
  );
}

/** Store a host.health report; false when this (stream, seq) was already stored. */
export async function applyHealth(
  c: PoolClient,
  hostId: string,
  streamId: string | null,
  seq: number | null,
  payload: HostHealthPayload
): Promise<boolean> {
  const r = await c.query(
    `INSERT INTO cs2_fleet_host_events (host_id, stream_id, seq, server, event, exit_code, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [hostId, streamId, seq, payload.server, payload.event, payload.exit_code ?? null, payload.detail ?? null]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function applyResult(
  c: PoolClient,
  hostId: string,
  ref: string,
  payload: HostResultPayload
): Promise<HostCommandRecord | null> {
  const r = await c.query<HostCommandRow>(
    `UPDATE cs2_fleet_host_commands
        SET status = $1, error_code = $2, error_message = $3, output = $4, answered_at = $5,
            progress_pct = CASE WHEN $1 = 'ok' THEN 100 ELSE progress_pct END
      WHERE message_id = $6 AND host_id = $7 RETURNING *`,
    [payload.status, payload.error?.code ?? null, payload.error?.message ?? null, payload.output ?? null, nowS(), ref, hostId]
  );
  return r.rows[0] ? commandFromRow(r.rows[0]) : null;
}

export async function applyProgress(c: PoolClient, hostId: string, payload: HostProgressPayload): Promise<HostCommandRecord | null> {
  const r = await c.query<HostCommandRow>(
    `UPDATE cs2_fleet_host_commands SET progress_step = $1, progress_pct = COALESCE($2, progress_pct), progress_at = $3
      WHERE message_id = $4 AND host_id = $5 AND status = 'pending' RETURNING *`,
    [payload.step, payload.pct ?? null, nowS(), payload.ref, hostId]
  );
  return r.rows[0] ? commandFromRow(r.rows[0]) : null;
}

export { confirmHostRotation };

export interface HostHealthRecord {
  id: number;
  server: string;
  event: string;
  exitCode: number | null;
  detail: string | null;
  receivedAt: number;
}

export async function listHealth(hostId: string, limit = 20): Promise<HostHealthRecord[]> {
  const rows = await db.queryAsync<{
    id: number;
    server: string;
    event: string;
    exit_code: number | null;
    detail: string | null;
    received_at: number;
  }>('SELECT * FROM cs2_fleet_host_events WHERE host_id = ? ORDER BY id DESC LIMIT ?', [hostId, limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    server: r.server,
    event: r.event,
    exitCode: r.exit_code,
    detail: r.detail,
    receivedAt: Number(r.received_at),
  }));
}

// ---------------------------------------------------------------------------
// Commands (platform → host) and their answers
// ---------------------------------------------------------------------------

export type HostCommandStatus = 'pending' | 'ok' | 'rejected' | 'failed';

export interface HostCommandRecord {
  id: string;
  hostId: string;
  seq: number | null;
  type: string;
  server: string | null;
  payload: Record<string, unknown>;
  status: HostCommandStatus;
  errorCode: string | null;
  errorMessage: string | null;
  output: string | null;
  progress: { step: string | null; pct: number | null; at: number | null };
  issuedBy: string | null;
  forcedBy: string | null;
  forceReason: string | null;
  /** What the platform keeps with the command (server.create: the servers before it, its follow-up). */
  meta: Record<string, unknown> | null;
  createdAt: number;
  answeredAt: number | null;
}

interface HostCommandRow {
  message_id: string;
  host_id: string;
  seq: number | null;
  type: string;
  server: string | null;
  payload: string;
  status: HostCommandStatus;
  error_code: string | null;
  error_message: string | null;
  output: string | null;
  progress_step: string | null;
  progress_pct: number | null;
  progress_at: number | null;
  issued_by: string | null;
  forced_by: string | null;
  force_reason: string | null;
  meta: string | null;
  created_at: number;
  answered_at: number | null;
}

function commandFromRow(row: HostCommandRow): HostCommandRecord {
  return {
    id: row.message_id,
    hostId: row.host_id,
    seq: row.seq === null ? null : Number(row.seq),
    type: row.type,
    server: row.server,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    output: row.output,
    progress: {
      step: row.progress_step,
      pct: row.progress_pct === null ? null : Number(row.progress_pct),
      at: row.progress_at === null ? null : Number(row.progress_at),
    },
    issuedBy: row.issued_by,
    forcedBy: row.forced_by,
    forceReason: row.force_reason,
    meta: parseJson<Record<string, unknown>>(row.meta),
    createdAt: Number(row.created_at),
    answeredAt: row.answered_at === null ? null : Number(row.answered_at),
  };
}

export async function recordHostCommand(input: {
  id: string;
  hostId: string;
  type: string;
  server: string | null;
  payload: Record<string, unknown>;
  issuedBy: string | null;
  forcedBy: string | null;
  forceReason: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_host_commands (message_id, host_id, type, server, payload, status, issued_by, forced_by, force_reason, meta, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.hostId,
      input.type,
      input.server,
      JSON.stringify(input.payload),
      input.issuedBy,
      input.forcedBy,
      input.forceReason,
      input.meta ? JSON.stringify(input.meta) : null,
      nowS(),
    ]
  );
}

/** Merge `patch` into a command's meta. */
export async function mergeHostCommandMeta(id: string, patch: Record<string, unknown>): Promise<void> {
  const current = await getHostCommand(id);
  if (!current) return;
  await db.runAsync('UPDATE cs2_fleet_host_commands SET meta = ? WHERE message_id = ?', [
    JSON.stringify({ ...(current.meta ?? {}), ...patch }),
    id,
  ]);
}

export async function getHostCommand(id: string): Promise<HostCommandRecord | null> {
  const row = await db.queryOneAsync<HostCommandRow>('SELECT * FROM cs2_fleet_host_commands WHERE message_id = ?', [id]);
  return row ? commandFromRow(row) : null;
}

export async function listHostCommands(hostId: string, limit = 25): Promise<HostCommandRecord[]> {
  const rows = await db.queryAsync<HostCommandRow>(
    'SELECT * FROM cs2_fleet_host_commands WHERE host_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?',
    [hostId, limit]
  );
  return rows.map(commandFromRow);
}

/**
 * Fail the commands csm went quiet on while its machine was online: no
 * answer and no progress for `notStartedS` seconds after it was sent (or the
 * machine came back), or `stalledS` seconds since its last progress. A
 * command to an offline machine waits; it is sent when the machine connects.
 * An answer that arrives later still replaces the timeout (applyResult).
 */
export async function timeOutQuietCommands(limits: { notStartedS: number; stalledS: number }): Promise<HostCommandRecord[]> {
  const now = nowS();
  const rows = await db.queryAsync<HostCommandRow>(
    `UPDATE cs2_fleet_host_commands c
        SET status = 'failed', error_code = 'timeout', answered_at = ?,
            error_message = CASE WHEN c.progress_at IS NULL
              THEN 'The machine is online, but csm never started the command. Check that csm is running and up to date, then try again.'
              ELSE 'csm stopped reporting progress' || COALESCE(' at "' || c.progress_step || '"', '') || '. Check the machine, then try again.'
            END
       FROM cs2_fleet_hosts h
      WHERE c.host_id = h.id AND c.status = 'pending' AND h.online = 1
        AND (
          (c.progress_at IS NULL AND GREATEST(c.created_at, COALESCE(h.connected_at, 0)) < ?)
          OR (c.progress_at IS NOT NULL AND GREATEST(c.progress_at, COALESCE(h.connected_at, 0)) < ?)
        )
      RETURNING c.*`,
    [now, now - limits.notStartedS, now - limits.stalledS]
  );
  return rows.map(commandFromRow);
}
