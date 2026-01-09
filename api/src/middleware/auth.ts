import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';
import { db } from '../config/database';

/**
 * Authentication middleware for admin routes.
 *
 * Admin rights are always determined by the **Steam ID**:
 *  - We look up players.is_admin for the linked Steam ID.
 *  - SSO providers (Keycloak/Discord/GitHub) must also be linked to a Steam ID
 *    via the "Link Steam" flow to gain admin access.
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split('=');
        return [name, decodeURIComponent(rest.join('='))];
      })
  );
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const anyReq = req as Request & {
    user?: {
      provider?: string;
      steamId?: string;
    };
    isAuthenticated?: () => boolean;
  };

  // Passport session (UI)
  if (anyReq.isAuthenticated && anyReq.isAuthenticated() && anyReq.user) {
    const { steamId: userSteamId } = anyReq.user;

    // Resolve the Steam ID to check admin rights:
    // - Prefer steamId from the Passport user object (Steam login).
    // - Fallback to the player_steam_id cookie (for SSO providers that linked Steam).
    const cookies = parseCookies(req.headers.cookie);
    const cookieSteamId = cookies.player_steam_id;
    const steamId = userSteamId || cookieSteamId;

    if (!steamId) {
      log.authFailed(req.path, 'Authenticated session has no linked Steam ID');
      res.status(403).json({
        success: false,
        error: 'Forbidden - Admin account must be linked to a Steam ID',
      });
      return;
    }

    try {
      const row = await db.queryOneAsync<{ is_admin?: number }>(
        'SELECT is_admin FROM players WHERE id = ?',
        [steamId]
      );
      if (row?.is_admin === 1) {
        return next();
      }

      log.authFailed(req.path, `Steam user ${steamId} is not an admin`);
      res.status(403).json({
        success: false,
        error: 'Forbidden - Admin access required',
      });
      return;
    } catch (error) {
      log.error('Failed to verify Steam admin in requireAuth', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify admin permissions',
      });
      return;
    }
  }

  // No valid Passport session / linked Steam admin found.
  log.authFailed(req.path, 'Missing or invalid admin session');
  res.status(401).json({
    success: false,
    error: 'Unauthorized - Admin session required',
  });
}
