/**
 * Webhook signatures.
 *
 * Every delivery carries
 *
 *   X-AT-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * The timestamp is part of what is signed, so a receiver that rejects old
 * timestamps (5 minutes is the documented tolerance) cannot be replayed.
 * While a rotated secret is still in its grace period the header carries one
 * `v1=` per secret; a receiver accepts the delivery when any of them matches.
 *
 * Pure (node:crypto only), so the tests and the docs' verification sample use
 * the exact same code path.
 */

import crypto from 'crypto';

export const SIGNATURE_HEADER = 'X-AT-Signature';
export const EVENT_HEADER = 'X-AT-Event';
export const DELIVERY_HEADER = 'X-AT-Delivery';
export const EVENT_ID_HEADER = 'X-AT-Event-Id';

/** How old a signed timestamp a receiver should still accept (documented). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

const SECRET_PREFIX = 'whsec_';

/** A new endpoint secret: `whsec_` + 32 random bytes, base64url. */
export function generateWebhookSecret(): string {
  return SECRET_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** The hex HMAC-SHA256 of `<timestamp>.<body>` under `secret`. */
export function computeSignature(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/** The header value for a delivery signed with one or more secrets (newest first). */
export function signatureHeaderValue(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${computeSignature(s, timestamp, body)}`)].join(',');
}

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(value: string | null | undefined): ParsedSignature | null {
  if (!value) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (key === 't' && /^\d+$/.test(val)) timestamp = Number(val);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(val)) signatures.push(val);
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'stale' | 'mismatch' };

/**
 * What a receiver does: parse the header, check the timestamp is recent,
 * recompute the HMAC over the raw body and compare in constant time.
 */
export function verifySignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {}
): VerifyResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(computeSignature(secret, parsed.timestamp, rawBody), 'hex');
  for (const candidate of parsed.signatures) {
    const got = Buffer.from(candidate, 'hex');
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}
