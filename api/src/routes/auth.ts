import { Router, Request, Response } from 'express';
import { log } from '../utils/logger';
import { getAuthProvidersConfig } from '../config/authProviders';
import { steamService } from '../services/steamService';
import { playerService } from '../services/playerService';
import { passport } from '../config/passport';
import { settingsService } from '../services/settingsService';
import { authIdentityService, AuthProvider } from '../services/authIdentityService';
import {
  signPlayerSteamId,
  getVerifiedPlayerSteamId,
} from '../utils/signedPlayerCookie';
import { shouldBlockAdminAsDirectAccess } from '../utils/canonicalOrigin';

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
 * Returns minimal HTML that redirects via meta refresh.
 * Use instead of 302 when setting cookies (e.g. OAuth callback): some browsers
 * (Chrome) drop Set-Cookie on 302 responses from cross-site redirects (e.g.
 * Steam → our callback). A 200 + meta refresh avoids that.
 */
function htmlRedirectPage(redirectTo: string): string {
  const u = redirectTo
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${u}"></head><body>Signing you in&hellip;</body></html>`;
}

/**
 * After a successful SSO/OIDC/OAuth login for an admin, we can drop the API
 * token directly into localStorage via a minimal HTML bridge. This lets the
 * existing token-based middleware continue to work, while users no longer
 * need to manually paste the token into the login form.
 */
function sendAdminLoginBridgePage(req: Request, res: Response): void {
  const frontendBaseUrl = getFrontendBaseUrl(req);
  const redirectUrl = `${frontendBaseUrl}/connect-steam`;
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

  // Initial redirect – session will be established on the callback.
  return passport.authenticate('steam')(req, res, next);
});

/**
 * Steam callback (Passport)
 *
 * GET /api/auth/steam/callback
 *
 * Verifies the Steam OpenID assertion and redirects the user to /player/:steamId.
 * Also ensures a player record exists for the Steam ID.
 */
router.get('/steam/callback', (req: Request, res: Response, _next) => {
  if (!isSteamAuthConfigured()) {
    log.warn('Steam callback hit but STEAM_API_KEY is not configured');
    return res.status(503).json({
      success: false,
      error:
        'Steam authentication is not configured on the server. Please set STEAM_API_KEY and restart the API.',
    });
  }

  return passport.authenticate('steam', {
    failureRedirect: '/login',
    // Use Passport sessions so admin routes can rely on req.isAuthenticated().
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

      log.info('Steam Passport callback: user object received', {
        user,
      });

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

        // Respect the "Allow anyone to register" setting for self‑registration:
        // - When enabled, any Steam login creates a player record.
        // - When disabled (default), we only auto‑create a player for the very
        //   first admin; all other players must be created/imported by admins.
        const existingPlayer = await playerService.getPlayerById(steamId);
        log.info('Steam Passport callback: loaded existing player (if any)', {
          steamId,
          hasExistingPlayer: !!existingPlayer,
          isAdmin: existingPlayer?.isAdmin ?? false,
        });
        const selfRegistrationAllowed = await settingsService.isSelfRegistrationAllowed();
        const hasAnyAdmin = await playerService.hasAnyAdmin();
        const shouldAutoCreate = !existingPlayer && (selfRegistrationAllowed || !hasAnyAdmin);

        if (shouldAutoCreate) {
          log.info('Steam Passport callback: auto-creating player record', {
            steamId,
            displayName,
            avatarUrl,
            selfRegistrationAllowed,
            hasAnyAdmin,
          });
          await playerService.getOrCreatePlayer(steamId, displayName, avatarUrl);
        }

        // If this is the very first admin, promote this Steam user to admin.
        await playerService.ensureFirstAdmin(steamId);
      } catch (playerError) {
        log.warn('Failed to ensure player record during Steam login', playerError as Error);
      }

      // If this Steam login was initiated from a non‑Steam provider (Discord,
      // Keycloak, GitHub), persist that association so future logins via that
      // provider automatically resolve the Steam ID without asking to link
      // again.
      try {
        const anyReq = req as Request & {
          session?: {
            pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
          };
        } & {
          sessionID?: string;
        };
        const sessionId = anyReq.sessionID ?? '(unknown)';
        const cookies = parseCookies(req.headers.cookie);
        const rawCookiePending = cookies.pending_steam_link;

        let cookiePending: { provider: AuthProvider; providerUserId: string } | null = null;
        if (rawCookiePending) {
          try {
            const parsed = JSON.parse(rawCookiePending) as {
              provider?: string;
              providerUserId?: string;
            };
            if (
              parsed &&
              parsed.provider &&
              (parsed.provider === 'discord' ||
                parsed.provider === 'keycloak' ||
                parsed.provider === 'github') &&
              typeof parsed.providerUserId === 'string' &&
              parsed.providerUserId.trim() !== ''
            ) {
              cookiePending = {
                provider: parsed.provider as AuthProvider,
                providerUserId: parsed.providerUserId,
              };
            } else {
              log.info(
                'Steam Passport callback: pending_steam_link cookie present but invalid; ignoring',
                {
                  sessionId,
                  rawCookiePending,
                  parsed,
                }
              );
            }
          } catch (parseErr) {
            log.warn('Steam Passport callback: failed to parse pending_steam_link cookie', {
              sessionId,
              rawCookiePending,
              error:
                parseErr instanceof Error
                  ? { message: parseErr.message, stack: parseErr.stack }
                  : parseErr,
            });
          }
        }

        const sessionPending = anyReq.session?.pendingSteamLink ?? null;
        log.info('Steam Passport callback: checking for pending external identity link', {
          sessionId,
          hasSession: !!anyReq.session,
          sessionPending,
          cookiePending,
        });

        const pending = sessionPending || cookiePending;
        if (pending && pending.provider && pending.providerUserId) {
          await authIdentityService.linkIdentityToSteam(
            pending.provider,
            pending.providerUserId,
            steamId
          );

          if (anyReq.session) {
            delete anyReq.session.pendingSteamLink;
          }

          // Clear the bridging cookie once we've successfully linked.
          res.clearCookie('pending_steam_link', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          });

          log.success('Linked external auth identity to Steam', {
            provider: pending.provider,
            providerUserId: pending.providerUserId,
            steamId,
            sessionId,
            linkSource: cookiePending ? 'cookie' : 'session',
          });
        } else {
          log.info(
            'Steam Passport callback: no pending external identity link found in session or cookie; skipping link',
            {
              sessionId,
            }
          );
        }
      } catch (linkError) {
        log.warn('Failed to persist external auth → Steam link', linkError as Error);
      }

      // Set a signed player_steam_id cookie (verified on read to prevent forgery).
      res.cookie('player_steam_id', signPlayerSteamId(steamId), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      });

      // Redirect based on whether this Steam user is an admin:
      // - Admins go to the main dashboard (/).
      // - Non-admin players go to their public player page.
      // Use 200 + HTML meta-refresh instead of 302 so browsers (Chrome) persist
      // Set-Cookie when arriving from cross-site OAuth redirect (Steam → us).
      const baseUrl = getFrontendBaseUrl(req);
      let redirectTo: string;
      try {
        const player = await playerService.getPlayerById(steamId);
        const hasPlayer = !!player;
        const isAdmin = player?.isAdmin === true;
        if (isAdmin) {
          redirectTo = `${baseUrl}/`;
        } else {
          redirectTo = `${baseUrl}/player/${steamId}`;
        }
        log.info('[Steam callback] Redirect decision', {
          steamId,
          hasPlayer,
          isAdmin,
          redirectTo,
        });
      } catch (redirectError) {
        log.warn(
          '[Steam callback] Failed to load player when deciding redirect, falling back to player profile',
          {
            steamId,
            error: (redirectError as Error).message,
          }
        );
        redirectTo = `${baseUrl}/player/${steamId}`;
      }
      res.status(200).type('text/html').send(htmlRedirectPage(redirectTo));
      return;
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
  // Initial redirect – session will be established on the callback.
  passport.authenticate('keycloak', {
    // Request standard OIDC scopes so that the UserInfo endpoint
    // can return a usable profile.
    scope: ['openid', 'profile', 'email'],
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
    failureRedirect: '/login',
  }),
  async (req: Request, res: Response) => {
    const anyReq = req as Request & {
      user?: {
        provider?: string;
        keycloakId?: string;
        steamId?: string;
      };
      session?: {
        pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
      };
      sessionID?: string;
    };

    const user = anyReq.user;
    const provider = user?.provider as AuthProvider | undefined;
    const providerUserId = user?.keycloakId;
    const sessionId = anyReq.sessionID ?? '(unknown)';

    log.info('Keycloak callback: resolved Passport user', {
      sessionId,
      user,
      provider,
      providerUserId,
    });

    if (!provider || provider !== 'keycloak' || !providerUserId) {
      log.warn('Keycloak callback missing provider or keycloakId on user');
      return sendAdminLoginBridgePage(req, res);
    }

    try {
      const baseUrl = getFrontendBaseUrl(req);

      // Fast-path: if a verified player_steam_id cookie exists (e.g. previous Steam
      // login), persist the mapping so the user doesn't have to go through link again.
      const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);
      log.info('Keycloak callback: checking for existing player_steam_id cookie', {
        sessionId,
        cookieSteamId: cookieSteamId ?? null,
      });
      if (cookieSteamId) {
        await authIdentityService.linkIdentityToSteam(provider, providerUserId, cookieSteamId);
        (anyReq.user as { steamId?: string }).steamId = cookieSteamId;
        res.cookie('player_steam_id', signPlayerSteamId(cookieSteamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('Keycloak login auto-linked via existing Steam cookie', {
          steamId: cookieSteamId,
          sessionId,
        });
        return res.redirect(302, `${baseUrl}/`);
      }

      const steamId = await authIdentityService.findSteamIdForIdentity(provider, providerUserId);
      log.info('Keycloak callback: result of auth identity lookup', {
        sessionId,
        provider,
        providerUserId,
        steamId: steamId ?? null,
      });
      const baseUrlResolved = baseUrl;

      if (steamId) {
        (anyReq.user as { steamId?: string }).steamId = steamId;
        res.cookie('player_steam_id', signPlayerSteamId(steamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('Keycloak login resolved via existing Steam link', { steamId, sessionId });
        return res.redirect(302, `${baseUrlResolved}/`);
      }

      // No existing link – remember this identity so the Steam callback can persist it.
      if (anyReq.session) {
        anyReq.session.pendingSteamLink = {
          provider,
          providerUserId,
        };
        log.info('Keycloak callback: stored pendingSteamLink on session', {
          sessionId,
          pendingSteamLink: anyReq.session.pendingSteamLink,
        });
      }

      // Also set a short-lived cookie so that even if the Express session ID
      // changes between the SSO callback and the Steam callback, we can still
      // recover the pending identity and persist the link.
      res.cookie(
        'pending_steam_link',
        JSON.stringify({
          provider,
          providerUserId,
        }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 10, // 10 minutes
        }
      );

      log.success('Keycloak Passport login completed; Steam link required');
      return sendAdminLoginBridgePage(req, res);
    } catch (err) {
      log.error('Keycloak callback failed while resolving Steam link', err as Error);
      return sendAdminLoginBridgePage(req, res);
    }
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
  // Initial redirect – session will be established on the callback.
  passport.authenticate('discord')
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
    failureRedirect: '/login',
  }),
  async (req: Request, res: Response) => {
    const anyReq = req as Request & {
      user?: {
        provider?: string;
        discordId?: string;
        steamId?: string;
      };
      session?: {
        pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
      };
      sessionID?: string;
    };

    const user = anyReq.user;
    const provider = user?.provider as AuthProvider | undefined;
    const providerUserId = user?.discordId;
    const sessionId = anyReq.sessionID ?? '(unknown)';

    log.info('Discord callback: resolved Passport user', {
      sessionId,
      user,
      provider,
      providerUserId,
    });

    if (!provider || provider !== 'discord' || !providerUserId) {
      log.warn('Discord callback missing provider or discordId on user');
      return sendAdminLoginBridgePage(req, res);
    }

    try {
      const baseUrl = getFrontendBaseUrl(req);

      const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);
      log.info('Discord callback: checking for existing player_steam_id cookie', {
        sessionId,
        cookieSteamId: cookieSteamId ?? null,
      });
      if (cookieSteamId) {
        await authIdentityService.linkIdentityToSteam(provider, providerUserId, cookieSteamId);
        (anyReq.user as { steamId?: string }).steamId = cookieSteamId;
        res.cookie('player_steam_id', signPlayerSteamId(cookieSteamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('Discord login auto-linked via existing Steam cookie', {
          steamId: cookieSteamId,
          sessionId,
        });
        return res.redirect(302, `${baseUrl}/`);
      }

      const steamId = await authIdentityService.findSteamIdForIdentity(provider, providerUserId);

      log.info('Discord callback: result of auth identity lookup', {
        sessionId,
        provider,
        providerUserId,
        steamId: steamId ?? null,
      });

      if (steamId) {
        (anyReq.user as { steamId?: string }).steamId = steamId;
        res.cookie('player_steam_id', signPlayerSteamId(steamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('Discord login resolved via existing Steam link', { steamId, sessionId });
        return res.redirect(302, `${baseUrl}/`);
      }

      if (anyReq.session) {
        anyReq.session.pendingSteamLink = {
          provider,
          providerUserId,
        };
        log.info('Discord callback: stored pendingSteamLink on session', {
          sessionId,
          pendingSteamLink: anyReq.session.pendingSteamLink,
        });
      }

      // Also set a short-lived cookie so that even if the Express session ID
      // changes between the Discord callback and the Steam callback, we can still
      // recover the pending identity and persist the link.
      res.cookie(
        'pending_steam_link',
        JSON.stringify({
          provider,
          providerUserId,
        }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 10, // 10 minutes
        }
      );

      log.success('Discord Passport login completed; Steam link required');
      return sendAdminLoginBridgePage(req, res);
    } catch (err) {
      log.error('Discord callback failed while resolving Steam link', err as Error);
      return sendAdminLoginBridgePage(req, res);
    }
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
  // Initial redirect – session will be established on the callback.
  passport.authenticate('github')
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
    failureRedirect: '/login',
  }),
  async (req: Request, res: Response) => {
    const anyReq = req as Request & {
      user?: {
        provider?: string;
        githubId?: string;
        steamId?: string;
      };
      session?: {
        pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
      };
      sessionID?: string;
    };

    const user = anyReq.user;
    const provider = user?.provider as AuthProvider | undefined;
    const providerUserId = user?.githubId;
    const sessionId = anyReq.sessionID ?? '(unknown)';

    log.info('GitHub callback: resolved Passport user', {
      sessionId,
      user,
      provider,
      providerUserId,
    });

    if (!provider || provider !== 'github' || !providerUserId) {
      log.warn('GitHub callback missing provider or githubId on user');
      return sendAdminLoginBridgePage(req, res);
    }

    try {
      const baseUrl = getFrontendBaseUrl(req);

      const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);
      log.info('GitHub callback: checking for existing player_steam_id cookie', {
        sessionId,
        cookieSteamId: cookieSteamId ?? null,
      });
      if (cookieSteamId) {
        await authIdentityService.linkIdentityToSteam(provider, providerUserId, cookieSteamId);
        (anyReq.user as { steamId?: string }).steamId = cookieSteamId;
        res.cookie('player_steam_id', signPlayerSteamId(cookieSteamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('GitHub login auto-linked via existing Steam cookie', {
          steamId: cookieSteamId,
          sessionId,
        });
        return res.redirect(302, `${baseUrl}/`);
      }

      const steamId = await authIdentityService.findSteamIdForIdentity(provider, providerUserId);

      log.info('GitHub callback: result of auth identity lookup', {
        sessionId,
        provider,
        providerUserId,
        steamId: steamId ?? null,
      });

      if (steamId) {
        (anyReq.user as { steamId?: string }).steamId = steamId;
        res.cookie('player_steam_id', signPlayerSteamId(steamId), {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        log.success('GitHub login resolved via existing Steam link', { steamId, sessionId });
        return res.redirect(302, `${baseUrl}/`);
      }

      if (anyReq.session) {
        anyReq.session.pendingSteamLink = {
          provider,
          providerUserId,
        };
        log.info('GitHub callback: stored pendingSteamLink on session', {
          sessionId,
          pendingSteamLink: anyReq.session.pendingSteamLink,
        });
      }

      // Also set a short-lived cookie so that even if the Express session ID
      // changes between the GitHub callback and the Steam callback, we can still
      // recover the pending identity and persist the link.
      res.cookie(
        'pending_steam_link',
        JSON.stringify({
          provider,
          providerUserId,
        }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 1000 * 60 * 10, // 10 minutes
        }
      );

      log.success('GitHub Passport login completed; Steam link required');
      return sendAdminLoginBridgePage(req, res);
    } catch (err) {
      log.error('GitHub callback failed while resolving Steam link', err as Error);
      return sendAdminLoginBridgePage(req, res);
    }
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
 * Includes hasPlayerRecord so the frontend can show "not registered" for users
 * who have signed in with Steam but are not in the players table.
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const steamId = getVerifiedPlayerSteamId(req.headers.cookie);

    log.info('/api/auth/me: evaluated cookie state', {
      rawCookieHeader: req.headers.cookie ?? null,
      steamId: steamId ?? null,
    });

    if (!steamId) {
      log.info('/api/auth/me: no Steam ID cookie present; returning unauthenticated');
      return res.json({
        authenticated: false,
      });
    }

    let hasPlayerRecord = false;
    try {
      const player = await playerService.getPlayerById(steamId);
      hasPlayerRecord = !!player;
    } catch {
      // treat lookup failure as no record
    }

    log.info('/api/auth/me: returning authenticated Steam identity', { steamId, hasPlayerRecord });

    return res.json({
      authenticated: true,
      steamId,
      hasPlayerRecord,
    });
  } catch (error) {
    log.warn('Failed to read player_steam_id cookie', error as Error);
    return res.json({
      authenticated: false,
    });
  }
});

/**
 * Debug endpoint: admin status for the current user (player_steam_id cookie).
 * Use this to troubleshoot "can't access admin" issues.
 * Returns isAdmin, hasPlayerRecord, and a short reason.
 */
router.get('/admin-status', async (req: Request, res: Response) => {
  try {
    if (shouldBlockAdminAsDirectAccess(req)) {
      return res.json({
        success: true,
        steamId: null,
        isAdmin: false,
        hasPlayerRecord: false,
        reason: 'direct_access_blocked',
        hint: 'Admin access is only allowed via the configured frontend URL (reverse proxy). You are connecting directly to the container.',
      });
    }

    const steamId = getVerifiedPlayerSteamId(req.headers.cookie);

    if (!steamId) {
      return res.json({
        success: true,
        steamId: null,
        isAdmin: false,
        hasPlayerRecord: false,
        reason: 'no_steam_cookie',
        hint: 'Sign in with Steam first. The player_steam_id cookie is set after Steam login.',
      });
    }

    const player = await playerService.getPlayerById(steamId);
    const hasPlayerRecord = !!player;
    const isAdmin = player?.isAdmin === true;

    let reason: string;
    if (!hasPlayerRecord) {
      reason = 'no_player_record';
    } else if (isAdmin) {
      reason = 'admin';
    } else {
      reason = 'not_admin';
    }

    const hasAnyAdmin = await playerService.hasAnyAdmin();
    const hint =
      !hasPlayerRecord
        ? 'You are not in the players table. Ask an admin to add you, or enable self-registration.'
        : !isAdmin && hasAnyAdmin
          ? 'An admin already exists. Only the first user to sign in (after DB reset) is auto-promoted. Ask an existing admin to grant you access.'
          : !isAdmin
            ? 'No admins exist yet. The first user to sign in with Steam is auto-promoted. Ensure you are the only player, then sign in again.'
            : undefined;

    log.debug('[auth/admin-status]', { steamId, isAdmin, hasPlayerRecord, reason });

    return res.json({
      success: true,
      steamId,
      isAdmin,
      hasPlayerRecord,
      reason,
      hint,
    });
  } catch (error) {
    log.warn('Failed to compute admin status', { error: (error as Error).message });
    return res.status(500).json({
      success: false,
      error: 'Failed to compute admin status',
    });
  }
});

/**
 * Admin "who am I" endpoint.
 * Returns basic info about the authenticated admin session (if any).
 *
 * We accept two ways to be "admin" (same as requireAuth):
 *  1. Passport session (connect.sid) — Steam/SSO login with session.
 *  2. player_steam_id cookie + DB is_admin — used when session cookie is dropped
 *     (e.g. Cloudflare Tunnel, Chrome + OAuth redirect). Same as /admin-status.
 *
 * Steam ID resolution (when session exists):
 * - Prefer steamId from the Passport user object.
 * - Fallback to the player_steam_id cookie for SSO logins that linked Steam.
 */
router.get('/admin/me', async (req: Request, res: Response) => {
  if (shouldBlockAdminAsDirectAccess(req)) {
    return res.json({ authenticated: false });
  }

  const anyReq = req as Request & {
    user?: {
      provider?: string;
      steamId?: string;
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };
    isAuthenticated?: () => boolean;
  };

  const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);

  let steamId: string | null = null;
  let provider: string = 'steam';
  let profileName: string | null = null;
  let profileAvatarUrl: string | null = null;

  if (anyReq.isAuthenticated && anyReq.isAuthenticated() && anyReq.user) {
    const user = anyReq.user;
    const userSteamId = (user as { steamId?: string }).steamId;
    steamId = userSteamId || cookieSteamId || null;
    provider = (user as { provider?: string }).provider ?? 'steam';

    if (provider === 'steam') {
      profileName = (user as { displayName?: string }).displayName ?? null;
      profileAvatarUrl = (user as { avatarUrl?: string }).avatarUrl ?? null;
    } else if (provider === 'discord') {
      profileName = (user as { username?: string }).username ?? null;
      profileAvatarUrl = (user as { avatarUrl?: string }).avatarUrl ?? null;
    } else if (provider === 'github') {
      profileName =
        (user as { displayName?: string }).displayName ||
        (user as { username?: string }).username ||
        null;
      profileAvatarUrl = (user as { avatarUrl?: string }).avatarUrl ?? null;
    } else if (provider === 'keycloak') {
      profileName =
        (user as { displayName?: string }).displayName ||
        (user as { username?: string }).username ||
        null;
      profileAvatarUrl = null;
    }

    if (steamId) {
      try {
        const player = await playerService.getPlayerById(steamId);
        if (player?.isAdmin) {
          log.info('/api/auth/admin/me: returning authenticated admin identity (session)', {
            provider,
            steamId,
          });
          return res.json({
            authenticated: true,
            provider,
            steamId,
            providerProfile: { name: profileName, avatarUrl: profileAvatarUrl },
          });
        }
      } catch (err) {
        log.warn('Failed to verify admin from session in /admin/me', err as Error);
      }
    }
  }

  if (cookieSteamId) {
    try {
      const player = await playerService.getPlayerById(cookieSteamId);
      if (player?.isAdmin) {
        steamId = cookieSteamId;
        profileName = player.name ?? null;
        profileAvatarUrl =
          typeof player.avatar === 'string' && player.avatar.startsWith('http')
            ? player.avatar
            : null;
        log.info('/api/auth/admin/me: returning authenticated admin identity (cookie)', {
          steamId,
        });
        return res.json({
          authenticated: true,
          provider: 'steam',
          steamId,
          providerProfile: { name: profileName, avatarUrl: profileAvatarUrl },
        });
      }
    } catch (err) {
      log.warn('Failed to resolve admin/me from player_steam_id cookie', err as Error);
    }
  }

  log.info('/api/auth/admin/me: unauthenticated admin session', {
    hasIsAuthenticated: !!anyReq.isAuthenticated,
    isAuthenticated: anyReq.isAuthenticated ? anyReq.isAuthenticated() : null,
    hasUser: !!anyReq.user,
    hasCookieSteamId: !!cookieSteamId,
  });
  return res.json({ authenticated: false });
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


