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
 * Account linking ("Connect GitHub" on /me/connections) reuses this store. The
 * start route puts an intent on the request (`req.oauthLinkIntent`, see
 * `OAuthLinkIntent`); the store signs it into the cookie as an extra segment
 * (`nonce.expiresAt.intent.signature`), so the callback knows, from a value
 * only this server could have written, that the flow is a link for that
 * account and not a login. Login cookies keep the three-segment form.
 *
 * Every nonce is also single use on the server: a verified nonce is remembered
 * until it expires, so a copied cookie + state pair cannot be replayed, not
 * even from a browser that still holds the cookie. The registry is in memory,
 * which covers the single-process deployment this app ships as.
 *
 * This module deliberately has no DB imports so it can be unit-tested.
 */

import crypto from 'crypto';

/** Lifetime of a pending OAuth authorization, in milliseconds. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const SEP = '.';

/**
 * What a signed-in player asked for when the OAuth flow is "link this provider
 * to my account" rather than a login. Signed into the state cookie.
 */
export interface OAuthLinkIntent {
  purpose: 'link';
  /** The account (primary Steam ID) that started the link. */
  steamId: string;
}

/** A request carrying a link intent for the store to sign (set by the link start route). */
export type LinkIntentRequest = { oauthLinkIntent?: OAuthLinkIntent };

function encodeIntent(intent: OAuthLinkIntent): string {
  return Buffer.from(
    JSON.stringify({ purpose: intent.purpose, steamId: intent.steamId }),
    'utf8'
  ).toString('base64url');
}

/** Parse an intent segment. Only called once its signature has checked out. */
function decodeIntent(segment: string): OAuthLinkIntent | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') return null;
    const { purpose, steamId } = value as Record<string, unknown>;
    if (purpose !== 'link' || typeof steamId !== 'string' || !/^\d{17}$/.test(steamId)) {
      return null;
    }
    return { purpose, steamId };
  } catch {
    return null;
  }
}

/*
 * Server-side single use: nonce -> its expiry. Entries are dropped once
 * expired, since an expired state is refused anyway.
 */
const consumedNonces = new Map<string, number>();

function pruneConsumed(now: number): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt < now) consumedNonces.delete(nonce);
  }
}

/** Mark a nonce used; false when it already was. */
function consumeNonce(nonce: string, expiresAt: number, now: number): boolean {
  if (consumedNonces.size > 1000) pruneConsumed(now);
  const seen = consumedNonces.get(nonce);
  if (seen !== undefined && seen >= now) return false;
  consumedNonces.set(nonce, expiresAt);
  return true;
}

export function oauthStateCookieName(provider: string): string {
  return `oauth_state_${provider}`;
}

function defaultSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : 'auto-tournament-dev-session-secret';
}

function sign(
  secret: string,
  provider: string,
  nonce: string,
  expiresAt: number,
  intentSegment?: string
): string {
  const tail = intentSegment ? `${SEP}${intentSegment}` : '';
  return crypto
    .createHmac('sha256', secret)
    .update(`oauth-state:${provider}:${nonce}${SEP}${expiresAt}${tail}`, 'utf8')
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
 * value that proves this browser started the flow. With `intent`, the cookie
 * also carries the signed link intent.
 */
export function createOAuthState(
  provider: string,
  secret: string = defaultSecret(),
  now: number = Date.now(),
  intent?: OAuthLinkIntent
): { state: string; cookieValue: string; expiresAt: number } {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + OAUTH_STATE_TTL_MS;
  const intentSegment = intent ? encodeIntent(intent) : undefined;
  const sig = sign(secret, provider, nonce, expiresAt, intentSegment);
  const parts = intentSegment
    ? [nonce, String(expiresAt), intentSegment, sig]
    : [nonce, String(expiresAt), sig];
  return { state: nonce, cookieValue: parts.join(SEP), expiresAt };
}

export type OAuthStateFailure =
  | 'missing_cookie'
  | 'missing_state'
  | 'malformed_cookie'
  | 'bad_signature'
  | 'expired'
  | 'state_mismatch';

interface ParsedStateCookie {
  nonce: string;
  expiresAt: number;
  intent: OAuthLinkIntent | null;
}

/** Split and signature-check a cookie value. Expiry and the nonce match are the caller's. */
function parseSignedCookie(
  provider: string,
  cookieValue: string,
  secret: string
): { ok: true; cookie: ParsedStateCookie } | { ok: false; reason: OAuthStateFailure } {
  const parts = cookieValue.split(SEP);
  if (parts.length !== 3 && parts.length !== 4) return { ok: false, reason: 'malformed_cookie' };
  const [nonce, expiresRaw] = parts;
  const intentSegment = parts.length === 4 ? parts[2] : undefined;
  const sig = parts[parts.length - 1];
  if (!nonce || !sig || !/^\d+$/.test(expiresRaw) || intentSegment === '') {
    return { ok: false, reason: 'malformed_cookie' };
  }
  const expiresAt = Number(expiresRaw);

  if (!safeEqual(sig, sign(secret, provider, nonce, expiresAt, intentSegment))) {
    return { ok: false, reason: 'bad_signature' };
  }
  let intent: OAuthLinkIntent | null = null;
  if (intentSegment !== undefined) {
    intent = decodeIntent(intentSegment);
    if (!intent) return { ok: false, reason: 'malformed_cookie' };
  }
  return { ok: true, cookie: { nonce, expiresAt, intent } };
}

/**
 * Verify the `state` returned by the provider against the signed cookie.
 * Pure: single use is enforced by the store (`SignedCookieStateStore.verify`).
 */
export function verifyOAuthState(
  provider: string,
  cookieValue: string | undefined | null,
  providedState: string | undefined | null,
  secret: string = defaultSecret(),
  now: number = Date.now()
): { ok: true } | { ok: false; reason: OAuthStateFailure } {
  const result = checkOAuthState(provider, cookieValue, providedState, secret, now);
  return result.ok ? { ok: true } : result;
}

function checkOAuthState(
  provider: string,
  cookieValue: string | undefined | null,
  providedState: string | undefined | null,
  secret: string,
  now: number
): ({ ok: true } & ParsedStateCookie) | { ok: false; reason: OAuthStateFailure } {
  if (!cookieValue) return { ok: false, reason: 'missing_cookie' };
  if (!providedState || typeof providedState !== 'string') {
    return { ok: false, reason: 'missing_state' };
  }

  const parsed = parseSignedCookie(provider, cookieValue, secret);
  if (!parsed.ok) return parsed;
  const { nonce, expiresAt } = parsed.cookie;
  if (now > expiresAt) return { ok: false, reason: 'expired' };
  if (!safeEqual(nonce, providedState)) return { ok: false, reason: 'state_mismatch' };
  return { ok: true, ...parsed.cookie };
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

/**
 * The link intent in this request's state cookie, if the cookie is one this
 * server signed. For routing only: it checks neither expiry nor the returned
 * state and consumes nothing. The store's `verify` makes the real decision.
 */
export function peekOAuthLinkIntent(
  provider: string,
  cookieHeader: string | undefined,
  secret: string = defaultSecret()
): OAuthLinkIntent | null {
  const value = readCookie(cookieHeader, oauthStateCookieName(provider));
  if (!value) return null;
  const parsed = parseSignedCookie(provider, value, secret);
  return parsed.ok ? parsed.cookie.intent : null;
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
type VerifyCallback = (
  err: Error | null,
  ok?: boolean,
  info?: { message: string } | OAuthLinkIntent
) => void;

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
    const intent = (req as StateStoreRequest & LinkIntentRequest).oauthLinkIntent;
    const { state, cookieValue } = createOAuthState(
      this.provider,
      this.getSecret(),
      Date.now(),
      intent
    );
    req.res.cookie(oauthStateCookieName(this.provider), cookieValue, {
      ...this.cookieOptions(req),
      maxAge: OAUTH_STATE_TTL_MS,
    });
    callback(null, state);
  }

  verify(req: StateStoreRequest, providedState: string, callback: VerifyCallback): void {
    const name = oauthStateCookieName(this.provider);
    const cookieValue = readCookie(req.headers.cookie, name);
    const now = Date.now();
    const result = checkOAuthState(this.provider, cookieValue, providedState, this.getSecret(), now);

    // Single use: always drop the cookie once a callback has consumed it.
    if (cookieValue && req.res) {
      req.res.clearCookie(name, this.cookieOptions(req));
    }

    if (!result.ok) {
      callback(null, false, { message: `Invalid OAuth state (${result.reason})` });
      return;
    }
    // Single use on the server too, for a cookie + state pair copied elsewhere.
    if (!consumeNonce(result.nonce, result.expiresAt, now)) {
      callback(null, false, { message: 'Invalid OAuth state (replayed)' });
      return;
    }
    // passport-oauth2 hands a truthy third argument on as `info.state`: that
    // is how the callback learns the flow is a link, and for which account.
    if (result.intent) {
      callback(null, true, result.intent);
      return;
    }
    callback(null, true);
  }
}
