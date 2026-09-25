/**
 * The fleet registry: Ready Up servers, their tokens, enrollment codes and
 * fleet keys, and the platform's outbound stream per server (FLEET.md §4,
 * §6.4, §19.2 items 1-2). Tables are `cs2_fleet_*` (migration `005-fleet`).
 *
 * Secrets never touch the database in the clear: tokens, keys and codes are
 * stored as sha256 of their secret part (./credentials). The one message that
 * carries a secret, `auth.rotate`, is stored in the outbox with the token id
 * only and gets a freshly minted secret each time it is sent
 * (`mintRotationSecret`).
 */

import type { PoolClient } from 'pg';
import { db } from '../../../config/database';
import {
  enrollmentCodeHash,
  issueEnrollmentCode,
  issueFleetKey,
  issueServerToken,
  parseFleetKey,
  parseServerToken,
  ulid,
  verifySecret,
} from './credentials';
import type { EnrollRequest, Envelope, HostInfo, Versions } from './protocol/v1';

export const FLEET_TENANT = 'default';
/** One-time code lifetime (FLEET.md §4.1). */
export const CODE_TTL_S = 15 * 60;
/** Tokens are rotated after this long (D3). */
export const TOKEN_ROTATE_AFTER_S = 90 * 24 * 3600;
/** Both tokens work this long after a rotation starts (FLEET.md §4.3). */
export const OLD_TOKEN_GRACE_S = 24 * 3600;
/** A fleet key is locked after this many wrong secrets (FLEET.md §15). */
export const KEY_LOCK_AFTER_FAILURES = 5;

const nowS = () => Math.floor(Date.now() / 1000);

export type FleetServerStatus = 'pending' | 'enrolled' | 'revoked';

export interface FleetServerRow {
  id: string;
  tenant_id: string;
  install_id: string | null;
  name: string;
  status: FleetServerStatus;
  enrolled_via: 'code' | 'key' | null;
  enrollment_key_id: string | null;
  availability: string | null;
  versions: string | null;
  capabilities: string | null;
  host: string | null;
  health: string | null;
  selftest: string | null;
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

export interface FleetTokenRow {
  id: string;
  tenant_id: string;
  server_id: string;
  secret_hash: string;
  created_at: number;
  last_used_at: number | null;
  rotated_from: string | null;
  expires_at: number | null;
  activated_at: number | null;
  revoked_at: number | null;
}

export interface FleetKeyRow {
  id: string;
  tenant_id: string;
  name: string;
  secret_hash: string;
  name_prefix: string | null;
  max_servers: number | null;
  expires_at: number | null;
  created_by: string | null;
  created_at: number;
  last_used_at: number | null;
  use_count: number;
  failed_attempts: number;
  locked_at: number | null;
  revoked_at: number | null;
}

async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

function newServerId(): string {
  return `fs_${ulid().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Views for the admin API (no hashes)
// ---------------------------------------------------------------------------

export interface FleetServerView {
  id: string;
  tenantId: string;
  name: string;
  status: FleetServerStatus;
  installId: string | null;
  enrolledVia: 'code' | 'key' | null;
  enrollmentKeyId: string | null;
  online: boolean;
  availability: string | null;
  versions: Versions | null;
  capabilities: string[];
  host: HostInfo | null;
  health: Record<string, unknown> | null;
  selftest: Record<string, unknown> | null;
  protocol: number | null;
  connectedAt: number | null;
  lastSeen: number | null;
  createdAt: number;
  token: {
    id: string;
    createdAt: number;
    lastUsedAt: number | null;
    rotationDueAt: number;
    rotationPending: boolean;
  } | null;
  rotateRequested: boolean;
  /** A pending server's code is still usable until then (the code itself is never shown again). */
  codeExpiresAt: number | null;
}

export async function listFleetServers(): Promise<FleetServerView[]> {
  const servers = await db.queryAsync<FleetServerRow>(
    'SELECT * FROM cs2_fleet_servers WHERE tenant_id = ? ORDER BY created_at ASC, id ASC',
    [FLEET_TENANT]
  );
  if (servers.length === 0) return [];
  const tokens = await db.queryAsync<FleetTokenRow>(
    `SELECT * FROM cs2_fleet_tokens
      WHERE tenant_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC`,
    [FLEET_TENANT]
  );
  const codes = await db.queryAsync<{ server_id: string; expires_at: number }>(
    `SELECT server_id, MAX(expires_at) AS expires_at FROM cs2_fleet_enrollment_codes
      WHERE tenant_id = ? AND used_at IS NULL GROUP BY server_id`,
    [FLEET_TENANT]
  );
  const codeBy = new Map(codes.map((c) => [c.server_id, Number(c.expires_at)]));
  return servers.map((s) => toView(s, tokens.filter((t) => t.server_id === s.id), codeBy.get(s.id) ?? null));
}

export async function getFleetServerView(id: string): Promise<FleetServerView | null> {
  return (await listFleetServers()).find((s) => s.id === id) ?? null;
}

function toView(s: FleetServerRow, tokens: FleetTokenRow[], codeExpiresAt: number | null): FleetServerView {
  const now = nowS();
  const live = tokens.filter((t) => t.expires_at === null || t.expires_at > now);
  const newest = live[0] ?? null;
  const pending = newest?.rotated_from && newest.activated_at === null;
  return {
    id: s.id,
    tenantId: s.tenant_id,
    name: s.name,
    status: s.status,
    installId: s.install_id,
    enrolledVia: s.enrolled_via,
    enrollmentKeyId: s.enrollment_key_id,
    online: s.online === 1,
    availability: s.availability,
    versions: parseJson<Versions>(s.versions),
    capabilities: parseJson<string[]>(s.capabilities) ?? [],
    host: parseJson<HostInfo>(s.host),
    health: parseJson<Record<string, unknown>>(s.health),
    selftest: parseJson<Record<string, unknown>>(s.selftest),
    protocol: s.protocol,
    connectedAt: s.connected_at,
    lastSeen: s.last_seen,
    createdAt: s.created_at,
    token: newest
      ? {
          id: newest.id,
          createdAt: newest.created_at,
          lastUsedAt: newest.last_used_at,
          rotationDueAt: newest.created_at + TOKEN_ROTATE_AFTER_S,
          rotationPending: !!pending,
        }
      : null,
    rotateRequested: s.rotate_requested_at !== null,
    codeExpiresAt: s.status === 'pending' && codeExpiresAt && codeExpiresAt > now ? codeExpiresAt : null,
  };
}

export async function getFleetServer(id: string): Promise<FleetServerRow | undefined> {
  return db.queryOneAsync<FleetServerRow>('SELECT * FROM cs2_fleet_servers WHERE id = ? AND tenant_id = ?', [
    id,
    FLEET_TENANT,
  ]);
}

// ---------------------------------------------------------------------------
// One-time codes (UI: "Add server")
// ---------------------------------------------------------------------------

export interface CreatedPendingServer {
  server: FleetServerView;
  /** Shown once. */
  code: string;
  expiresAt: number;
}

/** A pending server record and a one-time code for it (FLEET.md §4.1 A). */
export async function createPendingServer(input: {
  name?: string;
  createdBy: string | null;
}): Promise<CreatedPendingServer> {
  const id = newServerId();
  const issued = issueEnrollmentCode();
  const expiresAt = nowS() + CODE_TTL_S;
  const name = input.name?.trim() || `Server ${id.slice(-6)}`;
  await tx(async (c) => {
    await c.query(
      `INSERT INTO cs2_fleet_servers (id, tenant_id, name, status, created_by) VALUES ($1, $2, $3, 'pending', $4)`,
      [id, FLEET_TENANT, name, input.createdBy]
    );
    await c.query(
      `INSERT INTO cs2_fleet_enrollment_codes (id, tenant_id, code_hash, server_id, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ulid(), FLEET_TENANT, issued.hash, id, input.createdBy, expiresAt]
    );
  });
  const server = await getFleetServerView(id);
  if (!server) throw new Error('fleet: pending server vanished');
  return { server, code: issued.code, expiresAt };
}

/** A fresh code for a server that is still pending (the old one expired or was lost). */
export async function reissueCode(serverId: string, createdBy: string | null): Promise<{ code: string; expiresAt: number } | null> {
  const server = await getFleetServer(serverId);
  if (!server || server.status !== 'pending') return null;
  const issued = issueEnrollmentCode();
  const expiresAt = nowS() + CODE_TTL_S;
  await tx(async (c) => {
    await c.query(`DELETE FROM cs2_fleet_enrollment_codes WHERE server_id = $1 AND used_at IS NULL`, [serverId]);
    await c.query(
      `INSERT INTO cs2_fleet_enrollment_codes (id, tenant_id, code_hash, server_id, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ulid(), FLEET_TENANT, issued.hash, serverId, createdBy, expiresAt]
    );
  });
  return { code: issued.code, expiresAt };
}

// ---------------------------------------------------------------------------
// Fleet keys (Settings → Fleet)
// ---------------------------------------------------------------------------

export interface FleetKeyView {
  id: string;
  name: string;
  namePrefix: string | null;
  maxServers: number | null;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
  enrolledServers: number;
  locked: boolean;
  revoked: boolean;
}

export async function listFleetKeys(): Promise<FleetKeyView[]> {
  const rows = await db.queryAsync<FleetKeyRow & { enrolled: string }>(
    `SELECT k.*, (SELECT COUNT(*) FROM cs2_fleet_servers s WHERE s.enrollment_key_id = k.id) AS enrolled
       FROM cs2_fleet_enrollment_keys k WHERE k.tenant_id = ? ORDER BY k.created_at ASC, k.id ASC`,
    [FLEET_TENANT]
  );
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    namePrefix: k.name_prefix,
    maxServers: k.max_servers,
    expiresAt: k.expires_at,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    useCount: k.use_count,
    enrolledServers: Number(k.enrolled),
    locked: k.locked_at !== null,
    revoked: k.revoked_at !== null,
  }));
}

export async function createFleetKey(input: {
  name: string;
  namePrefix?: string | null;
  maxServers?: number | null;
  expiresAt?: number | null;
  createdBy: string | null;
}): Promise<{ key: FleetKeyView; value: string }> {
  const issued = issueFleetKey();
  await db.runAsync(
    `INSERT INTO cs2_fleet_enrollment_keys (id, tenant_id, name, secret_hash, name_prefix, max_servers, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issued.id,
      FLEET_TENANT,
      input.name,
      issued.hash,
      input.namePrefix ?? null,
      input.maxServers ?? null,
      input.expiresAt ?? null,
      input.createdBy,
    ]
  );
  const key = (await listFleetKeys()).find((k) => k.id === issued.id);
  if (!key) throw new Error('fleet: key vanished');
  return { key, value: issued.value };
}

/** Revoke a key. Servers it already enrolled keep their tokens (FLEET.md §4.1 B). */
export async function revokeFleetKey(id: string): Promise<boolean> {
  const result = await db.runAsync(
    'UPDATE cs2_fleet_enrollment_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL',
    [nowS(), id, FLEET_TENANT]
  );
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export type EnrollOutcome =
  | { ok: true; server: FleetServerRow; token: string; reenrolled: boolean }
  | { ok: false; status: 401 | 403 | 409; code: string; error: string };

const invalid = (code: string, error: string, status: 401 | 403 | 409 = 401): EnrollOutcome => ({
  ok: false,
  status,
  code,
  error,
});

async function issueTokenFor(c: PoolClient, serverId: string): Promise<string> {
  const now = nowS();
  // A (re-)enrollment replaces every token the server had.
  await c.query(`UPDATE cs2_fleet_tokens SET revoked_at = $1 WHERE server_id = $2 AND revoked_at IS NULL`, [now, serverId]);
  const issued = issueServerToken();
  await c.query(
    `INSERT INTO cs2_fleet_tokens (id, tenant_id, server_id, secret_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [issued.id, FLEET_TENANT, serverId, issued.hash, now]
  );
  return issued.value;
}

function describeHost(req: EnrollRequest): { host: string; versions: string | null } {
  const versions = req.versions
    ? { ...req.versions, ...(req.cs2_build !== undefined && req.versions.cs2_build === undefined ? { cs2_build: req.cs2_build } : {}) }
    : req.cs2_build !== undefined
      ? { cs2_build: req.cs2_build }
      : null;
  return { host: JSON.stringify(req.host), versions: versions ? JSON.stringify(versions) : null };
}

async function findByInstall(c: PoolClient, installId: string): Promise<FleetServerRow | undefined> {
  const r = await c.query<FleetServerRow>(
    `SELECT * FROM cs2_fleet_servers WHERE tenant_id = $1 AND install_id = $2 FOR UPDATE`,
    [FLEET_TENANT, installId]
  );
  return r.rows[0];
}

/**
 * `POST /api/fleet/enroll`, after schema validation. Returns the server
 * record and its new token, or why not. The code or key is checked first; a
 * known `install_id` gets its existing record back (and a new token).
 */
export async function enrollServer(req: EnrollRequest): Promise<EnrollOutcome> {
  if (req.code !== undefined) return enrollWithCode(req);
  return enrollWithKey(req);
}

async function enrollWithCode(req: EnrollRequest): Promise<EnrollOutcome> {
  const hash = enrollmentCodeHash(req.code);
  if (!hash) return invalid('invalid_code', 'Invalid or expired enrollment code');
  const now = nowS();
  return tx(async (c) => {
    const found = await c.query<{ id: string; server_id: string; expires_at: number; used_at: number | null }>(
      `SELECT id, server_id, expires_at, used_at FROM cs2_fleet_enrollment_codes
        WHERE code_hash = $1 AND tenant_id = $2 FOR UPDATE`,
      [hash, FLEET_TENANT]
    );
    const code = found.rows[0];
    if (!code || code.used_at !== null || Number(code.expires_at) <= now) {
      return invalid('invalid_code', 'Invalid or expired enrollment code');
    }
    await c.query(`UPDATE cs2_fleet_enrollment_codes SET used_at = $1 WHERE id = $2`, [now, code.id]);
    const { host, versions } = describeHost(req);

    const existing = await findByInstall(c, req.install_id);
    let serverId: string;
    let reenrolled = false;
    if (existing && existing.id !== code.server_id) {
      // This install already has a record: keep it, drop the placeholder the code made.
      serverId = existing.id;
      reenrolled = true;
      await c.query(`DELETE FROM cs2_fleet_servers WHERE id = $1 AND status = 'pending'`, [code.server_id]);
    } else {
      serverId = code.server_id;
      reenrolled = !!existing;
    }
    await c.query(
      `UPDATE cs2_fleet_servers
          SET install_id = $2, status = 'enrolled', enrolled_via = COALESCE(enrolled_via, 'code'),
              host = $3, versions = COALESCE($4, versions), rotate_requested_at = NULL, updated_at = $5
        WHERE id = $1`,
      [serverId, req.install_id, host, versions, now]
    );
    const token = await issueTokenFor(c, serverId);
    const server = (await c.query<FleetServerRow>(`SELECT * FROM cs2_fleet_servers WHERE id = $1`, [serverId])).rows[0];
    return { ok: true as const, server, token, reenrolled };
  });
}

async function enrollWithKey(req: EnrollRequest): Promise<EnrollOutcome> {
  const parsed = parseFleetKey(req.key);
  if (!parsed) return invalid('invalid_key', 'Invalid fleet enrollment key');
  const now = nowS();
  // The failed-attempt counter must survive the rejection, so it is written
  // outside the enrollment transaction.
  const key = await db.queryOneAsync<FleetKeyRow>(
    'SELECT * FROM cs2_fleet_enrollment_keys WHERE id = ? AND tenant_id = ?',
    [parsed.id, FLEET_TENANT]
  );
  if (!key) return invalid('invalid_key', 'Invalid fleet enrollment key');
  if (key.locked_at !== null) {
    return invalid('key_locked', 'This fleet key is locked after repeated failures; create a new one', 403);
  }
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

  return tx(async (c) => {
    const { host, versions } = describeHost(req);
    const existing = await findByInstall(c, req.install_id);
    let serverId: string;
    if (existing) {
      if (existing.status === 'revoked') {
        return invalid(
          'server_revoked',
          'This server was revoked on the platform. An admin must delete it before it can enroll again.',
          403
        );
      }
      serverId = existing.id;
      await c.query(
        `UPDATE cs2_fleet_servers SET status = 'enrolled', host = $2, versions = COALESCE($3, versions),
                rotate_requested_at = NULL, updated_at = $4 WHERE id = $1`,
        [serverId, host, versions, now]
      );
    } else {
      if (key.max_servers !== null) {
        const count = await c.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM cs2_fleet_servers WHERE enrollment_key_id = $1`,
          [key.id]
        );
        if (Number(count.rows[0]?.n ?? 0) >= key.max_servers) {
          return invalid('key_limit', `This fleet key's limit of ${key.max_servers} server(s) is reached`, 409);
        }
      }
      serverId = newServerId();
      const base = req.name?.trim() || `${req.host.hostname}:${req.host.game_port}`;
      const name = `${key.name_prefix ?? ''}${base}`.slice(0, 120);
      await c.query(
        `INSERT INTO cs2_fleet_servers (id, tenant_id, install_id, name, status, enrolled_via, enrollment_key_id, host, versions, created_by)
         VALUES ($1, $2, $3, $4, 'enrolled', 'key', $5, $6, $7, $8)`,
        [serverId, FLEET_TENANT, req.install_id, name, key.id, host, versions, `fleet-key:${key.id}`]
      );
    }
    await c.query(
      `UPDATE cs2_fleet_enrollment_keys SET use_count = use_count + 1, last_used_at = $1, failed_attempts = 0 WHERE id = $2`,
      [now, key.id]
    );
    const token = await issueTokenFor(c, serverId);
    const server = (await c.query<FleetServerRow>(`SELECT * FROM cs2_fleet_servers WHERE id = $1`, [serverId])).rows[0];
    return { ok: true as const, server, token, reenrolled: !!existing };
  });
}

// ---------------------------------------------------------------------------
// Token verification, revocation, rotation
// ---------------------------------------------------------------------------

export type TokenCheck =
  | { ok: true; server: FleetServerRow; token: FleetTokenRow }
  | { ok: false; reason: 'bad' | 'revoked' };

/** Check a `rus_…` token for the WS upgrade (FLEET.md §4.2). */
export async function verifyServerToken(value: unknown): Promise<TokenCheck> {
  const parsed = parseServerToken(value);
  if (!parsed) return { ok: false, reason: 'bad' };
  const token = await db.queryOneAsync<FleetTokenRow>(
    'SELECT * FROM cs2_fleet_tokens WHERE id = ? AND tenant_id = ?',
    [parsed.id, FLEET_TENANT]
  );
  if (!token || !verifySecret(parsed, token.secret_hash)) return { ok: false, reason: 'bad' };
  const now = nowS();
  if (token.revoked_at !== null || (token.expires_at !== null && token.expires_at <= now)) {
    return { ok: false, reason: 'revoked' };
  }
  const server = await getFleetServer(token.server_id);
  if (!server || server.status !== 'enrolled') return { ok: false, reason: 'revoked' };
  await db.runAsync(
    `UPDATE cs2_fleet_tokens SET last_used_at = ?,
            activated_at = CASE WHEN rotated_from IS NOT NULL AND activated_at IS NULL THEN ? ELSE activated_at END
      WHERE id = ?`,
    [now, now, token.id]
  );
  return { ok: true, server, token };
}

/** Revoke a server: every token dies and it may not re-enroll with a key (FLEET.md §4.3). */
export async function revokeFleetServer(id: string): Promise<boolean> {
  const now = nowS();
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE cs2_fleet_servers SET status = 'revoked', online = 0, updated_at = $2 WHERE id = $1 AND tenant_id = $3`,
      [id, now, FLEET_TENANT]
    );
    if ((r.rowCount ?? 0) === 0) return false;
    await c.query(`UPDATE cs2_fleet_tokens SET revoked_at = $1 WHERE server_id = $2 AND revoked_at IS NULL`, [now, id]);
    await c.query(`DELETE FROM cs2_fleet_enrollment_codes WHERE server_id = $1 AND used_at IS NULL`, [id]);
    return true;
  });
}

export async function renameFleetServer(id: string, name: string): Promise<boolean> {
  const r = await db.runAsync('UPDATE cs2_fleet_servers SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [
    name,
    nowS(),
    id,
    FLEET_TENANT,
  ]);
  return r.changes > 0;
}

export async function deleteFleetServer(id: string): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM cs2_fleet_servers WHERE id = ? AND tenant_id = ?', [id, FLEET_TENANT]);
  return r.changes > 0;
}

/** Enrolled servers whose newest token is due for rotation (or an admin asked for one). */
export async function serversDueForRotation(): Promise<string[]> {
  const cutoff = nowS() - TOKEN_ROTATE_AFTER_S;
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT s.id FROM cs2_fleet_servers s
      WHERE s.tenant_id = ? AND s.status = 'enrolled'
        AND (s.rotate_requested_at IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM cs2_fleet_tokens t
           WHERE t.server_id = s.id AND t.revoked_at IS NULL AND t.expires_at IS NULL AND t.created_at > ?))`,
    [FLEET_TENANT, cutoff]
  );
  return rows.map((r) => r.id);
}

export async function requestRotation(serverId: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE cs2_fleet_servers SET rotate_requested_at = ? WHERE id = ? AND tenant_id = ? AND status = 'enrolled'`,
    [nowS(), serverId, FLEET_TENANT]
  );
  return r.changes > 0;
}

/**
 * Start a rotation: a new token id that replaces the current one, and the
 * current one set to expire in 24 h. The new token's secret is minted when
 * `auth.rotate` is sent (`mintRotationSecret`), never stored in the clear.
 * Reuses a rotation that is already pending rather than stacking them.
 */
export async function beginRotation(
  serverId: string
): Promise<{ tokenId: string; oldValidUntil: number; alreadyPending: boolean } | null> {
  const now = nowS();
  return tx(async (c) => {
    const live = await c.query<FleetTokenRow>(
      `SELECT * FROM cs2_fleet_tokens WHERE server_id = $1 AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at DESC, id DESC FOR UPDATE`,
      [serverId, now]
    );
    const newest = live.rows[0];
    if (!newest) return null;
    await c.query(`UPDATE cs2_fleet_servers SET rotate_requested_at = NULL WHERE id = $1`, [serverId]);
    if (newest.rotated_from && newest.activated_at === null) {
      const old = live.rows.find((t) => t.id === newest.rotated_from);
      return {
        tokenId: newest.id,
        oldValidUntil: (old?.expires_at ?? now + OLD_TOKEN_GRACE_S) * 1000,
        alreadyPending: true,
      };
    }
    const oldValidUntil = now + OLD_TOKEN_GRACE_S;
    const issued = issueServerToken();
    await c.query(`UPDATE cs2_fleet_tokens SET expires_at = $1 WHERE id = $2`, [oldValidUntil, newest.id]);
    // Placeholder hash until the secret is minted at send time: matches nothing.
    await c.query(
      `INSERT INTO cs2_fleet_tokens (id, tenant_id, server_id, secret_hash, created_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [issued.id, FLEET_TENANT, serverId, '', now, newest.id]
    );
    return { tokenId: issued.id, oldValidUntil: oldValidUntil * 1000, alreadyPending: false };
  });
}

/** A fresh secret for a pending rotated token; its value goes straight into `auth.rotate`. */
export async function mintRotationSecret(tokenId: string): Promise<string | null> {
  const issued = issueServerToken(tokenId);
  const r = await db.runAsync(
    `UPDATE cs2_fleet_tokens SET secret_hash = ? WHERE id = ? AND revoked_at IS NULL AND rotated_from IS NOT NULL AND activated_at IS NULL`,
    [issued.hash, tokenId]
  );
  return r.changes > 0 ? issued.value : null;
}

/** `auth.rotated`: the server wrote the new token. */
export async function confirmRotation(serverId: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_fleet_tokens SET activated_at = ? WHERE server_id = ? AND rotated_from IS NOT NULL AND activated_at IS NULL AND revoked_at IS NULL`,
    [nowS(), serverId]
  );
}

// ---------------------------------------------------------------------------
// Presence and the stream state
// ---------------------------------------------------------------------------

/** Nobody is connected to a process that just started. */
export async function markAllOffline(): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_servers SET online = 0, session_id = NULL WHERE online = 1');
}

export async function markConnected(
  serverId: string,
  sessionId: string,
  hello: {
    availability: string;
    versions: Versions;
    capabilities: string[];
    host: HostInfo;
    selftest?: unknown;
    protocol: number;
    boot_id: string;
  }
): Promise<void> {
  const now = nowS();
  await db.runAsync(
    `UPDATE cs2_fleet_servers
        SET online = 1, session_id = ?, connected_at = ?, last_seen = ?, availability = ?, versions = ?,
            capabilities = ?, host = ?, selftest = ?, protocol = ?, boot_id = ?, updated_at = ?
      WHERE id = ?`,
    [
      sessionId,
      now,
      now,
      hello.availability,
      JSON.stringify(hello.versions),
      JSON.stringify(hello.capabilities),
      JSON.stringify(hello.host),
      hello.selftest === undefined ? null : JSON.stringify(hello.selftest),
      hello.protocol,
      hello.boot_id,
      now,
      serverId,
    ]
  );
}

export async function markSeen(serverId: string, health?: unknown): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_fleet_servers SET last_seen = ?, health = COALESCE(?, health) WHERE id = ?`,
    [nowS(), health === undefined ? null : JSON.stringify(health), serverId]
  );
}

/** Only the session that is still recorded goes offline: a replacement may already be in. */
export async function markDisconnected(serverId: string, sessionId: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_fleet_servers SET online = 0, session_id = NULL, last_seen = ? WHERE id = ? AND session_id = ?`,
    [nowS(), serverId, sessionId]
  );
}

export interface StreamState {
  rxStreamId: string | null;
  rxSeq: number;
  txSeq: number;
  txAcked: number;
}

export async function getStreamState(serverId: string): Promise<StreamState> {
  const row = await db.queryOneAsync<Pick<FleetServerRow, 'rx_stream_id' | 'rx_seq' | 'tx_seq' | 'tx_acked'>>(
    'SELECT rx_stream_id, rx_seq, tx_seq, tx_acked FROM cs2_fleet_servers WHERE id = ?',
    [serverId]
  );
  return {
    rxStreamId: row?.rx_stream_id ?? null,
    rxSeq: Number(row?.rx_seq ?? 0),
    txSeq: Number(row?.tx_seq ?? 0),
    txAcked: Number(row?.tx_acked ?? 0),
  };
}

export async function setRxState(serverId: string, streamId: string, rxSeq: number): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_servers SET rx_stream_id = ?, rx_seq = ? WHERE id = ?', [streamId, rxSeq, serverId]);
}

/** The server has seen platform seqs up to `seq` (from another database state): never reuse them. */
export async function ensureTxSeqAtLeast(serverId: string, seq: number): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_servers SET tx_seq = GREATEST(tx_seq, ?) WHERE id = ?', [seq, serverId]);
}

/**
 * Append a reliable platform → server message to the server's stream. The
 * seq is assigned here, in the same transaction as the row, so the stream
 * has no holes.
 */
export async function appendOutbox(
  serverId: string,
  message: Omit<Envelope, 'seq' | 'ack' | 'v' | 'id' | 'ts'> & { expiresAt?: number | null }
): Promise<Envelope> {
  return tx(async (c) => {
    const r = await c.query<{ tx_seq: number }>(
      `UPDATE cs2_fleet_servers SET tx_seq = tx_seq + 1 WHERE id = $1 RETURNING tx_seq`,
      [serverId]
    );
    const seq = r.rows[0]?.tx_seq;
    if (!seq) throw new Error(`fleet: unknown server ${serverId}`);
    const envelope: Envelope = {
      v: 1,
      type: message.type,
      id: ulid(),
      seq: Number(seq),
      ts: Date.now(),
      ...(message.ref !== undefined ? { ref: message.ref } : {}),
      ...(message.epoch !== undefined ? { epoch: message.epoch } : {}),
      payload: message.payload,
    };
    await c.query(
      `INSERT INTO cs2_fleet_outbox (server_id, seq, type, message, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [serverId, envelope.seq, envelope.type, JSON.stringify(envelope), message.expiresAt ?? null]
    );
    return envelope;
  });
}

export async function pendingOutbox(serverId: string, afterSeq: number): Promise<Envelope[]> {
  const rows = await db.queryAsync<{ message: string }>(
    'SELECT message FROM cs2_fleet_outbox WHERE server_id = ? AND seq > ? ORDER BY seq ASC',
    [serverId, afterSeq]
  );
  return rows.map((r) => JSON.parse(r.message) as Envelope);
}

/** The server durably processed everything up to `ack`: drop it from the stream. */
export async function ackOutbox(serverId: string, ack: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`DELETE FROM cs2_fleet_outbox WHERE server_id = $1 AND seq <= $2`, [serverId, ack]);
    await c.query(`UPDATE cs2_fleet_servers SET tx_acked = GREATEST(tx_acked, $2) WHERE id = $1`, [serverId, ack]);
  });
}
