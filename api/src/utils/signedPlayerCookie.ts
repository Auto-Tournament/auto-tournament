/**
 * Signed player_steam_id cookie.
 *
 * The player_steam_id cookie names the signed-in player for player-facing
 * endpoints. It never grants admin: that needs the Passport session. The cookie
 * is only set server-side after Steam/OAuth login. To prevent forgery (e.g.
 * setting it to another player's Steam ID in devtools), we sign it with
 * SESSION_SECRET and verify on read.
 *
 * The value is `<id>|<iat>|<exp>.<sig>` (seconds since the epoch), signed as
 * `player:<id>|<iat>|<exp>`; it stops verifying after `exp`. Older forms
 * (unsigned, or `<id>.<sig>`) are rejected; users sign in again.
 */

import crypto from 'crypto';

const COOKIE_NAME = 'player_steam_id';
const SEP = '.';
const FIELD_SEP = '|';
const PAYLOAD_PREFIX = 'player:';
export const PLAYER_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0
    ? s.trim()
    : 'auto-tournament-dev-session-secret';
}

function hmac(key: string, value: string): string {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

/**
 * Produce a signed cookie value for the given Steam ID.
 * Use this when setting the player_steam_id cookie.
 */
export function signPlayerSteamId(steamId: string, now: number = Date.now()): string {
  const trimmed = steamId.trim();
  const iat = Math.floor(now / 1000);
  const exp = Math.floor((now + PLAYER_COOKIE_TTL_MS) / 1000);
  const body = [trimmed, iat, exp].join(FIELD_SEP);
  const sig = hmac(getSecret(), `${PAYLOAD_PREFIX}${body}`);
  return `${body}${SEP}${sig}`;
}

/**
 * Parse Cookie header, extract player_steam_id, verify signature, and return
 * the Steam ID. Returns null if missing, invalid, or verification fails.
 */
export function getVerifiedPlayerSteamId(
  cookieHeader: string | undefined,
  now: number = Date.now()
): string | null {
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
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const [steamId, iat, exp, ...extra] = body.split(FIELD_SEP);
  if (
    !steamId ||
    !sig ||
    extra.length > 0 ||
    !/^\d+$/.test(iat ?? '') ||
    !/^\d+$/.test(exp ?? '')
  ) {
    return null;
  }
  const expected = hmac(getSecret(), `${PAYLOAD_PREFIX}${body}`);
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  if (Number(exp) * 1000 <= now) return null;
  return steamId;
}

export { COOKIE_NAME };
