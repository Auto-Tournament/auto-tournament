/**
 * Fleet credentials: the opaque secrets a Ready Up server holds, and how the
 * platform stores and checks them (FLEET.md §4.1-4.2, D2, D3).
 *
 * - server token      `rus_<id>_<secret>`   (the WS upgrade and, later, uploads)
 * - fleet key         `rfk_<id>_<secret>`   (reusable enrollment, csm/containers)
 * - enrollment code   `RUE-XXXX-XXXX-XXXX-XXXX` (one server, single use, 15 min)
 *
 * `<id>` is 12 lowercase Crockford base32 chars (60 bits) so lookup is an
 * index hit; `<secret>` is 256 random bits, base64url (43 chars). Only
 * `sha256(secret)` is stored, and it is compared in constant time. An
 * enrollment code has no id part: its 16 base32 chars are 80 bits, and the
 * lookup is by the hash of the whole code.
 *
 * Pure functions, no database: the tests import this file directly.
 */

import crypto from 'crypto';

export const SERVER_TOKEN_PREFIX = 'rus';
export const FLEET_KEY_PREFIX = 'rfk';
export const ENROLLMENT_CODE_PREFIX = 'RUE';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 12;
const CODE_LENGTH = 16;

/** `n` random Crockford base32 chars (5 bits each, from rejection-free bytes). */
function randomBase32(n: number): string {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += CROCKFORD[bytes[i] & 31];
  return out;
}

/** ULID: 48-bit ms timestamp + 80 random bits, Crockford base32, 26 chars. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + randomBase32(16);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export interface IssuedSecret {
  /** The full credential, shown once and never stored. */
  value: string;
  id: string;
  /** sha256 of the secret part, hex: what the database keeps. */
  hash: string;
}

function issue(prefix: string, id?: string): IssuedSecret {
  const tokenId = id ?? randomBase32(ID_LENGTH).toLowerCase();
  const secret = crypto.randomBytes(32).toString('base64url');
  return { value: `${prefix}_${tokenId}_${secret}`, id: tokenId, hash: sha256Hex(secret) };
}

/** A new server token. `id` re-mints the secret of an existing token id (rotation replay). */
export function issueServerToken(id?: string): IssuedSecret {
  return issue(SERVER_TOKEN_PREFIX, id);
}

export function issueFleetKey(): IssuedSecret {
  return issue(FLEET_KEY_PREFIX);
}

export interface ParsedSecret {
  id: string;
  secretHash: string;
}

const ID_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Split `<prefix>_<id>_<secret>`. The secret is base64url and may itself
 * contain `_`, so only the first two separators count. Null for anything
 * that is not well formed.
 */
export function parseSecret(prefix: string, value: unknown): ParsedSecret | null {
  if (typeof value !== 'string') return null;
  const head = `${prefix}_`;
  if (!value.startsWith(head)) return null;
  const rest = value.slice(head.length);
  const sep = rest.indexOf('_');
  if (sep < 0) return null;
  const id = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return null;
  return { id, secretHash: sha256Hex(secret) };
}

export function parseServerToken(value: unknown): ParsedSecret | null {
  return parseSecret(SERVER_TOKEN_PREFIX, value);
}

export function parseFleetKey(value: unknown): ParsedSecret | null {
  return parseSecret(FLEET_KEY_PREFIX, value);
}

/** Check a presented secret's hash against the stored one. */
export function verifySecret(parsed: ParsedSecret, storedHash: string): boolean {
  return hashesMatch(parsed.secretHash, storedHash);
}

export interface IssuedCode {
  /** `RUE-XXXX-XXXX-XXXX-XXXX`, shown once. */
  code: string;
  hash: string;
}

export function issueEnrollmentCode(): IssuedCode {
  const raw = randomBase32(CODE_LENGTH);
  const groups = raw.match(/.{4}/g) ?? [];
  return { code: `${ENROLLMENT_CODE_PREFIX}-${groups.join('-')}`, hash: sha256Hex(raw) };
}

/**
 * The hash to look an entered code up by, or null when it cannot be a code.
 * Forgiving about case, spaces and dashes, and about Crockford's look-alikes
 * (O→0, I/L→1), since people type these from a screen.
 */
export function enrollmentCodeHash(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith(ENROLLMENT_CODE_PREFIX)) s = s.slice(ENROLLMENT_CODE_PREFIX.length);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH || ![...s].every((c) => CROCKFORD.includes(c))) return null;
  return sha256Hex(s);
}

/**
 * `rus_…` / `rfk_…` secrets and enrollment codes replaced by their prefix
 * (FLEET.md §15: never logged). For log lines that might echo client input.
 */
export function redactFleetSecrets(text: string): string {
  return text
    .replace(/\b(rus|rfk|rhs)_[0-9a-z]{12}_[A-Za-z0-9_-]+/g, '$1_[redacted]')
    .replace(/\bRUE-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}\b/gi, 'RUE-[redacted]');
}
