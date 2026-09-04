import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { getVerifiedPlayerSteamId } from '../utils/signedPlayerCookie';
import { shouldBlockAdminAsDirectAccess } from '../utils/canonicalOrigin';
import {
  extractPresentedToken,
  findServiceToken,
  getServiceTokens,
  isReadOnlyMethod,
  type ServiceTokenScope,
} from '../utils/serviceTokens';

/**
 * Authentication middleware for admin routes.
 *
 * Admin rights are always determined by the **Steam ID**:
 *  - We look up players.is_admin for the linked Steam ID.
 *  - SSO providers (Keycloak/Discord/GitHub) must also be linked to a Steam ID
 *    via the "Link Steam" flow to gain admin access.
 *
 * We accept **two** ways to prove admin access:
 *  1. **Passport session** (connect.sid) — used when it works (e.g. same-origin, no tunnel).
 *  2. **Signed player_steam_id cookie** — verified with SESSION_SECRET. Used when the
 *     session cookie is dropped (e.g. Cloudflare Tunnel, Chrome + 302). Steam ID must
 *     map to admin in DB.
 *
 * **Direct access block:** Only when FRONTEND_BASE_URL is a **domain** (not IP/localhost)
 * and the request has **no** X-Forwarded-* (direct to container) do we block admin.
 * Otherwise we always run full auth (session + cookie fallback) so the alternative
 * admin check is never skipped.
 *
 * There is a third way in, for machines rather than people: a **service token**
 * from `API_TOKENS` / `API_TOKENS_READONLY`, presented as `Authorization: Bearer
 * <token>`. See `utils/serviceTokens`. It is checked first and deliberately
 * skips the direct-access block — that block exists to stop a *browser* from
 * reaching admin around the reverse proxy, and an integration calling the
 * container directly (a bot on the same Docker network, say) is the normal
 * case, not the suspicious one.
 */
async function checkAdminBySteamId(steamId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ is_admin?: number }>(
    'SELECT is_admin FROM players WHERE id = ?',
    [steamId]
  );
  return row?.is_admin === 1;
}

/** What authenticated a request, once `requireAuth` has let it through. */
export interface ServiceTokenIdentity {
  label: string;
  scope: ServiceTokenScope;
  fingerprint: string;
}

export type AuthedRequest = Request & { serviceToken?: ServiceTokenIdentity };

export type ServiceTokenAuthResult =
  | { ok: true; identity: ServiceTokenIdentity }
  // 401 when the token itself is not accepted, 403 when a perfectly good token
  // is not allowed to do this — so a bot can tell "rotate my secret" apart from
  // "ask for a wider scope".
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Resolve a service token from the request headers.
 *
 * Returns `null` when no token was presented at all, so the caller can fall
 * through to session auth. A token that *was* presented but does not match is
 * an outcome, not a fall-through: see `requireAuth`.
 */
export function authenticateServiceToken(req: Request): ServiceTokenAuthResult | null {
  const presented = extractPresentedToken(req.headers);
  if (!presented) return null;

  const { tokens } = getServiceTokens();
  if (tokens.length === 0) {
    return { ok: false, status: 401, reason: 'No API tokens are configured on this instance' };
  }

  const token = findServiceToken(presented, tokens);
  if (!token) {
    return { ok: false, status: 401, reason: 'Invalid API token' };
  }

  if (token.scope === 'readonly' && !isReadOnlyMethod(req.method)) {
    return {
      ok: false,
      status: 403,
      reason: `API token "${token.label}" is read-only and cannot ${req.method} this endpoint`,
    };
  }

  return {
    ok: true,
    identity: { label: token.label, scope: token.scope, fingerprint: token.fingerprint },
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Service tokens are checked before anything else. A caller that presents one
  // has told us it is a machine, so falling back to session auth on a bad token
  // would only turn "your token is wrong" into "you are not signed in" — the
  // wrong answer to a question the bot's author is trying to debug.
  const tokenAuth = authenticateServiceToken(req);
  if (tokenAuth) {
    if (tokenAuth.ok) {
      (req as AuthedRequest).serviceToken = tokenAuth.identity;
      return next();
    }

    log.authFailed(req.path, tokenAuth.reason);
    res.status(tokenAuth.status).json({ success: false, error: tokenAuth.reason });
    return;
  }

  if (shouldBlockAdminAsDirectAccess(req)) {
    log.authFailed(req.path, 'Admin access blocked for direct container access (use reverse proxy)');
    res.status(403).json({
      success: false,
      error:
        'Admin access is only allowed via the configured frontend URL. Connect through your reverse proxy (e.g. HTTPS domain), not directly to the container.',
    });
    return;
  }

  const anyReq = req as Request & {
    user?: {
      provider?: string;
      steamId?: string;
    };
    isAuthenticated?: () => boolean;
  };

  const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);

  let steamId: string | null = null;

  if (anyReq.isAuthenticated && anyReq.isAuthenticated() && anyReq.user) {
    const userSteamId = (anyReq.user as { steamId?: string }).steamId;
    steamId = userSteamId || cookieSteamId || null;
    if (!steamId) {
      log.authFailed(req.path, 'Authenticated session has no linked Steam ID');
      res.status(403).json({
        success: false,
        error: 'Forbidden - Admin account must be linked to a Steam ID',
      });
      return;
    }
  } else if (cookieSteamId) {
    steamId = cookieSteamId;
  }

  if (!steamId) {
    log.authFailed(req.path, 'Missing or invalid admin session');
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Admin session required',
    });
    return;
  }

  try {
    const isAdmin = await checkAdminBySteamId(steamId);
    if (isAdmin) {
      return next();
    }
    log.authFailed(req.path, `Steam user ${steamId} is not an admin`);
    res.status(403).json({
      success: false,
      error: 'Forbidden - Admin access required',
    });
  } catch (error) {
    log.error('Failed to verify Steam admin in requireAuth', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify admin permissions',
    });
  }
}
