/**
 * Recorder keys: what a highlight recorder signs in with, instead of an admin
 * API token (a PC lent out at a LAN should not hold the keys to the whole
 * platform). An admin makes one on the Recorders tab, which shows it once in a
 * ready-to-paste `docker run`; the platform keeps only its hash. A key is good
 * for the recorder's own calls (requireRecorder) and nothing else, and can be
 * revoked.
 *
 * The key is `atr_<id>_<secret>`: the id finds the row, the secret is checked
 * against its SHA-256.
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../../config/database';
import { requireAuth } from '../../../middleware/auth';

const PREFIX = 'atr_';
/** A checked key is trusted this long before its row is read again. */
const CACHE_MS = 60_000;
const verified = new Map<string, { id: string; name: string; until: number }>();

const hash = (secret: string) => crypto.createHash('sha256').update(secret).digest('hex');

export interface RecorderKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

/** Make a key; the token is only ever returned here. */
export async function createRecorderKey(
  name: string,
  createdBy: string | null
): Promise<{ key: RecorderKey; token: string }> {
  const id = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    'INSERT INTO cs2_recorder_keys (id, name, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, name.slice(0, 80), hash(secret), createdBy, now]
  );
  return {
    key: { id, name: name.slice(0, 80), createdAt: now, lastUsedAt: null, revoked: false },
    token: `${PREFIX}${id}_${secret}`,
  };
}

export async function listRecorderKeys(): Promise<RecorderKey[]> {
  const rows = await db.queryAsync<{
    id: string;
    name: string;
    created_at: number;
    last_used_at: number | null;
    revoked_at: number | null;
  }>(
    'SELECT id, name, created_at, last_used_at, revoked_at FROM cs2_recorder_keys ORDER BY created_at DESC'
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: Number(r.created_at),
    lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
    revoked: r.revoked_at !== null,
  }));
}

export async function revokeRecorderKey(id: string): Promise<boolean> {
  const res = await db.runAsync(
    'UPDATE cs2_recorder_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [Math.floor(Date.now() / 1000), id]
  );
  for (const [token, v] of verified) if (v.id === id) verified.delete(token);
  return res.changes > 0;
}

/** The key's id and name when `token` is a live recorder key, else null. */
export async function checkRecorderKey(
  token: string
): Promise<{ id: string; name: string } | null> {
  if (!token.startsWith(PREFIX)) return null;
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return { id: hit.id, name: hit.name };
  const m = /^atr_([0-9a-f]{12})_([A-Za-z0-9_-]{20,64})$/.exec(token);
  if (!m) return null;
  const row = await db.queryOneAsync<{
    name: string;
    secret_hash: string;
    revoked_at: number | null;
  }>('SELECT name, secret_hash, revoked_at FROM cs2_recorder_keys WHERE id = ?', [m[1]]);
  if (!row || row.revoked_at !== null) return null;
  const a = Buffer.from(hash(m[2]), 'hex');
  const b = Buffer.from(row.secret_hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  verified.set(token, { id: m[1], name: row.name, until: Date.now() + CACHE_MS });
  await db.runAsync('UPDATE cs2_recorder_keys SET last_used_at = ? WHERE id = ?', [
    Math.floor(Date.now() / 1000),
    m[1],
  ]);
  return { id: m[1], name: row.name };
}

function presented(req: Request): string | null {
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null;
}

/**
 * The recorder's own routes: a live recorder key, or what requireAuth takes
 * (an admin's session or API token). A recorder key anywhere else is refused
 * by requireAuth like any unknown token.
 */
export async function requireRecorder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = presented(req);
  if (token?.startsWith(PREFIX)) {
    try {
      if (await checkRecorderKey(token)) return next();
    } catch {
      res.status(500).json({ success: false, error: 'Could not check the recorder key' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid or revoked recorder key' });
    return;
  }
  return requireAuth(req, res, next);
}
