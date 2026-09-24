/**
 * Signed module releases (DESIGN-modules §10.4).
 *
 * A release is `<id>-<version>.atmod` plus `<id>-<version>.atmod.sig`, a small
 * JSON file:
 *
 *   { "schema": 1, "algorithm": "ed25519", "keyId": "<16 hex>",
 *     "id": "cs2", "version": "3.0.0", "sha256": "<hex of the archive>",
 *     "signature": "<base64>" }
 *
 * The key signs a fixed, domain-separated message naming the module, its
 * version and the archive's sha256 — never the archive itself, and never
 * anything that could be mistaken for another kind of message:
 *
 *   auto-tournament-module\n1\n<id>\n<version>\n<sha256>\n
 *
 * Ed25519 through Node's built-in `crypto`: no dependency, and the release
 * script signs with exactly the code the platform verifies with.
 *
 * `verifyModuleRelease` is the gate every catalog install passes through
 * before the archive is decompressed, parsed or written anywhere.
 */

import crypto from 'crypto';
import semver from 'semver';
import { isValidModuleId } from './manifest';
import { keyIdFor, publicKeyObject, trustedKeys, type TrustedKey } from './trustedKeys';

export const SIGNATURE_SCHEMA = 1;
export const MAX_SIGNATURE_BYTES = 4096;

export interface ModuleSignature {
  schema: 1;
  algorithm: 'ed25519';
  keyId: string;
  id: string;
  version: string;
  sha256: string;
  signature: string;
}

export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** The exact bytes the key signs for one release. */
export function signedMessage(id: string, version: string, sha256: string): Buffer {
  return Buffer.from(`auto-tournament-module\n1\n${id}\n${version}\n${sha256}\n`, 'utf8');
}

/**
 * Sign an archive. For the release script and the test fixtures; the platform
 * itself never holds a private key.
 */
export function signModuleArchive(
  archive: Buffer,
  meta: { id: string; version: string },
  privateKey: crypto.KeyObject
): ModuleSignature {
  if (!isValidModuleId(meta.id)) throw new Error(`'${meta.id}' is not a valid module id`);
  if (!semver.valid(meta.version)) throw new Error(`'${meta.version}' is not a semver version`);
  const publicRaw = crypto
    .createPublicKey(privateKey)
    .export({ format: 'jwk' }).x as string;
  const sha256 = sha256Hex(archive);
  const signature = crypto.sign(null, signedMessage(meta.id, meta.version, sha256), privateKey);
  return {
    schema: SIGNATURE_SCHEMA,
    algorithm: 'ed25519',
    keyId: keyIdFor(Buffer.from(publicRaw, 'base64url').toString('base64')),
    id: meta.id,
    version: meta.version,
    sha256,
    signature: signature.toString('base64'),
  };
}

export type VerifyResult = { ok: true; signature: ModuleSignature; key: TrustedKey } | { ok: false; reason: string };

function parseSignature(raw: unknown): ModuleSignature | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'the signature file is not a JSON object';
  const s = raw as Record<string, unknown>;
  if (s.schema !== SIGNATURE_SCHEMA) return 'the signature file is for a newer Auto Tournament';
  if (s.algorithm !== 'ed25519') return `the signature algorithm '${String(s.algorithm).slice(0, 40)}' is not supported`;
  if (typeof s.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(s.keyId)) return 'the signature names no valid key';
  if (typeof s.id !== 'string' || !isValidModuleId(s.id)) return 'the signature names no valid module id';
  if (typeof s.version !== 'string' || !semver.valid(s.version)) return 'the signature names no valid version';
  if (typeof s.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) return 'the signature names no valid sha256';
  if (typeof s.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(s.signature)) {
    return 'the signature is not base64';
  }
  return s as unknown as ModuleSignature;
}

/**
 * Whether `archive` is the release `signatureText` vouches for, signed by a
 * key this platform trusts. `expected` pins what the caller asked for (the
 * catalog's id, version and sha256), so a valid signature for a different
 * module or version is refused too.
 *
 * Only hashes and compares: nothing in the archive is read as anything but
 * bytes.
 */
export function verifyModuleRelease(
  archive: Buffer,
  signatureText: string | Buffer,
  expected: { id: string; version?: string; sha256?: string | null },
  keys: TrustedKey[] = trustedKeys()
): VerifyResult {
  const text = Buffer.isBuffer(signatureText) ? signatureText.toString('utf8') : signatureText;
  if (Buffer.byteLength(text, 'utf8') > MAX_SIGNATURE_BYTES) {
    return { ok: false, reason: 'the signature file is too large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the signature file is not valid JSON' };
  }
  const parsed = parseSignature(raw);
  if (typeof parsed === 'string') return { ok: false, reason: parsed };

  const sha256 = sha256Hex(archive);
  if (parsed.sha256 !== sha256) {
    return { ok: false, reason: 'the archive does not match its signature (sha256 differs): it was changed after signing' };
  }
  if (expected.sha256 && expected.sha256.toLowerCase() !== sha256) {
    return { ok: false, reason: 'the archive does not match the sha256 the catalog lists' };
  }
  if (parsed.id !== expected.id) {
    return { ok: false, reason: `the signature is for '${parsed.id}', not '${expected.id}'` };
  }
  if (expected.version && parsed.version !== expected.version) {
    return { ok: false, reason: `the signature is for version ${parsed.version}, not ${expected.version}` };
  }

  const key = keys.find((candidate) => candidate.keyId === parsed.keyId);
  if (!key) return { ok: false, reason: `the release is signed by key ${parsed.keyId}, which this platform does not trust` };
  if (key.revoked) return { ok: false, reason: `the release is signed by key ${parsed.keyId}, which has been revoked` };

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      signedMessage(parsed.id, parsed.version, sha256),
      publicKeyObject(key),
      Buffer.from(parsed.signature, 'base64')
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'the signature does not verify: the release was not signed by a trusted key' };
  return { ok: true, signature: parsed, key };
}
