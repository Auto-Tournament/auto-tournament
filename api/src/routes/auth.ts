import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { log } from '../utils/logger';
import { getAuthProvidersConfig } from '../config/authProviders';
import { steamService } from '../services/steamService';
import { playerService } from '../services/playerService';
import { passport } from '../config/passport';

const router = Router();

function getBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}

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

function getFrontendBaseUrl(req: Request): string {
  const configuredFrontendBaseUrl = process.env.FRONTEND_BASE_URL;
  const baseUrl =
    configuredFrontendBaseUrl && configuredFrontendBaseUrl.trim().length > 0
      ? configuredFrontendBaseUrl.trim().replace(/\/+$/, '')
      : getBaseUrl(req);
  return baseUrl;
}

/**
 * After a successful SSO/OIDC/OAuth login for an admin, we can drop the API
 * token directly into localStorage via a minimal HTML bridge. This lets the
 * existing token-based middleware continue to work, while users no longer
 * need to manually paste the token into the login form.
 */
function sendAdminLoginBridgePage(req: Request, res: Response): void {
  const frontendBaseUrl = getFrontendBaseUrl(req);
  const redirectUrl = `${frontendBaseUrl}/`;
  // With Passport sessions enabled, we don't need to drop tokens into localStorage.
  // Simply redirect back to the frontend; the session cookie will carry auth state.
  res.redirect(302, redirectUrl);
}

function isSteamAuthConfigured(): boolean {
  const apiKey = process.env.STEAM_API_KEY;
  return !!apiKey && apiKey.trim().length > 0;
}

/**
 * Start Steam login (players + admins) via Passport (passport-steam).
 *
 * GET /api/auth/steam
 */
router.get('/steam', (req: Request, res: Response, next) => {
  if (!isSteamAuthConfigured()) {
    log.warn('Steam auth requested but STEAM_API_KEY is not configured');
    return res.status(503).json({
      success: false,
      error:
        'Steam authentication is not configured on the server. Please set STEAM_API_KEY and restart the API.',
    });
  }

  return passport.authenticate('steam', {
    session: false,
  })(req, res, next);
});

/**
 * Steam callback (Passport)
 *
 * GET /api/auth/steam/callback
 *
 * Verifies the Steam OpenID assertion and redirects the user to /player/:steamId.
 * Also ensures a player record exists for the Steam ID.
 */
router.get('/steam/callback', (req: Request, res: Response, next) => {
  if (!isSteamAuthConfigured()) {
    log.warn('Steam callback hit but STEAM_API_KEY is not configured');
    return res.status(503).json({
      success: false,
      error:
        'Steam authentication is not configured on the server. Please set STEAM_API_KEY and restart the API.',
    });
  }

  return passport.authenticate('steam', {
    failureRedirect: '/app/login',
    session: false,
  })(req, res, async () => {
    try {
      const user = req.user as
        | {
            provider: 'steam';
            steamId: string;
            displayName?: string;
            avatarUrl?: string;
          }
        | undefined;

      const steamId = user?.steamId;
      if (!steamId) {
        log.warn('Steam Passport callback missing steamId on user');
        return res.status(400).json({
          success: false,
          error: 'Steam ID could not be determined from login',
        });
      }

      log.success('Steam Passport login verified', { steamId });

      // Best-effort: ensure we have a minimal player record for this Steam ID so
      // future tournaments and team imports can attach to it even if it was not
      // explicitly created yet. We fetch the name/avatar from Steam if a Web API
      // key is configured, but fall back to the profile data from Passport or raw ID.
      try {
        let displayName = user.displayName || steamId;
        let avatarUrl: string | undefined = user.avatarUrl;

        if (await steamService.isAvailable()) {
          const info = await steamService.getPlayerInfo(steamId);
          if (info) {
            displayName = info.name;
            avatarUrl = info.avatarUrl;
          }
        }

        await playerService.getOrCreatePlayer(steamId, displayName, avatarUrl);
        // If this is the very first admin, promote this Steam user to admin.
        await playerService.ensureFirstAdmin(steamId);
      } catch (playerError) {
        log.warn('Failed to ensure player record during Steam login', playerError as Error);
      }

      // Set a lightweight, non-privileged cookie for convenience.
      // This cookie is not used for authorization; it only lets the UI show a "My Profile" link.
      res.cookie('player_steam_id', steamId, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        // Make the cookie available to the whole site so the frontend can read it
        // from any page (e.g. for a future "My Profile" entry point).
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      });

      // Redirect player to their public profile page
      const baseUrl = getFrontendBaseUrl(req);
      const redirectTo = `${baseUrl}/player/${steamId}`;
      return res.redirect(302, redirectTo);
    } catch (error) {
      log.error('Steam Passport callback failed', error as Error);
      return res.status(500).json({
        success: false,
        error: 'Steam login failed',
      });
    }
  });
});

/**
 * Lightweight logout endpoint for player Steam sessions.
 *
 * POST /api/auth/logout
 *
 * This only clears the non-privileged player_steam_id cookie. It does NOT
 * affect admin API token authentication (which is handled purely on the
 * frontend via localStorage today).
 */
router.post('/logout', (_req: Request, res: Response) => {
  try {
    res.clearCookie('player_steam_id', {
      path: '/',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return res.status(204).end();
  } catch (error) {
    log.warn('Failed to clear player_steam_id cookie during logout', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to log out from Steam session',
    });
  }
});

/**
 * Keycloak OIDC admin login
 *
 * GET /api/auth/keycloak
 * Redirects to the Keycloak authorization endpoint.
 */
router.get(
  '/keycloak',
  passport.authenticate('keycloak', {
    session: false,
  })
);

/**
 * Keycloak OIDC callback
 *
 * GET /api/auth/keycloak/callback
 * Exchanges the authorization code for tokens and then drops the admin API
 * token into localStorage via a small HTML bridge page.
 */
router.get(
  '/keycloak/callback',
  passport.authenticate('keycloak', {
    failureRedirect: '/app/login',
    session: false,
  }),
  (req: Request, res: Response) => {
    // At this point the user is authenticated with Keycloak. We rely on
    // Keycloak realm/client configuration to restrict who can log in.
    log.success('Keycloak Passport login completed successfully');
    return sendAdminLoginBridgePage(req, res);
  }
);

/**
 * Discord OAuth2 admin login
 *
 * GET /api/auth/discord
 * Redirects to the Discord OAuth2 authorization endpoint.
 */
router.get(
  '/discord',
  passport.authenticate('discord', {
    session: false,
  })
);

/**
 * Discord OAuth2 callback
 *
 * GET /api/auth/discord/callback
 * Exchanges the authorization code for tokens and then drops the admin API
 * token into localStorage via a small HTML bridge page.
 */
router.get(
  '/discord/callback',
  passport.authenticate('discord', {
    failureRedirect: '/app/login',
    session: false,
  }),
  (req: Request, res: Response) => {
    // At this point the user is authenticated with Discord. We rely on
    // Discord app configuration (scopes, allowed users) to control access.
    log.success('Discord Passport login completed successfully');
    return sendAdminLoginBridgePage(req, res);
  }
);

/**
 * GitHub OAuth2 admin login
 *
 * GET /api/auth/github
 * Redirects to the GitHub OAuth2 authorization endpoint.
 */
router.get(
  '/github',
  passport.authenticate('github', {
    session: false,
  })
);

/**
 * GitHub OAuth2 callback
 *
 * GET /api/auth/github/callback
 * Exchanges the authorization code for tokens and then drops the admin API
 * token into localStorage via a small HTML bridge page.
 */
router.get(
  '/github/callback',
  passport.authenticate('github', {
    failureRedirect: '/app/login',
    session: false,
  }),
  (req: Request, res: Response) => {
    // At this point the user is authenticated with GitHub. We rely on
    // GitHub app configuration (org membership, allowed users) to control access.
    log.success('GitHub Passport login completed successfully');
    return sendAdminLoginBridgePage(req, res);
  }
);

/**
 * Public discovery endpoint: returns the list of configured auth providers.
 *
 * This is safe to expose to the frontend and is intended to drive dynamic
 * "Sign in with X" buttons (Steam, Keycloak, Discord, etc.).
 */
router.get('/providers', (_req: Request, res: Response) => {
  const providers = getAuthProvidersConfig();
  const hasProviders = providers.length > 0;
  return res.json({
    success: hasProviders,
    providers,
    error: hasProviders
      ? undefined
      : 'No authentication providers are configured. Enable at least Steam or another SSO provider in the server environment.',
  });
});

/**
 * Lightweight "who am I" endpoint for players.
 * This is not a security boundary; it only reflects the player_steam_id cookie.
 */
router.get('/me', (req: Request, res: Response) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const steamId = cookies.player_steam_id;

    if (!steamId) {
      return res.json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      steamId,
    });
  } catch (error) {
    log.warn('Failed to read player_steam_id cookie', error as Error);
    return res.json({
      authenticated: false,
    });
  }
});

/**
 * Admin "who am I" endpoint.
 * Returns basic info about the authenticated admin session (if any).
 */
router.get('/admin/me', (req: Request, res: Response) => {
  const anyReq = req as Request & {
    user?: {
      provider?: string;
      steamId?: string;
    };
    isAuthenticated?: () => boolean;
  };

  if (!anyReq.isAuthenticated || !anyReq.isAuthenticated() || !anyReq.user) {
    return res.json({
      authenticated: false,
    });
  }

  const { provider, steamId } = anyReq.user;

  return res.json({
    authenticated: true,
    provider,
    steamId: steamId || null,
  });
});

/**
 * Admin logout – destroys the Passport session.
 */
router.post('/admin/logout', (req: Request, res: Response) => {
  const anyReq = req as Request & {
    logout?: (cb: (err: unknown) => void) => void;
    session?: { destroy?: (cb: (err: unknown) => void) => void };
  };

  if (!anyReq.logout) {
    return res.status(204).end();
  }

  anyReq.logout((err) => {
    if (err) {
      log.error('Error during admin logout', err as Error);
      return res.status(500).json({
        success: false,
        error: 'Failed to log out admin session',
      });
    }

    if (anyReq.session && anyReq.session.destroy) {
      anyReq.session.destroy((destroyErr) => {
        if (destroyErr) {
          log.warn('Failed to destroy session during admin logout', destroyErr as Error);
        }
        return res.status(204).end();
      });
    } else {
      return res.status(204).end();
    }
  });
});

export default router;


