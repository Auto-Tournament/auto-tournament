/**
 * Offline check of an Auto Tournament license key. A port of the website's
 * reference verifier (Auto-Tournament/website `scripts/license-verify.mjs`,
 * format in its README, "License keys"): the same token checks, the same
 * result shape.
 *
 * Token: `ATL1.<payload>.<signature>`
 *   payload   = base64url (no padding) of the UTF-8 JSON payload
 *   signature = base64url (no padding) of the 64-byte Ed25519 signature over
 *               the ASCII bytes of "ATL1.<payload>"
 * The payload's `kid` picks the public key (./publicKeys).
 *
 * Nothing here ever blocks anything. The result is `ok`, `warning` (a valid
 * key with something to point out) or `invalid` (not a genuine key), and the
 * platform only ever shows it to admins.
 */

import { createPublicKey, verify, type JsonWebKey } from 'crypto';
import { LICENSE_PUBLIC_KEYS, type LicensePublicKey } from './publicKeys';

export const TOKEN_PREFIX = 'ATL1';
export const MAX_TOKEN_LENGTH = 4096;
/** updates_until of a founder license: every release line is covered. */
export const LIFETIME = '9999-12-31';

const B64URL = /^[A-Za-z0-9_-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRODUCTS = ['servers', 'platform'] as const;
const PACKS = ['S', 'M', 'L'] as const;
/** `free`: the optional free key for non-commercial use (no server limit, never expires, enforces nothing). */
const KINDS = ['month', 'year', 'founder', 'event', 'free'] as const;

export type LicenseProduct = (typeof PRODUCTS)[number];

export interface LicensePayload {
  v: 1;
  kid: string;
  id: string;
  customer: string;
  licensee?: string;
  product: LicenseProduct;
  pack: (typeof PACKS)[number];
  max_servers: number;
  kind: (typeof KINDS)[number];
  issued_at: string;
  /** YYYY-MM-DD, inclusive: release lines (x.y.0) out on or before this day are covered. */
  updates_until: string;
  /** YYYY-MM-DD, inclusive: the event window. Event licenses only. */
  valid_from?: string;
  valid_to?: string;
  /** Only on a lease (the current terms from a check-in, ./gate.ts): never accepted as the key. */
  lease?: true;
}

export type LicenseWarningCode =
  | 'malformed'
  | 'unsupported_version'
  | 'unknown_kid'
  | 'bad_signature'
  | 'updates_expired'
  | 'period_ended'
  | 'period_not_started'
  | 'too_many_servers'
  | 'wrong_product';

export interface LicenseWarning {
  code: LicenseWarningCode;
  message: string;
}

export interface LicenseCheck {
  valid: boolean;
  status: 'ok' | 'warning' | 'invalid';
  warnings: LicenseWarning[];
  license: LicensePayload | null;
}

export interface VerifyOptions {
  /** kid → public key. Defaults to the embedded keys. */
  publicKeys?: Readonly<Record<string, LicensePublicKey>>;
  /** Release date of the running build's x.y.0 line, YYYY-MM-DD. Defaults to today. */
  lineDate?: string | Date;
  /** Game servers set up right now; omitted means not checked. */
  serverCount?: number;
  /** Which product is checking. */
  product?: LicenseProduct;
  /** Today, for an event license's window. Defaults to today. */
  now?: string | Date;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today (UTC) as YYYY-MM-DD, or a Date / date string turned into one. */
function day(value: string | Date | undefined): string {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (isDate(value.slice(0, 10))) return value.slice(0, 10);
  throw new TypeError(`not a date: ${String(value)}`);
}

/** The payload's shape: an error message, or null when it is a v1 license. */
export function payloadProblem(p: unknown): string | null {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return 'payload is not an object';
  const o = p as Record<string, unknown>;
  if (o.v !== 1) return `unsupported version ${JSON.stringify(o.v)}`;
  if (typeof o.kid !== 'string' || !o.kid) return 'missing kid';
  if (typeof o.id !== 'string' || !o.id) return 'missing id';
  if (typeof o.customer !== 'string' || !o.customer) return 'missing customer';
  if (!(PRODUCTS as readonly unknown[]).includes(o.product)) return 'bad product';
  if (!(PACKS as readonly unknown[]).includes(o.pack)) return 'bad pack';
  if (!Number.isSafeInteger(o.max_servers) || (o.max_servers as number) < 1)
    return 'bad max_servers';
  if (!(KINDS as readonly unknown[]).includes(o.kind)) return 'bad kind';
  if (typeof o.issued_at !== 'string' || Number.isNaN(Date.parse(o.issued_at)))
    return 'bad issued_at';
  if (!isDate(o.updates_until)) return 'bad updates_until';
  if ((o.valid_from === undefined) !== (o.valid_to === undefined)) {
    return 'valid_from and valid_to go together';
  }
  if (
    o.valid_from !== undefined &&
    (!isDate(o.valid_from) ||
      !isDate(o.valid_to) ||
      (o.valid_from as string) > (o.valid_to as string))
  ) {
    return 'bad valid_from/valid_to';
  }
  if (o.licensee !== undefined && typeof o.licensee !== 'string') return 'bad licensee';
  return null;
}

export interface DecodedLicense {
  payload: unknown;
  signature: Buffer;
  signed: Buffer;
}

/** Splits and decodes a token without checking the signature. Throws on a malformed token. */
export function decodeLicense(token: unknown): DecodedLicense {
  if (typeof token !== 'string') throw new Error('not a string');
  const t = token.trim();
  if (t.length > MAX_TOKEN_LENGTH) throw new Error('too long');
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX)
    throw new Error(`not an ${TOKEN_PREFIX} key`);
  const [, body, sig] = parts;
  if (!B64URL.test(body) || !B64URL.test(sig)) throw new Error('not base64url');
  const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const signature = Buffer.from(sig, 'base64url');
  if (signature.length !== 64) throw new Error('bad signature length');
  return { payload, signature, signed: Buffer.from(`${TOKEN_PREFIX}.${body}`, 'ascii') };
}

function invalid(code: LicenseWarningCode, message: string): LicenseCheck {
  return { valid: false, status: 'invalid', warnings: [{ code, message }], license: null };
}

/** Checks a license key. Never throws. */
export function verifyLicense(token: unknown, options: VerifyOptions = {}): LicenseCheck {
  const publicKeys = options.publicKeys ?? LICENSE_PUBLIC_KEYS;

  let decoded: DecodedLicense;
  try {
    decoded = decodeLicense(token);
  } catch (err) {
    return invalid(
      'malformed',
      `This is not a valid license key (${err instanceof Error ? err.message : 'unreadable'}).`
    );
  }
  const { payload, signature, signed } = decoded;
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;

  if (typeof p.v === 'number' && p.v !== 1) {
    return invalid('unsupported_version', `License key version ${p.v} needs a newer release.`);
  }
  const jwk =
    typeof p.kid === 'string' && Object.prototype.hasOwnProperty.call(publicKeys, p.kid)
      ? publicKeys[p.kid]
      : null;
  if (!jwk) {
    return invalid(
      'unknown_kid',
      'This license key was signed with a key this release does not know.'
    );
  }

  let ok = false;
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } as JsonWebKey,
      format: 'jwk',
    });
    ok = verify(null, signed, key, signature);
  } catch {
    ok = false;
  }
  if (!ok) {
    return invalid(
      'bad_signature',
      'The license key signature does not match: the key was changed or mistyped.'
    );
  }

  const problem = payloadProblem(payload);
  if (problem) return invalid('malformed', `The license key content is not valid (${problem}).`);
  const license = payload as LicensePayload;

  const warnings: LicenseWarning[] = [];
  const line = day(options.lineDate);
  const today = day(options.now);

  if (line > license.updates_until) {
    warnings.push({
      code: 'updates_expired',
      message: `This release line came out on ${line}, after the license's updates ended on ${license.updates_until}. Renew updates, or stay on a release line from before then.`,
    });
  }
  if (license.valid_to !== undefined && today > license.valid_to) {
    warnings.push({
      code: 'period_ended',
      message: `This event license covered dates up to ${license.valid_to}. Testing and setting up need no action; a new event gets its own event license.`,
    });
  }
  if (license.valid_from !== undefined && today < license.valid_from) {
    warnings.push({
      code: 'period_not_started',
      message: `This event license covers dates from ${license.valid_from}. Setting up and testing before then is fine.`,
    });
  }
  if (
    license.kind !== 'free' &&
    typeof options.serverCount === 'number' &&
    options.serverCount > license.max_servers
  ) {
    warnings.push({
      code: 'too_many_servers',
      message: `${options.serverCount} servers are set up, but this license covers ${license.max_servers}. Every server counts, including spare, practice and test servers, so you need a license that covers all of them.`,
    });
  }
  if (options.product === 'platform' && license.product === 'servers') {
    warnings.push({
      code: 'wrong_product',
      message: 'This key covers CS2 Server Manager and Ready Up, not the platform.',
    });
  }

  return { valid: true, status: warnings.length ? 'warning' : 'ok', warnings, license };
}
