/**
 * Signed `pending_steam_link` cookie.
 *
 * When an SSO login (Discord, Keycloak, GitHub, Google) needs the user to prove a Steam
 * account, we remember "link this SSO identity once Steam has signed them in".
 * The session copy of that does not survive: Passport regenerates the session
 * when the Steam OpenID login completes. So a short-lived cookie is what
 * actually carries the pending link into `/steam/callback`, and that handler
 * links the identity to the Steam account it just proved.
 *
 * That handler used to re-point an existing link on conflict, which made the
 * cookie a write capability over someone else's login. It now refuses an
 * identity that already belongs to another account (see
 * `completePendingSteamLink`), and the cookie is still hardened. It used
 * to be plain JSON, so anyone could set it to a victim's Discord ID, sign in
 * with their own Steam account, and have the victim's Discord login re-pointed
 * at the attacker's account. So it is now:
 *
 * - **Signed** with SESSION_SECRET (HMAC-SHA256, compared with
 *   `crypto.timingSafeEqual`), like `player_steam_id`. The signed input is
 *   namespaced (`pending_steam_link:`) so a signature minted for another cookie
 *   can never be replayed as this one.
 * - **Expiring inside the signature.** The cookie's `maxAge` is only advice to
 *   the browser; a copied value can be replayed long after. The expiry in the
 *   signed payload is what the server enforces.
 * - **Strictly shaped.** A good signature over a payload we would never have
 *   written (unknown provider, empty ID) is still rejected.
 *
 * Old unsigned cookies from before this change are rejected. They only ever
 * lived ten minutes, so the cost is at most one user repeating a Steam sign-in.
 *
 * Deliberately free of DB and Express imports, so it can be unit-tested as is.
 */

import crypto from 'crypto';

export const PENDING_STEAM_LINK_COOKIE_NAME = 'pending_steam_link';

/** Matches the cookie's `maxAge`; the signed expiry is the one that counts. */
export const PENDING_STEAM_LINK_TTL_MS = 1000 * 60 * 10;

/**
 * The SSO providers that can have a pending Steam link. Kept in sync with
 * `AuthProvider` in services/authIdentityService (not imported, to keep this
 * module free of DB imports; auth.ts passes one to the other, so a mismatch is
 * a type error there).
 */
export const PENDING_STEAM_LINK_PROVIDERS = ['discord', 'keycloak', 'github', 'google'] as const;
export type PendingSteamLinkProvider = (typeof PENDING_STEAM_LINK_PROVIDERS)[number];

export interface PendingSteamLink {
  provider: PendingSteamLinkProvider;
  providerUserId: string;
}

export type PendingSteamLinkRejection =
  /** No cookie at all. Normal for a plain Steam login; not worth a warning. */
  | 'missing'
  /** Not `<payload>.<signature>`, or the payload is not valid JSON. */
  | 'malformed'
  /** Signature does not match (tampered, forged, or signed with another secret). */
  | 'bad-signature'
  /** Signature is fine but the payload is past its expiry. */
  | 'expired'
  /** Signature is fine but the payload has the wrong shape. */
  | 'invalid-payload';

export type PendingSteamLinkVerification =
  | { ok: true; link: PendingSteamLink; expiresAt: number }
  | { ok: false; reason: PendingSteamLinkRejection };

export interface PendingSteamLinkOptions {
  /** Defaults to SESSION_SECRET (with the same dev fallback as the other signed cookies). */
  secret?: string;
  /** Milliseconds since the epoch. Defaults to `Date.now()`; injectable for tests. */
  now?: number;
}

const SEP = '.';
const SIGNATURE_NAMESPACE = 'pending_steam_link:';

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : 'auto-tournament-dev-session-secret';
}

function hmac(key: string, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(`${SIGNATURE_NAMESPACE}${value}`, 'utf8').digest();
}

function isKnownProvider(value: unknown): value is PendingSteamLinkProvider {
  return (
    typeof value === 'string' && (PENDING_STEAM_LINK_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Produce the cookie value for a pending link. The payload is base64url JSON
 * (`{ provider, providerUserId, exp }`), so the value needs no cookie escaping.
 *
 * `expiresAt` exists for tests that need an already-expired cookie; production
 * callers leave it alone and get `now + PENDING_STEAM_LINK_TTL_MS`.
 */
export function signPendingSteamLink(
  link: PendingSteamLink,
  options: PendingSteamLinkOptions & { expiresAt?: number } = {}
): string {
  const now = options.now ?? Date.now();
  const exp = options.expiresAt ?? now + PENDING_STEAM_LINK_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ provider: link.provider, providerUserId: link.providerUserId, exp }),
    'utf8'
  ).toString('base64url');
  const sig = hmac(options.secret ?? getSecret(), payload).toString('base64url');
  return `${payload}${SEP}${sig}`;
}

/**
 * Check a raw cookie value. Anything short of a correctly signed, unexpired,
 * well-shaped payload is rejected, with a reason for logging.
 *
 * The signature is checked before the payload is parsed at all, so nothing an
 * attacker writes is interpreted until we know we wrote it.
 */
export function verifyPendingSteamLink(
  raw: string | undefined | null,
  options: PendingSteamLinkOptions = {}
): PendingSteamLinkVerification {
  if (raw === undefined || raw === null || raw === '') return { ok: false, reason: 'missing' };
  if (typeof raw !== 'string') return { ok: false, reason: 'malformed' };

  const parts = raw.split(SEP);
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payload, sig] = parts;
  const base64url = /^[A-Za-z0-9_-]+$/;
  if (!base64url.test(payload) || !base64url.test(sig)) return { ok: false, reason: 'malformed' };

  const expected = hmac(options.secret ?? getSecret(), payload);
  const presented = Buffer.from(sig, 'base64url');
  // Base64 decoding ignores the spare low bits of the last character, so
  // several spellings decode to the same bytes. Only the canonical one counts,
  // so "the signature string changed" always means "rejected".
  if (presented.toString('base64url') !== sig) return { ok: false, reason: 'bad-signature' };
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    // Only reachable with a valid signature, i.e. never for values we wrote.
    return { ok: false, reason: 'malformed' };
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return { ok: false, reason: 'invalid-payload' };
  }
  const { provider, providerUserId, exp } = decoded as Record<string, unknown>;
  if (
    !isKnownProvider(provider) ||
    typeof providerUserId !== 'string' ||
    providerUserId.trim() === '' ||
    typeof exp !== 'number' ||
    !Number.isFinite(exp)
  ) {
    return { ok: false, reason: 'invalid-payload' };
  }

  const now = options.now ?? Date.now();
  if (now >= exp) return { ok: false, reason: 'expired' };

  return { ok: true, link: { provider, providerUserId }, expiresAt: exp };
}
