/**
 * Signed admin impersonation cookie.
 *
 * Admins can temporarily "view the site as" another player so they can walk
 * through player-facing flows (veto, team match pages, navbar CTAs) without
 * having to log in with that player's Steam account.
 *
 * Security model:
 * - The cookie only carries the *target* Steam ID; it never grants any rights
 *   on its own. It is signed with SESSION_SECRET so it cannot be forged.
 * - It is only honoured when the **real** requester is a verified admin
 *   (see `resolveViewerIdentity`). A non-admin who somehow obtains a valid
 *   impersonation cookie gets nothing: their effective identity stays their own.
 * - Admin authorization (`requireAuth`) deliberately ignores this cookie, so an
 *   admin impersonating a normal player keeps their admin session and can
 *   always stop impersonating.
 *
 * The signed payload is namespaced (`impersonate:<steamId>`) so a value signed
 * for the player_steam_id cookie can never be replayed as an impersonation
 * cookie, and vice versa.
 */

import crypto from 'crypto';

const COOKIE_NAME = 'mat_impersonate';
const SEP = '.';
const PAYLOAD_PREFIX = 'impersonate:';

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : 'matchzy-dev-session-secret';
}

function hmac(key: string, value: string): string {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

/**
 * Produce a signed cookie value for the impersonated Steam ID.
 */
export function signImpersonatedSteamId(steamId: string): string {
  const trimmed = steamId.trim();
  const sig = hmac(getSecret(), `${PAYLOAD_PREFIX}${trimmed}`);
  return `${trimmed}${SEP}${sig}`;
}

/**
 * Parse the Cookie header and return the impersonated Steam ID if the cookie is
 * present and its signature verifies. Returns null otherwise.
 *
 * NOTE: a non-null return does **not** mean impersonation is allowed – the
 * caller must still confirm the real requester is an admin.
 */
export function getSignedImpersonatedSteamId(cookieHeader: string | undefined): string | null {
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

  const expected = hmac(getSecret(), `${PAYLOAD_PREFIX}${steamId}`);
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

export { COOKIE_NAME as IMPERSONATION_COOKIE_NAME };
