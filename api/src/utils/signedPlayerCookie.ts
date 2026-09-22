/**
 * Signed player_steam_id cookie.
 *
 * We use the player_steam_id cookie for admin auth (when Passport session is
 * missing, e.g. behind Cloudflare Tunnel). The cookie is only set server-side
 * after Steam/OAuth login. To prevent forgery (e.g. setting it to an admin's
 * Steam ID in devtools), we sign it with SESSION_SECRET and verify on read.
 *
 * Old unsigned cookies are rejected; users must sign in again after deploy.
 */

import crypto from 'crypto';

const COOKIE_NAME = 'player_steam_id';
const SEP = '.';

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : 'matchzy-dev-session-secret';
}

function hmac(key: string, value: string): string {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

/**
 * Produce a signed cookie value for the given Steam ID.
 * Use this when setting the player_steam_id cookie.
 */
export function signPlayerSteamId(steamId: string): string {
  const trimmed = steamId.trim();
  const sig = hmac(getSecret(), trimmed);
  return `${trimmed}${SEP}${sig}`;
}

/**
 * Parse Cookie header, extract player_steam_id, verify signature, and return
 * the Steam ID. Returns null if missing, invalid, or verification fails.
 */
export function getVerifiedPlayerSteamId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const map = Object.fromEntries(
    cookieHeader
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [k, ...v] = p.split('=');
        return [k, decodeURIComponent((v.join('=') ?? '').trim())];
      })
  );
  const raw = map[COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;
  const i = raw.lastIndexOf(SEP);
  if (i <= 0) return null;
  const steamId = raw.slice(0, i).trim();
  const sig = raw.slice(i + 1);
  if (!steamId || !sig) return null;
  const expected = hmac(getSecret(), steamId);
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
