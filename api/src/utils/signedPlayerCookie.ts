/**
 * Signed player_steam_id cookie.
 *
 * We use the player_steam_id cookie for admin auth (when Passport session is
 * missing, e.g. behind Cloudflare Tunnel). The cookie is only set server-side
 * after Steam/OAuth login. To prevent forgery (e.g. setting it to an admin's
 * Steam ID in devtools), we sign it with SESSION_SECRET and verify on read.
 *
 * The value carries its own expiry, so a copied cookie stops working after
 * PLAYER_COOKIE_MAX_AGE_MS even where the browser would have kept it.
 * Older forms (unsigned, or signed without an expiry) are rejected; users
 * sign in again.
 */

import crypto from 'crypto';
import { sessionSecret } from '../config/sessionSecret';

const COOKIE_NAME = 'player_steam_id';
const SEP = '.';

const getSecret = sessionSecret;

export const PLAYER_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function hmac(key: string, value: string): string {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

/**
 * Produce a signed cookie value for the given Steam ID.
 * Use this when setting the player_steam_id cookie.
 */
export function signPlayerSteamId(steamId: string, now = Date.now()): string {
  const payload = `${steamId.trim()}${SEP}${Math.floor((now + PLAYER_COOKIE_MAX_AGE_MS) / 1000)}`;
  return `${payload}${SEP}${hmac(getSecret(), payload)}`;
}

/**
 * Parse Cookie header, extract player_steam_id, verify signature, and return
 * the Steam ID. Returns null if missing, invalid, or verification fails.
 */
export function getVerifiedPlayerSteamId(
  cookieHeader: string | undefined,
  now = Date.now()
): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const map = Object.fromEntries(
    cookieHeader
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [k, ...v] = p.split('=');
        const value = v.join('=').trim();
        // A malformed %-escape in any cookie must not throw.
        try {
          return [k, decodeURIComponent(value)];
        } catch {
          return [k, value];
        }
      })
  );
  const raw = map[COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;
  // `<steamId>.<expires, unix seconds>.<signature>`
  const i = raw.lastIndexOf(SEP);
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const j = payload.lastIndexOf(SEP);
  if (j <= 0 || !sig) return null;
  const steamId = payload.slice(0, j).trim();
  const expires = Number(payload.slice(j + 1));
  if (!steamId || !Number.isInteger(expires) || expires * 1000 <= now) return null;
  const expected = hmac(getSecret(), payload);
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return steamId;
}

export { COOKIE_NAME };
