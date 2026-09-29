/**
 * TOTP (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits), the two-factor option
 * for local admin accounts. Implemented on Node's crypto rather than a
 * dependency: the algorithm is a dozen lines, and the tests check it against
 * the RFC's own test vectors. Works with any authenticator app.
 */
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, RFC 4226's recommendation), base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for time step `step`. */
export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, '0');
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Check `code` against the current step and one either side (clock drift).
 * Returns the matching step, or null. A step at or before `lastStep` is
 * refused, so a code cannot be replayed.
 */
export function verifyTotp(
  secretBase32: string,
  code: unknown,
  opts: { nowMs?: number; lastStep?: number | null } = {}
): number | null {
  if (typeof code !== 'string') return null;
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep(opts.nowMs);
  let match: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secretBase32, step));
    // Compare every candidate so the time taken does not depend on which matched.
    if (crypto.timingSafeEqual(expected, Buffer.from(c)) && match === null) match = step;
  }
  if (match === null) return null;
  if (opts.lastStep !== null && opts.lastStep !== undefined && match <= opts.lastStep) return null;
  return match;
}

/** The otpauth:// URI authenticator apps read (as a QR code or pasted). */
export function totpUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
