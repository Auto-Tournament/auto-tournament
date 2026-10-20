/**
 * Discord signs every request to the Interactions Endpoint with the app's
 * Ed25519 key (`X-Signature-Ed25519` over `X-Signature-Timestamp` + the raw
 * body). Kept apart from the database so it can be checked on its own.
 */
import { createPublicKey, verify } from 'node:crypto';

// The DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: Buffer
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), body]),
      key,
      Buffer.from(signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}
