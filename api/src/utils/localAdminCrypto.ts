/**
 * The pure parts of local admin sign-in: setup codes, password hashing and
 * the username / password rules. No database here, so the tests import it
 * directly. The store is services/localAdminService.ts.
 *
 * - Setup code: 28 Crockford base32 characters (140 bits) from the CSPRNG,
 *   shown as 7 groups of 4. Only its SHA-256 is stored; a code this long
 *   needs no slow hash. Input is normalised (case, dashes, spaces, O/I/L).
 * - Passwords: scrypt (Node's crypto; no native dependency), N=2^15, r=8,
 *   p=1, 16-byte salt, 32-byte key. Stored as `scrypt$N$r$p$salt$hash`, so
 *   the parameters can be raised later without breaking old hashes.
 */
import crypto from 'crypto';

// Crockford base32: no I, L, O, U.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUPS = 7;
const GROUP_LENGTH = 4;
export const SETUP_CODE_LENGTH = CODE_GROUPS * GROUP_LENGTH;

/** A new one-time code, e.g. `7K3Q-M9XD-…` (7 groups of 4). */
export function generateSetupCode(): string {
  const chars: string[] = [];
  const bytes = crypto.randomBytes(SETUP_CODE_LENGTH);
  // 256 is a multiple of 32, so `byte % 32` is uniform.
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) chars.push(CROCKFORD[bytes[i] % 32]);
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i++) groups.push(chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join(''));
  return groups.join('-');
}

/** The code as typed, in canonical form, or null when it cannot be a code. */
export function normalizeSetupCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 100) return null;
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== SETUP_CODE_LENGTH) return null;
  for (const c of s) if (!CROCKFORD.includes(c)) return null;
  return s;
}

export function hashSetupCode(normalized: string): string {
  return crypto.createHash('sha256').update(`auto-tournament:setup-code:${normalized}`, 'utf8').digest('hex');
}

/** Timing-safe compare of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLength: 32, saltLength: 16 };
// 128 * N * r bytes = 32 MiB; give scrypt room above Node's 32 MiB default.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT.saltLength);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length < 16) return false;
  const key = await scrypt(password, salt, N, r, p, expected.length);
  return crypto.timingSafeEqual(key, expected);
}

/** A hash to verify against when the username does not exist, so the answer takes as long. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Lower-cased username, or null when it breaks the rule (3-32 of a-z 0-9 . _ -, starting with a letter or digit). */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const u = input.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

// A few passwords long enough to pass the length rule that are still guessed first.
const COMMON = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiopas',
  'administrator',
  'adminadminadmin',
  'autotournament',
  'letmeinletmein',
  'changemechangeme',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'contains_username' | 'too_simple';

/**
 * NIST 800-63B style: length, not composition. At least 12 characters, at
 * most 256, not the username, not one repeated character, not a known
 * common password.
 */
export function passwordProblem(username: string, password: unknown): PasswordProblem | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return 'too_short';
  if (password.length > PASSWORD_MAX) return 'too_long';
  const lower = password.toLowerCase();
  if (username && lower.includes(username.toLowerCase())) return 'contains_username';
  if (new Set(password).size < 4 || COMMON.has(lower)) return 'too_simple';
  return null;
}

/** The players row a local admin signs in as. Never a Steam ID (not 17 digits). */
export function localAdminPlayerId(username: string): string {
  return `local-${username}`;
}
