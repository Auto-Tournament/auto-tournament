import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { getVerifiedPlayerSteamId } from '../utils/signedPlayerCookie';
import { shouldBlockAdminAsDirectAccess } from '../utils/canonicalOrigin';

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
 */
async function checkAdminBySteamId(steamId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ is_admin?: number }>(
    'SELECT is_admin FROM players WHERE id = ?',
    [steamId]
  );
  return row?.is_admin === 1;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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
