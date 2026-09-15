/**
 * Signed, cookie-backed OAuth `state` store.
 *
 * Without `state`, passport-oauth2 falls back to its NullStore, which accepts
 * any `?code=` at the callback. That allows login CSRF: an attacker starts a
 * Discord/GitHub/Keycloak login in their own browser, keeps the `code`, and
 * gets a victim to open our callback with it. The victim's browser then
 * completes a login as the *attacker's* provider account (and, via the
 * player_steam_id fast path, links that account to the victim's Steam ID).
 *
 * Why a cookie and not `state: true` (session store): the Express session
 * cookie is documented to sometimes not survive the OAuth round trip (behind
 * Cloudflare Tunnel, Chrome + 302). That is the reason the signed
 * player_steam_id cookie fallback exists at all, so tying state to the session
 * would break logins for exactly those deployments.
 *
 * How it works:
 *  - On the initial redirect we generate a random nonce, send it to the
 *    provider as `state`, and set a short-lived, httpOnly, sameSite=lax cookie
 *    scoped to the callback path holding `nonce.expiresAt.signature`
 *    (HMAC-SHA256 with SESSION_SECRET, namespaced per provider).
 *    sameSite=lax is required: the provider's redirect back is a cross-site
 *    top-level GET, which lax cookies are sent on.
 *  - On the callback we check the signature and expiry, compare the nonce to
 *    the returned `state` in constant time, and clear the cookie.
 *
 * An attacker cannot plant this cookie in the victim's browser, so a `code`
 * obtained in the attacker's own browser can no longer be completed by a
 * victim.
 *
 * This module deliberately has no DB imports so it can be unit-tested.
 */

import crypto from 'crypto';

/** Lifetime of a pending OAuth authorization, in milliseconds. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const SEP = '.';

export function oauthStateCookieName(provider: string): string {
  return `oauth_state_${provider}`;
}

function defaultSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : 'matchzy-dev-session-secret';
}

function sign(secret: string, provider: string, nonce: string, expiresAt: number): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`oauth-state:${provider}:${nonce}${SEP}${expiresAt}`, 'utf8')
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Create a fresh state: the nonce to send as `state`, and the signed cookie
 * value that proves this browser started the flow.
 */
export function createOAuthState(
  provider: string,
  secret: string = defaultSecret(),
  now: number = Date.now()
): { state: string; cookieValue: string; expiresAt: number } {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + OAUTH_STATE_TTL_MS;
  const sig = sign(secret, provider, nonce, expiresAt);
  return { state: nonce, cookieValue: `${nonce}${SEP}${expiresAt}${SEP}${sig}`, expiresAt };
}

export type OAuthStateFailure =
  | 'missing_cookie'
  | 'missing_state'
  | 'malformed_cookie'
  | 'bad_signature'
  | 'expired'
  | 'state_mismatch';

/**
 * Verify the `state` returned by the provider against the signed cookie.
 */
export function verifyOAuthState(
  provider: string,
  cookieValue: string | undefined | null,
  providedState: string | undefined | null,
  secret: string = defaultSecret(),
  now: number = Date.now()
): { ok: true } | { ok: false; reason: OAuthStateFailure } {
  if (!cookieValue) return { ok: false, reason: 'missing_cookie' };
  if (!providedState || typeof providedState !== 'string') {
    return { ok: false, reason: 'missing_state' };
  }

  const parts = cookieValue.split(SEP);
  if (parts.length !== 3) return { ok: false, reason: 'malformed_cookie' };
  const [nonce, expiresRaw, sig] = parts;
  if (!nonce || !sig || !/^\d+$/.test(expiresRaw)) {
    return { ok: false, reason: 'malformed_cookie' };
  }
  const expiresAt = Number(expiresRaw);

  if (!safeEqual(sig, sign(secret, provider, nonce, expiresAt))) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (now > expiresAt) return { ok: false, reason: 'expired' };
  if (!safeEqual(nonce, providedState)) return { ok: false, reason: 'state_mismatch' };
  return { ok: true };
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Minimal request/response shape the store needs (Express-compatible). */
export interface StateStoreRequest {
  headers: { cookie?: string; 'x-forwarded-proto'?: string | string[] };
  secure?: boolean;
  res?: {
    cookie: (name: string, value: string, options: Record<string, unknown>) => unknown;
    clearCookie: (name: string, options: Record<string, unknown>) => unknown;
  };
}

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (err: Error | null, ok?: boolean, info?: { message: string }) => void;

/**
 * passport-oauth2 state store (the `store` strategy option) backed by the
 * signed cookie above. Uses the 3-argument `store(req, meta, cb)` and
 * `verify(req, state, cb)` signatures that passport-oauth2 dispatches on.
 */
export class SignedCookieStateStore {
  private readonly provider: string;
  private readonly cookiePath: string;
  private readonly getSecret: () => string;

  constructor(options: { provider: string; callbackURL: string; secret?: () => string }) {
    this.provider = options.provider;
    this.getSecret = options.secret ?? defaultSecret;
    // Scope the cookie to the callback path so it is only ever sent there.
    let path = '/';
    try {
      path = new URL(options.callbackURL).pathname || '/';
    } catch {
      path = '/';
    }
    this.cookiePath = path;
  }

  private cookieOptions(req: StateStoreRequest): Record<string, unknown> {
    const forwarded = req.headers['x-forwarded-proto'];
    const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || '';
    const frontend = process.env.FRONTEND_BASE_URL || '';
    const secure =
      proto.toLowerCase().includes('https') ||
      req.secure === true ||
      frontend.trim().startsWith('https://');
    return { httpOnly: true, sameSite: 'lax', secure, path: this.cookiePath };
  }

  store(req: StateStoreRequest, _meta: unknown, callback: StoreCallback): void {
    if (!req.res) {
      callback(new Error('OAuth state store requires an Express response on the request'));
      return;
    }
    const { state, cookieValue } = createOAuthState(this.provider, this.getSecret());
    req.res.cookie(oauthStateCookieName(this.provider), cookieValue, {
      ...this.cookieOptions(req),
      maxAge: OAUTH_STATE_TTL_MS,
    });
    callback(null, state);
  }

  verify(req: StateStoreRequest, providedState: string, callback: VerifyCallback): void {
    const name = oauthStateCookieName(this.provider);
    const cookieValue = readCookie(req.headers.cookie, name);
    const result = verifyOAuthState(this.provider, cookieValue, providedState, this.getSecret());

    // Single use: always drop the cookie once a callback has consumed it.
    if (cookieValue && req.res) {
      req.res.clearCookie(name, this.cookieOptions(req));
    }

    if (!result.ok) {
      callback(null, false, { message: `Invalid OAuth state (${result.reason})` });
      return;
    }
    callback(null, true);
  }
}
