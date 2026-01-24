import type { Request } from 'express';
import { isIP } from 'net';

/**
 * Admin access restriction for "direct" container access.
 *
 * Context:
 * - Reverse proxy sometimes drops session cookies (e.g. Chrome + 302 on OAuth).
 *   We use a cookie fallback (player_steam_id + DB is_admin) so admin still works.
 * - Some users run without a reverse proxy and set FRONTEND_BASE_URL to IP:port.
 *   We must not break them; the cookie fallback must always be used when applicable.
 *
 * We only restrict admin when **both**:
 *  1. FRONTEND_BASE_URL is set to a **domain** (not localhost, not 127.0.0.1, not an IP).
 *  2. The request appears **direct** (no X-Forwarded-For / X-Forwarded-Proto), i.e. not
 *     through a reverse proxy.
 *
 * In that case we block admin (403 / unauthenticated). Otherwise we always run the full
 * auth check (session + cookie fallback), so the alternative admin check is never skipped.
 *
 * - Proxy + domain: X-Forwarded-* present → no restrict → full auth, cookie fallback works.
 * - Direct + domain: no X-Forwarded-* → restrict → block admin.
 * - FRONTEND_BASE_URL = IP or localhost: we never restrict → full auth, cookie fallback works.
 */

function getCanonicalDomain(): string | null {
  const raw = process.env.FRONTEND_BASE_URL;
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const url = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
    const host = url.hostname?.toLowerCase();
    if (!host) return null;
    if (host === 'localhost' || host === '127.0.0.1') return null;
    if (isIP(host) !== 0) return null;
    return host;
  } catch {
    return null;
  }
}

function isRequestProxied(req: Request): boolean {
  const forwardedFor = req.get('x-forwarded-for');
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) return true;
  const forwardedProto = req.get('x-forwarded-proto');
  if (typeof forwardedProto === 'string' && forwardedProto.trim().length > 0) return true;
  return false;
}

/**
 * Returns true if we should block admin access for this request.
 * Block only when a canonical **domain** is configured and the request looks **direct**
 * (no proxy headers). Otherwise we always allow the normal auth flow (session + cookie).
 */
export function shouldBlockAdminAsDirectAccess(req: Request): boolean {
  const domain = getCanonicalDomain();
  if (!domain) return false;
  if (isRequestProxied(req)) return false;
  return true;
}

export function getCanonicalHostnameOrNull(): string | null {
  return getCanonicalDomain();
}
