/**
 * Encryption at rest for secrets the admin UI stores in the database (the
 * sign-in providers' client secrets and the Steam Web API key).
 *
 * AES-256-GCM with a random 96-bit IV per value. The key is derived with
 * HKDF-SHA256 from `SECRETS_KEY` when it is set, else from `SESSION_SECRET`
 * (the same fallback the signed cookies use). Changing that secret makes the
 * stored values unreadable: they then count as "not set" and the admin enters
 * them again. Nothing here logs a value.
 *
 * Stored form: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
import crypto from 'crypto';

const VERSION = 'v1';
const HKDF_INFO = 'auto-tournament:secret-box:v1';
const DEV_FALLBACK = 'auto-tournament-dev-session-secret';

export type SecretsKeySource = 'SECRETS_KEY' | 'SESSION_SECRET' | 'default';

/** Which variable the key comes from; shown on Settings -> Sign-in. */
export function secretsKeySource(env: NodeJS.ProcessEnv = process.env): SecretsKeySource {
  if (env.SECRETS_KEY?.trim()) return 'SECRETS_KEY';
  if (env.SESSION_SECRET?.trim()) return 'SESSION_SECRET';
  return 'default';
}

function keyMaterial(env: NodeJS.ProcessEnv): string {
  return env.SECRETS_KEY?.trim() || env.SESSION_SECRET?.trim() || DEV_FALLBACK;
}

function deriveKey(env: NodeJS.ProcessEnv): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(keyMaterial(env), 'utf8'), Buffer.alloc(0), HKDF_INFO, 32)
  );
}

/** Encrypt `plaintext` for storage. */
export function encryptSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/**
 * Decrypt a value `encryptSecret` wrote, or null when it is malformed, was
 * tampered with or was encrypted with another key.
 */
export function decryptSecret(stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!stored) return null;
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(env), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
