/**
 * Passkeys for local admin accounts (Vikunja 1741): a passkey signs its
 * account in instead of the password and TOTP. It needs user verification
 * (a fingerprint, face or PIN on the device), so it is two factors on its own.
 *
 * The relying party is the platform's public address (FRONTEND_BASE_URL):
 * its origin, and its hostname as the RP ID. Browsers only allow WebAuthn on
 * https or localhost, so on plain http over a LAN address passkeys are not
 * offered (`passkeyRelyingParty` answers null).
 *
 * The WebAuthn ceremony sits behind `Verifier`, so the flow can be tested
 * with a fake one (tests/api/local-admin-passkeys.spec.ts).
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { db } from '../config/database';

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};

export interface RelyingParty {
  name: string;
  id: string;
  origin: string;
}

/** The relying party for this install, or null when the browser won't allow passkeys here. */
export function passkeyRelyingParty(
  baseUrl: string | undefined = process.env.FRONTEND_BASE_URL
): RelyingParty | null {
  if (!baseUrl) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return { name: 'Auto Tournament', id: url.hostname, origin: url.origin };
}

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
}

export interface Verifier {
  registrationOptions(input: {
    rp: RelyingParty;
    userId: string;
    userName: string;
    exclude: { id: string; transports: string[] }[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: {
    rp: RelyingParty;
    response: RegistrationResponseJSON;
    challenge: string;
  }): Promise<{ verified: false } | { verified: true; credential: StoredCredential }>;
  authenticationOptions(input: {
    rp: RelyingParty;
  }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: {
    rp: RelyingParty;
    response: AuthenticationResponseJSON;
    challenge: string;
    credential: StoredCredential;
  }): Promise<{ verified: boolean; newCounter: number }>;
}

type Transport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export const simpleWebAuthn: Verifier = {
  registrationOptions: ({ rp, userId, userName, exclude }) =>
    generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName,
      userID: new Uint8Array(Buffer.from(userId, 'utf8')),
      attestationType: 'none',
      excludeCredentials: exclude.map((c) => ({
        id: c.id,
        transports: c.transports as Transport[],
      })),
      // A discoverable passkey, so sign-in needs no username; and a biometric or PIN check.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 120_000,
    }),
  async verifyRegistration({ rp, response, challenge }) {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
    if (!result.verified) return { verified: false };
    const c = result.registrationInfo.credential;
    return {
      verified: true,
      credential: {
        id: c.id,
        publicKey: c.publicKey,
        counter: c.counter,
        transports: c.transports ?? [],
      },
    };
  },
  authenticationOptions: ({ rp }) =>
    generateAuthenticationOptions({
      rpID: rp.id,
      allowCredentials: [],
      userVerification: 'required',
      timeout: 120_000,
    }),
  async verifyAuthentication({ rp, response, challenge, credential }) {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
        counter: credential.counter,
        transports: credential.transports as Transport[],
      },
      requireUserVerification: true,
    });
    return { verified: result.verified, newCounter: result.authenticationInfo.newCounter };
  },
};

let verifier: Verifier = simpleWebAuthn;
/** The verifier in use (tests swap in a fake through /api/test). */
export const passkeyVerifier = (): Verifier => verifier;
export function setPasskeyVerifier(next: Verifier | null): void {
  verifier = next ?? simpleWebAuthn;
}

export interface PasskeyView {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface PasskeyRow {
  id: string;
  player_id: string;
  public_key: string;
  counter: number | string;
  transports: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

const toB64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

function parseTransports(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export const localAdminPasskeys = {
  async list(playerId: string): Promise<PasskeyView[]> {
    const rows = await db.queryAsync<PasskeyRow>(
      'SELECT * FROM local_admin_passkeys WHERE player_id = ? ORDER BY created_at, id',
      [playerId]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: Number(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
    }));
  },

  async credentialsOf(playerId: string): Promise<{ id: string; transports: string[] }[]> {
    const rows = await db.queryAsync<PasskeyRow>(
      'SELECT id, transports FROM local_admin_passkeys WHERE player_id = ?',
      [playerId]
    );
    return rows.map((r) => ({ id: r.id, transports: parseTransports(r.transports) }));
  },

  async find(id: string): Promise<{ playerId: string; credential: StoredCredential } | null> {
    const row = await db.queryOneAsync<PasskeyRow>(
      'SELECT * FROM local_admin_passkeys WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return {
      playerId: row.player_id,
      credential: {
        id: row.id,
        publicKey: fromB64url(row.public_key),
        counter: Number(row.counter),
        transports: parseTransports(row.transports),
      },
    };
  },

  async add(playerId: string, credential: StoredCredential, name: string): Promise<PasskeyView> {
    const now = Math.floor(Date.now() / 1000);
    await db.runAsync(
      `INSERT INTO local_admin_passkeys (id, player_id, public_key, counter, transports, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        credential.id,
        playerId,
        toB64url(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports),
        name,
        now,
      ]
    );
    return { id: credential.id, name, createdAt: now, lastUsedAt: null };
  },

  async used(id: string, counter: number): Promise<void> {
    await db.runAsync(
      'UPDATE local_admin_passkeys SET counter = ?, last_used_at = ? WHERE id = ?',
      [counter, Math.floor(Date.now() / 1000), id]
    );
  },

  async remove(playerId: string, id: string): Promise<boolean> {
    const rows = await db.queryAsync<{ id: string }>(
      'DELETE FROM local_admin_passkeys WHERE player_id = ? AND id = ? RETURNING id',
      [playerId, id]
    );
    return rows.length > 0;
  },
};

/** A passkey's name: trimmed, at most 60 characters; empty means `fallback`. */
export function passkeyName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
  return name || fallback;
}
