/**
 * The public keys a module release may be signed with (DESIGN-modules §10.4).
 *
 * Compiled in, so trusting a new key is a platform release, reviewed like any
 * other code. Each key is its raw 32-byte Ed25519 public key in base64, and
 * its id is derived from it (the first 16 hex of its sha256) — a signature
 * file names the key, it cannot choose what that name means.
 *
 * Rotation: add the next key here in one release, sign with it from the one
 * after, and drop the old one once no supported platform needs it. A key that
 * leaked stays in the list with `revoked: true`, so its signatures are
 * refused by name rather than merely not recognised.
 *
 * An operator can trust more keys — their own module builds, CI's throwaway
 * key — with `MODULE_TRUSTED_KEYS` (comma-separated base64 raw keys). That
 * gives nothing away: whoever sets the environment can already put code in
 * `DATA_DIR/modules`.
 */

import crypto from 'crypto';

export interface TrustedKey {
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** Where it came from, for the Modules page and the logs. */
  label: string;
  revoked?: boolean;
}

/** `keyId` for a raw base64 public key. */
export function keyIdFor(publicKeyBase64: string): string {
  return crypto.createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16);
}

function key(label: string, publicKey: string, revoked = false): TrustedKey {
  return { keyId: keyIdFor(publicKey), publicKey, label, ...(revoked ? { revoked } : {}) };
}

/**
 * The keys Auto Tournament signs its module releases with. The private half
 * of each is an Actions secret on the repository that publishes releases,
 * never in any repository.
 */
const COMPILED_KEYS: TrustedKey[] = [];

/** Keys a spec registered in this process (test endpoints only). */
const extraKeys: TrustedKey[] = [];

/** Test-only: trust one more key in this process. */
export function trustKeyForTests(publicKeyBase64: string): TrustedKey {
  const trusted = key('test', publicKeyBase64);
  if (!extraKeys.some((k) => k.keyId === trusted.keyId)) extraKeys.push(trusted);
  return trusted;
}

function isRawEd25519(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32;
}

/** The keys `MODULE_TRUSTED_KEYS` adds, and how many of its entries are not keys. */
export function environmentTrustedKeys(): { keys: TrustedKey[]; malformed: number } {
  const entries = (process.env.MODULE_TRUSTED_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const keys = environmentKeys().filter((extra) => !COMPILED_KEYS.some((k) => k.keyId === extra.keyId));
  return { keys, malformed: entries.filter((value) => !isRawEd25519(value)).length };
}

function environmentKeys(): TrustedKey[] {
  const raw = process.env.MODULE_TRUSTED_KEYS || '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '' && isRawEd25519(value))
    .map((value) => key('MODULE_TRUSTED_KEYS', value));
}

/** Every key a release may be signed with, revoked ones included (and refused). */
export function trustedKeys(): TrustedKey[] {
  const all = [...COMPILED_KEYS];
  for (const extra of [...environmentKeys(), ...extraKeys]) {
    // A compiled entry wins, so an environment variable cannot un-revoke a key.
    if (!all.some((k) => k.keyId === extra.keyId)) all.push(extra);
  }
  return all;
}

export function publicKeyObject(trusted: TrustedKey): crypto.KeyObject {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(trusted.publicKey, 'base64').toString('base64url') },
    format: 'jwk',
  });
}
