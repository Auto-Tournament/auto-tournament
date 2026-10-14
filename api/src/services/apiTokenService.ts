/**
 * API tokens made in Settings (Settings -> API tokens): a machine's way into
 * the admin API without a browser session, like the API_TOKENS variables but
 * made, named and revoked by an admin. The Auto Tournament MCP server (mcp/)
 * signs in with one.
 *
 * Only the SHA-256 of a secret is stored; the secret is shown once, when it is
 * made. The live set sits in utils/serviceTokens next to the env tokens, so a
 * request checks both without a database round trip.
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { log } from '../utils/logger';
import {
  hashServiceToken,
  setStoredServiceTokens,
  type ServiceToken,
} from '../utils/serviceTokens';

export type StoredTokenScope = 'admin' | 'readonly';

export interface ApiTokenView {
  id: number;
  label: string;
  scope: StoredTokenScope;
  fingerprint: string;
  createdBy: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

interface ApiTokenRow {
  id: number;
  label: string;
  scope: string;
  token_hash: string;
  fingerprint: string;
  created_by: string | null;
  created_at: number;
  last_used_at: number | null;
}

const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const now = () => Math.floor(Date.now() / 1000);

/** Last use is written at most this often per token. */
const LAST_USED_EVERY = 300;
const lastWritten = new Map<string, number>();

export class ApiTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTokenError';
  }
}

function view(row: ApiTokenRow): ApiTokenView {
  return {
    id: row.id,
    label: row.label,
    scope: row.scope === 'admin' ? 'admin' : 'readonly',
    fingerprint: row.fingerprint,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
  };
}

export const apiTokenService = {
  /** Load the active tokens into the request-time registry. */
  async load(): Promise<void> {
    const rows = await db.queryAsync<ApiTokenRow>(
      'SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY id'
    );
    const tokens: ServiceToken[] = rows.map((row) => ({
      label: row.label,
      scope: row.scope === 'admin' ? 'admin' : 'readonly',
      hash: Buffer.from(row.token_hash, 'hex'),
      fingerprint: row.fingerprint,
    }));
    setStoredServiceTokens(tokens);
  },

  async list(): Promise<ApiTokenView[]> {
    const rows = await db.queryAsync<ApiTokenRow>(
      'SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC, id DESC'
    );
    return rows.map(view);
  },

  /** Make a token; the secret comes back once and is never stored. */
  async create(
    label: string,
    scope: StoredTokenScope,
    createdBy: string | null
  ): Promise<{ token: ApiTokenView; secret: string }> {
    const name = label.trim();
    if (!LABEL_PATTERN.test(name)) {
      throw new ApiTokenError('The name is 1-32 letters, digits, - or _.');
    }
    if (scope !== 'admin' && scope !== 'readonly') {
      throw new ApiTokenError('The scope is admin or readonly.');
    }
    const taken = await db.queryOneAsync(
      'SELECT 1 FROM api_tokens WHERE label = ? AND revoked_at IS NULL',
      [name]
    );
    if (taken) throw new ApiTokenError(`A token named "${name}" already exists.`);
    const secret = `att_${crypto.randomBytes(32).toString('hex')}`;
    const { hash, fingerprint } = hashServiceToken(secret);
    const row = await db.queryOneAsync<ApiTokenRow>(
      `INSERT INTO api_tokens (label, scope, token_hash, fingerprint, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [name, scope, hash.toString('hex'), fingerprint, createdBy, now()]
    );
    await this.load();
    log.info(
      `[API-TOKENS] ${scope} token "${name}" (${fingerprint}) made by ${createdBy ?? 'unknown'}`
    );
    return { token: view(row!), secret };
  },

  async revoke(id: number, by: string | null): Promise<boolean> {
    const row = await db.queryOneAsync<ApiTokenRow>(
      'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING *',
      [now(), id]
    );
    if (!row) return false;
    await this.load();
    log.info(
      `[API-TOKENS] token "${row.label}" (${row.fingerprint}) revoked by ${by ?? 'unknown'}`
    );
    return true;
  },

  /** A Settings-made token was used: note it (at most every few minutes). */
  noteUsed(fingerprint: string): void {
    const at = now();
    if ((lastWritten.get(fingerprint) ?? 0) > at - LAST_USED_EVERY) return;
    lastWritten.set(fingerprint, at);
    void db
      .runAsync(
        'UPDATE api_tokens SET last_used_at = ? WHERE fingerprint = ? AND revoked_at IS NULL',
        [at, fingerprint]
      )
      .catch(() => undefined);
  },
};
