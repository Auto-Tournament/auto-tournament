import { createHash, randomBytes } from 'crypto';
import { db } from '../config/database';

/**
 * Sign-up invite links: while "Allow anyone to register" is off, an admin can hand out a
 * link, and whoever opens it may make an account (once per use). The link carries a random
 * token; only its SHA-256 is stored.
 */

export interface SignupInvite {
  id: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdBy: string | null;
  /** The maker's player name, or an API token's label. */
  createdByName: string | null;
  createdAt: number;
}

interface Row {
  id: string;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: number;
}

const nowS = () => Math.floor(Date.now() / 1000);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const toInvite = (r: Row): SignupInvite => ({
  id: r.id,
  maxUses: r.max_uses === null ? null : Number(r.max_uses),
  uses: Number(r.uses),
  expiresAt: r.expires_at === null ? null : Number(r.expires_at),
  createdBy: r.created_by,
  createdByName: r.created_by?.startsWith('token:')
    ? r.created_by.slice('token:'.length)
    : (r.created_by_name ?? null),
  createdAt: Number(r.created_at),
});

/** Tokens are 32 random bytes in base64url (43 characters). */
export const SIGNUP_INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Where an invite is still good: not revoked, not expired, uses left. */
const USABLE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)`;

export const signupInviteService = {
  /** A new link; the token is only in this answer. */
  async create(opts: {
    maxUses: number | null;
    expiresInDays: number | null;
    createdBy: string | null;
  }): Promise<{ invite: SignupInvite; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const id = `inv_${randomBytes(8).toString('hex')}`;
    const expiresAt = opts.expiresInDays ? nowS() + opts.expiresInDays * 86400 : null;
    const rows = await db.queryAsync<Row>(
      `INSERT INTO signup_invites (id, token_hash, max_uses, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
      [id, hash(token), opts.maxUses, expiresAt, opts.createdBy]
    );
    return { invite: toInvite(rows[0]), token };
  },

  /** Links that still work, newest first. */
  async listUsable(): Promise<SignupInvite[]> {
    const rows = await db.queryAsync<Row>(
      `SELECT si.*, p.name AS created_by_name FROM signup_invites si
       LEFT JOIN players p ON p.id = si.created_by
       WHERE ${USABLE} ORDER BY si.created_at DESC`,
      [nowS()]
    );
    return rows.map(toInvite);
  },

  async revoke(id: string): Promise<boolean> {
    const r = await db.runAsync(
      `UPDATE signup_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      [nowS(), id]
    );
    return r.changes > 0;
  },

  /** The link when it still works (does not use it): its end, unix seconds, or null for none. */
  async findUsable(token: string): Promise<{ expiresAt: number | null } | null> {
    if (!SIGNUP_INVITE_TOKEN.test(token)) return null;
    const row = await db.queryOneAsync<{ expires_at: number | null }>(
      `SELECT expires_at FROM signup_invites WHERE token_hash = ? AND ${USABLE}`,
      [hash(token), nowS()]
    );
    return row ? { expiresAt: row.expires_at === null ? null : Number(row.expires_at) } : null;
  },

  /** Uses the link once; false when it no longer works. One statement, so two sign-ins can't both take the last use. */
  async consume(token: string): Promise<boolean> {
    if (!SIGNUP_INVITE_TOKEN.test(token)) return false;
    const r = await db.runAsync(
      `UPDATE signup_invites SET uses = uses + 1 WHERE token_hash = ? AND ${USABLE}`,
      [hash(token), nowS()]
    );
    return r.changes > 0;
  },
};
