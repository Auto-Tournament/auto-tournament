import { Router, Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';
import { getAuthProvidersConfig } from '../config/authProviders';
import { steamService } from '../services/steamService';
import { playerService } from '../services/playerService';
import { passport, isStrategyConfigured } from '../config/passport';
import { settingsService } from '../services/settingsService';
import { authIdentityService, AuthProvider } from '../services/authIdentityService';
import {
  signPlayerSteamId,
  getVerifiedPlayerSteamId,
} from '../utils/signedPlayerCookie';
import {
  PENDING_STEAM_LINK_COOKIE_NAME,
  PENDING_STEAM_LINK_TTL_MS,
  signPendingSteamLink,
  verifyPendingSteamLink,
  type PendingSteamLinkRejection,
} from '../utils/signedPendingSteamLink';
import { shouldBlockAdminAsDirectAccess } from '../utils/canonicalOrigin';
import {
  signImpersonatedSteamId,
  IMPERSONATION_COOKIE_NAME,
} from '../utils/impersonationCookie';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { authenticateServiceToken, requireAuth } from '../middleware/auth';

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

function shouldUseSecureCookie(req: Request): boolean {
  // Prefer forwarded proto when behind proxies; fall back to Express detection.
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined) || '';
  if (forwardedProto.toLowerCase().includes('https')) return true;
  if (req.secure) return true;
  // As a final fallback, respect explicit FRONTEND_BASE_URL scheme.
  return getFrontendBaseUrl(req).startsWith('https://');
}

function setImpersonationCookie(req: Request, res: Response, steamId: string): void {
  res.cookie(IMPERSONATION_COOKIE_NAME, signImpersonatedSteamId(steamId), {
    // Read server-side only; the client learns about impersonation via
    // /api/auth/me and /api/auth/impersonate.
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
    // Deliberately short-lived: impersonation is a debugging tool, not a login.
    maxAge: 1000 * 60 * 60 * 2, // 2 hours
  });
}

function clearImpersonationCookie(req: Request, res: Response): void {
  res.clearCookie(IMPERSONATION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
  });
}

function setPlayerSteamCookie(req: Request, res: Response, steamId: string): void {
  res.cookie('player_steam_id', signPlayerSteamId(steamId), {
    // Frontend never needs to read this cookie directly; it calls /api/auth/me.
    // Keeping it httpOnly reduces XSS impact.
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  });
}

/**
 * Clear every cookie that identifies the person at this browser: the signed
 * player_steam_id, the pending SSO→Steam link, and admin impersonation.
 *
 * The attributes must match the setters (path, sameSite, secure) or the
 * browser keeps the original cookie. This matters on shared PCs: a leftover
 * player_steam_id would make the next person's SSO login auto-link to the
 * previous user's Steam account.
 */
function clearIdentityCookies(req: Request, res: Response): void {
  res.clearCookie('player_steam_id', {
    path: '/',
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
  });
  res.clearCookie('pending_steam_link', {
    path: '/',
    httpOnly: true,
    // Matches setPendingSteamLinkCookie (PENDING_STEAM_LINK_COOKIE_OPTIONS).
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  clearImpersonationCookie(req, res);
}

/** Truncate a provider user id for logs; enough to correlate, not to identify. */
function redactProviderUserId(id: string | undefined | null): string | null {
  if (!id) return null;
  return id.length <= 4 ? '****' : `${id.slice(0, 4)}…`;
}

type PendingSteamLinkSessionRequest = Request & {
  session?: {
    pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
  };
};

/** Cookie attributes for pending_steam_link. `clearIdentityCookies` and
 * `completePendingSteamLink` clear it with the same path/sameSite/secure. */
const PENDING_STEAM_LINK_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Set the short-lived `pending_steam_link` cookie that carries "link this SSO
 * identity once Steam proves an account" into `/steam/callback`. Passport
 * regenerates the session on the Steam login, so this cookie, not the session
 * copy, is what normally survives.
 *
 * The callback re-points a login based on it, so the value is signed with
 * SESSION_SECRET and carries its own expiry (see `utils/signedPendingSteamLink`).
 * This is the only writer; `readPendingSteamLink` is the only reader.
 */
export function setPendingSteamLinkCookie(
  res: Response,
  provider: AuthProvider,
  providerUserId: string
): void {
  res.cookie(PENDING_STEAM_LINK_COOKIE_NAME, signPendingSteamLink({ provider, providerUserId }), {
    ...PENDING_STEAM_LINK_COOKIE_OPTIONS,
    maxAge: PENDING_STEAM_LINK_TTL_MS,
  });
}

export type PendingSteamLinkRead = {
  /** What the Steam callback would link, or null for a plain Steam login. */
  link: { provider: AuthProvider; providerUserId: string } | null;
  source: 'session' | 'cookie' | null;
  /**
   * Why a cookie that WAS present was not trusted, or null when there was no
   * cookie or it verified. Reported even when the session copy wins.
   */
  cookieRejected: Exclude<PendingSteamLinkRejection, 'missing'> | null;
};

/**
 * Work out which SSO identity, if any, the Steam callback should link.
 *
 * The session copy wins when it exists, as before: the server wrote it and the
 * client cannot touch it. Usually it is gone by now, so the cookie is the normal
 * source, and it is only believed if its signature and expiry check out. A
 * cookie that is present but fails is logged with a reason code and ignored;
 * the login then carries on as a plain Steam login. Neither the cookie value
 * nor the provider user id it names is logged.
 *
 * `now` exists for the test helper only, so expiry can be checked without
 * waiting ten minutes.
 */
export function readPendingSteamLink(
  req: Request,
  options: { now?: number } = {}
): PendingSteamLinkRead {
  const anyReq = req as PendingSteamLinkSessionRequest;

  let rawCookie: string | undefined;
  try {
    rawCookie = parseCookies(req.headers.cookie)[PENDING_STEAM_LINK_COOKIE_NAME];
  } catch {
    // decodeURIComponent throws on a malformed %-escape anywhere in the header.
    // If a pending cookie might be in there, treat it as malformed, never as absent-but-fine.
    rawCookie = (req.headers.cookie ?? '').includes(`${PENDING_STEAM_LINK_COOKIE_NAME}=`)
      ? '\u0000unparseable'
      : undefined;
  }

  let cookieLink: PendingSteamLinkRead['link'] = null;
  let cookieRejected: PendingSteamLinkRead['cookieRejected'] = null;
  const verification = verifyPendingSteamLink(rawCookie, { now: options.now });
  if (verification.ok) {
    cookieLink = verification.link;
  } else if (verification.reason !== 'missing') {
    cookieRejected = verification.reason;
    // Reason code only. The provider inside a rejected cookie is unverified, so
    // it is not logged, and neither is the value.
    log.warn('Steam callback: rejected pending_steam_link cookie; nothing will be linked from it', {
      reason: verification.reason,
    });
  }

  const sessionPending = anyReq.session?.pendingSteamLink ?? null;
  if (sessionPending) {
    // Same precedence as before signing: any session value shadows the cookie.
    return sessionPending.provider && sessionPending.providerUserId
      ? { link: sessionPending, source: 'session', cookieRejected }
      : { link: null, source: null, cookieRejected };
  }
  if (cookieLink) {
    return { link: cookieLink, source: 'cookie', cookieRejected };
  }
  return { link: null, source: null, cookieRejected };
}

/**
 * The linking step of `/steam/callback`, once Steam has proven `steamId`: link
 * the pending SSO identity (per `readPendingSteamLink`) to it and clear the
 * pending state. Errors are logged and swallowed; a failed link must not fail
 * the Steam login itself.
 *
 * Exported so the test helper runs exactly this code, since a test cannot
 * complete a real Steam OpenID login.
 */
export async function completePendingSteamLink(
  req: Request,
  res: Response,
  steamId: string,
  options: { now?: number } = {}
): Promise<PendingSteamLinkRead & { linked: boolean }> {
  const anyReq = req as PendingSteamLinkSessionRequest;

  let read: PendingSteamLinkRead = { link: null, source: null, cookieRejected: null };
  try {
    read = readPendingSteamLink(req, options);
    log.info('Steam Passport callback: checking for pending external identity link', {
      hasSession: !!anyReq.session,
      source: read.source,
      pendingProvider: read.link?.provider ?? null,
      cookieRejected: read.cookieRejected,
    });

    if (!read.link) {
      log.info('Steam Passport callback: no trusted pending external identity link; skipping link');
      return { ...read, linked: false };
    }

    await authIdentityService.linkIdentityToSteam(
      read.link.provider,
      read.link.providerUserId,
      steamId
    );

    if (anyReq.session) {
      delete anyReq.session.pendingSteamLink;
    }

    // Clear the bridging cookie once we've successfully linked.
    res.clearCookie(PENDING_STEAM_LINK_COOKIE_NAME, PENDING_STEAM_LINK_COOKIE_OPTIONS);

    log.success('Linked external auth identity to Steam', {
      provider: read.link.provider,
      providerUserId: redactProviderUserId(read.link.providerUserId),
      steamId,
      linkSource: read.source,
    });
    return { ...read, linked: true };
  } catch (linkError) {
    log.warn('Failed to persist external auth → Steam link', linkError as Error);
    return { ...read, linked: false };
  }
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
        steamId: user?.steamId ?? null,
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
        } else if (existingPlayer) {
          // Players created without Steam data (ADMIN_STEAM_IDS seeding, admin
          // imports) carry the Steam ID as a placeholder name and no avatar.
          // Fill those in from Steam, and keep Steam avatars current, but never
          // overwrite a name or avatar someone set by hand.
          const updates: { name?: string; avatar?: string } = {};
          if (existingPlayer.name === steamId && displayName !== steamId) {
            updates.name = displayName;
          }
          const currentAvatar = existingPlayer.avatar ?? '';
          const avatarFromSteam =
            currentAvatar.startsWith('/api/players/') || /steamstatic|steamcdn|akamaihd/.test(currentAvatar);
          if (avatarUrl && avatarFromSteam && currentAvatar !== avatarUrl) {
            updates.avatar = avatarUrl;
          }
          if (updates.name || updates.avatar) {
            log.info('Steam Passport callback: refreshing player profile from Steam', {
              steamId,
              name: Boolean(updates.name),
              avatar: Boolean(updates.avatar),
            });
            await playerService.updatePlayer(steamId, updates);
          }
        }

        // If this is the very first admin, promote this Steam user to admin.
        await playerService.ensureFirstAdmin(steamId);
      } catch (playerError) {
        log.warn('Failed to ensure player record during Steam login', playerError as Error);
      }

      // If this Steam login was initiated from a non‑Steam provider (Discord,
      // Keycloak, GitHub, Google), persist that association so future logins via that
      // provider automatically resolve the Steam ID without asking to link
      // again.
      // Only the session copy or a correctly signed, unexpired cookie is acted on.
      await completePendingSteamLink(req, res, steamId);

      // Set a signed player_steam_id cookie (verified on read to prevent forgery).
      setPlayerSteamCookie(req, res, steamId);

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
 * Clears the player_steam_id, pending_steam_link and impersonation cookies. It does NOT
 * affect admin API token authentication (which is handled purely on the
 * frontend via localStorage today).
 */
router.post('/logout', (req: Request, res: Response) => {
  try {
    clearIdentityCookies(req, res);

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
 * The field on the Passport user that holds each SSO provider's user id.
 * The strategies in config/passport.ts set it.
 */
const SSO_USER_ID_FIELD: Record<AuthProvider, string> = {
  discord: 'discordId',
  keycloak: 'keycloakId',
  github: 'githubId',
  google: 'googleId',
};

const SSO_PROVIDER_LABEL: Record<AuthProvider, string> = {
  discord: 'Discord',
  keycloak: 'Keycloak',
  github: 'GitHub',
  google: 'Google',
};

/**
 * Answer 503 instead of letting Passport throw "Unknown authentication
 * strategy" when a provider's client credentials are not configured.
 */
export function requireStrategy(strategyName: string, provider: AuthProvider) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!isStrategyConfigured(strategyName)) {
      log.warn(`${SSO_PROVIDER_LABEL[provider]} auth requested but it is not configured`);
      return res.status(503).json({
        success: false,
        error: `${SSO_PROVIDER_LABEL[provider]} authentication is not configured on the server.`,
      });
    }
    return next();
  };
}

/**
 * What every SSO callback does once Passport has verified the login (state
 * checked, code exchanged, profile fetched). The same for all providers:
 *
 *  1. A verified player_steam_id cookie is already present (the user signed in
 *     with Steam earlier in this browser): link this identity to that Steam ID.
 *  2. The identity is already linked: sign in as the linked Steam ID.
 *  3. Otherwise: remember the identity in a signed pending_steam_link cookie
 *     (and the session) and send the user to /connect-steam. The Steam
 *     callback links it once Steam proves an account.
 *
 * Admin rights are never decided here. They come from players.is_admin for
 * the resolved Steam ID, as for a Steam login.
 *
 * Exported so the test-only fake provider routes run exactly this code.
 */
export function ssoCallbackHandler(expectedProvider: AuthProvider) {
  const label = SSO_PROVIDER_LABEL[expectedProvider];

  return async (req: Request, res: Response) => {
    const anyReq = req as Request & {
      user?: Record<string, unknown> & { provider?: string; steamId?: string };
      session?: {
        pendingSteamLink?: { provider: AuthProvider; providerUserId: string };
      };
    };

    const user = anyReq.user;
    const provider = user?.provider as AuthProvider | undefined;
    const rawId = user?.[SSO_USER_ID_FIELD[expectedProvider]];
    const providerUserId = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined;
    // Never log the Passport user object. Provider plus a truncated provider
    // user id is enough to correlate.
    log.info(`${label} callback: resolved Passport user`, {
      provider,
      providerUserId: redactProviderUserId(providerUserId),
    });

    if (!user || provider !== expectedProvider || !providerUserId) {
      log.warn(`${label} callback missing provider or user id on user`);
      return sendAdminLoginBridgePage(req, res);
    }

    try {
      const baseUrl = getFrontendBaseUrl(req);

      // Fast path: a verified player_steam_id cookie (e.g. an earlier Steam
      // login) means we already know who this is, so persist the mapping.
      const cookieSteamId = getVerifiedPlayerSteamId(req.headers.cookie);
      log.info(`${label} callback: checking for existing player_steam_id cookie`, {
        cookieSteamId: cookieSteamId ?? null,
      });
      if (cookieSteamId) {
        await authIdentityService.linkIdentityToSteam(provider, providerUserId, cookieSteamId);
        user.steamId = cookieSteamId;
        setPlayerSteamCookie(req, res, cookieSteamId);

        log.success(`${label} login auto-linked via existing Steam cookie`, {
          provider,
          providerUserId: redactProviderUserId(providerUserId),
          steamId: cookieSteamId,
        });
        return res.redirect(302, `${baseUrl}/`);
      }

      const steamId = await authIdentityService.findSteamIdForIdentity(provider, providerUserId);
      log.info(`${label} callback: result of auth identity lookup`, {
        provider,
        providerUserId: redactProviderUserId(providerUserId),
        steamId: steamId ?? null,
      });

      if (steamId) {
        user.steamId = steamId;
        setPlayerSteamCookie(req, res, steamId);

        log.success(`${label} login resolved via existing Steam link`, { provider, steamId });
        return res.redirect(302, `${baseUrl}/`);
      }

      // No existing link: remember this identity so the Steam callback can persist it.
      if (anyReq.session) {
        anyReq.session.pendingSteamLink = { provider, providerUserId };
        log.info(`${label} callback: stored pendingSteamLink on session`, {
          provider,
          providerUserId: redactProviderUserId(providerUserId),
        });
      }

      // Also set a short-lived cookie so that even if the Express session ID
      // changes between this callback and the Steam callback, we can still
      // recover the pending identity and persist the link. The cookie is signed
      // and expires, so the Steam callback only acts on one we wrote.
      setPendingSteamLinkCookie(res, provider, providerUserId);

      log.success(`${label} Passport login completed; Steam link required`);
      return sendAdminLoginBridgePage(req, res);
    } catch (err) {
      log.error(`${label} callback failed while resolving Steam link`, err as Error);
      return sendAdminLoginBridgePage(req, res);
    }
  };
}

/**
 * The start and callback routes for one SSO provider:
 *
 *   GET /api/auth/<provider>           redirects to the provider
 *   GET /api/auth/<provider>/callback  verifies the login, see ssoCallbackHandler
 *
 * The OAuth state cookie is set and checked by the strategy's
 * SignedCookieStateStore (utils/oauthStateCookie). A failed state check or a
 * refused consent is a Passport failure and redirects to /login.
 */
function registerSsoRoutes(provider: AuthProvider, startOptions: Record<string, unknown> = {}) {
  router.get(
    `/${provider}`,
    requireStrategy(provider, provider),
    passport.authenticate(provider, startOptions)
  );
  router.get(
    `/${provider}/callback`,
    requireStrategy(provider, provider),
    passport.authenticate(provider, { failureRedirect: '/login' }),
    ssoCallbackHandler(provider)
  );
}

// Keycloak (OIDC): request the standard scopes so the UserInfo endpoint
// returns a usable profile. Discord, GitHub and Google set their scopes on the
// strategy.
registerSsoRoutes('keycloak', { scope: ['openid', 'profile', 'email'] });
registerSsoRoutes('discord');
registerSsoRoutes('github');
registerSsoRoutes('google');

/**
 * Public discovery endpoint: returns the list of configured auth providers.
 *
 * This is safe to expose to the frontend and is intended to drive dynamic
 * "Sign in with X" buttons (Steam, Keycloak, Discord, etc.).
 */
router.get('/providers', async (_req: Request, res: Response) => {
  const genericUnavailable = 'Sign-in is temporarily unavailable. Please contact an administrator.';

  try {
    let providers = getAuthProvidersConfig();

    // If Steam appears enabled from env, verify that the key is actually usable.
    // This is cached (short TTL) inside the service so it won't hit Steam every request.
    const steamProvider = providers.find((p) => p.id === 'steam');
    if (steamProvider && steamProvider.enabled) {
      const health = await steamService.checkSteamWebApiHealth();
      if (!health.ok) {
        providers = providers.map((p) => (p.id === 'steam' ? { ...p, enabled: false } : p));
      }
    }

    const enabledProviders = providers.filter((p) => p.enabled);
    const hasProviders = enabledProviders.length > 0;

    return res.json({
      success: hasProviders,
      // Always return the full provider list so the UI can render (or hide) buttons.
      providers,
      error: hasProviders ? undefined : genericUnavailable,
    });
  } catch (err) {
    log.warn('Failed to compute auth providers config', err as Error);
    return res.json({
      success: false,
      providers: [],
      error: genericUnavailable,
    });
  }
});

/**
 * Lightweight "who am I" endpoint for players.
 * This is not a security boundary; it only reflects the player_steam_id cookie.
 * Includes hasPlayerRecord so the frontend can show "not registered" for users
 * who have signed in with Steam but are not in the players table.
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    // The *effective* identity: normally the signed-in user, but an admin who
    // started an impersonation session is reported as the impersonated player
    // so all player-facing UI (veto, team pages, CTAs) matches what the API
    // will actually authorize.
    const identity = await resolveViewerIdentity(req);
    const steamId = identity.effectiveSteamId;

    log.debug('/api/auth/me: evaluated cookie state', {
      steamId: steamId ?? null,
      isImpersonating: identity.isImpersonating,
    });

    if (!steamId) {
      log.debug('/api/auth/me: no Steam ID cookie present; returning unauthenticated');
      return res.json({
        authenticated: false,
      });
    }

    let hasPlayerRecord = false;
    let playerName: string | null = null;
    try {
      const player = await playerService.getPlayerById(steamId);
      hasPlayerRecord = !!player;
      playerName = player?.name ?? null;
    } catch {
      // treat lookup failure as no record
    }

    log.debug('/api/auth/me: returning authenticated Steam identity', { steamId, hasPlayerRecord });

    return res.json({
      authenticated: true,
      steamId,
      hasPlayerRecord,
      impersonation: identity.isImpersonating
        ? {
            active: true,
            steamId,
            name: playerName,
            realSteamId: identity.realSteamId,
          }
        : { active: false },
    });
  } catch (error) {
    log.warn('Failed to read player_steam_id cookie', error as Error);
    return res.json({
      authenticated: false,
    });
  }
});

/**
 * Self-registration endpoint for players who already have a valid Steam cookie.
 *
 * This is intended to cover the case where:
 * - a user signed in with Steam while self-registration was disabled (so no player row was created)
 * - an admin later enables self-registration
 * - the user refreshes and should be able to "sign up" without re-authenticating
 *
 * POST /api/auth/self-register
 */
router.post('/self-register', async (req: Request, res: Response) => {
  try {
    const steamId = getVerifiedPlayerSteamId(req.headers.cookie);
    if (!steamId) {
      return res.status(401).json({
        success: false,
        error: 'Not signed in with Steam',
      });
    }

    const selfRegistrationAllowed = await settingsService.isSelfRegistrationAllowed();
    if (!selfRegistrationAllowed) {
      return res.status(403).json({
        success: false,
        error: 'Self-registration is disabled',
      });
    }

    const existing = await playerService.getPlayerById(steamId);
    if (existing) {
      return res.json({
        success: true,
        created: false,
        player: existing,
      });
    }

    let displayName = steamId;
    let avatarUrl: string | undefined;
    if (await steamService.isAvailable()) {
      const info = await steamService.getPlayerInfo(steamId);
      if (info) {
        displayName = info.name;
        avatarUrl = info.avatarUrl;
      }
    }

    await playerService.getOrCreatePlayer(steamId, displayName, avatarUrl);
    // Maintain the "first admin bootstrap" behaviour when safe.
    await playerService.ensureFirstAdmin(steamId);

    const createdPlayer = await playerService.getPlayerById(steamId);
    return res.json({
      success: true,
      created: true,
      player: createdPlayer,
    });
  } catch (error) {
    log.warn('Self-registration failed', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to self-register',
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
    const hint = !hasPlayerRecord
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
  // A service token identifies an integration, not a person, so there is no
  // Steam ID or profile to return. Answering here anyway gives bots a single
  // endpoint to check "is my token accepted, and what may it do" against.
  const tokenAuth = authenticateServiceToken(req);
  if (tokenAuth) {
    if (tokenAuth.ok) {
      return res.json({
        authenticated: true,
        provider: 'service-token',
        steamId: null,
        serviceToken: {
          label: tokenAuth.identity.label,
          scope: tokenAuth.identity.scope,
          fingerprint: tokenAuth.identity.fingerprint,
        },
      });
    }
    return res.json({
      authenticated: false,
      reason: 'invalid_service_token',
      message: tokenAuth.reason,
    });
  }

  if (shouldBlockAdminAsDirectAccess(req)) {
    return res.json({
      authenticated: false,
      reason: 'direct_access_blocked',
      message:
        'Admin access is only allowed through the configured frontend URL. This request did not come through your reverse proxy.',
    });
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
    } else if (provider === 'github' || provider === 'google') {
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

  // Say *why* admin was refused.
  //
  // This used to return a bare `authenticated: false`, and the client silently
  // redirected to the player profile. Three quite different situations —
  // nobody is signed in, the Steam ID has no player row, and the player exists
  // but is not an admin — were indistinguishable from the outside, which is
  // exactly why the reports of "redirected to my player page even though
  // is_admin = 1" could never be diagnosed: there was nothing to collect.
  const resolvedSteamId = steamId ?? cookieSteamId ?? null;
  let reason: 'not_signed_in' | 'no_player_record' | 'not_admin' = 'not_signed_in';
  let message = 'You are not signed in.';

  if (resolvedSteamId) {
    let player = null;
    try {
      player = await playerService.getPlayerById(resolvedSteamId);
    } catch (err) {
      log.warn('Failed to load player while explaining admin denial', err as Error);
    }

    if (!player) {
      reason = 'no_player_record';
      message = `Signed in as ${resolvedSteamId}, but there is no player with that Steam ID.`;
    } else {
      reason = 'not_admin';
      message = `Signed in as ${player.name || resolvedSteamId} (${resolvedSteamId}), but this account is not an admin.`;
    }
  }

  log.info('/api/auth/admin/me: unauthenticated admin session', {
    hasIsAuthenticated: !!anyReq.isAuthenticated,
    isAuthenticated: anyReq.isAuthenticated ? anyReq.isAuthenticated() : null,
    hasUser: !!anyReq.user,
    hasCookieSteamId: !!cookieSteamId,
    resolvedSteamId,
    reason,
  });
  return res.json({ authenticated: false, reason, message });
});

/**
 * Admin logout – destroys the Passport session and clears the identity cookies.
 */
router.post('/admin/logout', (req: Request, res: Response) => {
  const anyReq = req as Request & {
    logout?: (cb: (err: unknown) => void) => void;
    session?: { destroy?: (cb: (err: unknown) => void) => void };
  };

  // The signed player_steam_id cookie is itself an admin credential (see
  // middleware/auth), so destroying only the Passport session is not a logout.
  clearIdentityCookies(req, res);

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

/**
 * Admin impersonation ("view as player").
 *
 * Lets an admin walk through player-facing flows – map veto in particular –
 * as a specific player, without needing that player's Steam credentials.
 *
 * Guarantees:
 *  - `requireAuth` resolves admin rights from the **real** session/cookie and
 *    deliberately ignores the impersonation cookie, so an admin impersonating a
 *    normal player keeps full admin access and can always stop.
 *  - The impersonation cookie is HMAC-signed and only honoured when the real
 *    requester is an admin, so it grants nothing if copied to another browser.
 *  - Admins cannot impersonate another admin: that would let a lower-trust
 *    admin borrow a peer's identity for audit-visible actions.
 */

/**
 * @openapi
 * /api/auth/impersonate:
 *   get:
 *     tags: [Auth]
 *     summary: Current impersonation state for the signed-in admin
 *     responses:
 *       200:
 *         description: Impersonation state
 */
router.get('/impersonate', requireAuth, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);

  if (!identity.isImpersonating || !identity.effectiveSteamId) {
    return res.json({ success: true, active: false });
  }

  const player = await playerService.getPlayerById(identity.effectiveSteamId).catch(() => null);

  return res.json({
    success: true,
    active: true,
    steamId: identity.effectiveSteamId,
    name: player?.name ?? null,
    avatar: player?.avatar ?? null,
    realSteamId: identity.realSteamId,
  });
});

/**
 * @openapi
 * /api/auth/impersonate:
 *   post:
 *     tags: [Auth]
 *     summary: Start impersonating a player (admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [steamId]
 *             properties:
 *               steamId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Impersonation started
 *       400:
 *         description: Invalid Steam ID
 *       403:
 *         description: Target is an admin, or caller is not an admin
 *       404:
 *         description: No such player
 */
router.post('/impersonate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { steamId: raw } = req.body as { steamId?: unknown };

    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Field "steamId" is required',
      });
    }

    const steamId = raw.trim();
    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({
        success: false,
        error: 'Field "steamId" must be a 17-digit Steam ID',
      });
    }

    const identity = await resolveViewerIdentity(req);
    if (identity.realSteamId === steamId) {
      return res.status(400).json({
        success: false,
        error: 'You are already signed in as this player',
      });
    }

    const target = await playerService.getPlayerById(steamId);
    if (!target) {
      return res.status(404).json({
        success: false,
        error: 'No player found for that Steam ID',
      });
    }

    if (target.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admins cannot impersonate other admins',
      });
    }

    setImpersonationCookie(req, res, steamId);

    log.warn('[IMPERSONATION] Admin started impersonating a player', {
      adminSteamId: identity.realSteamId,
      targetSteamId: steamId,
    });

    return res.json({
      success: true,
      active: true,
      steamId,
      name: target.name ?? null,
      avatar: target.avatar ?? null,
      realSteamId: identity.realSteamId,
    });
  } catch (error) {
    log.error('Failed to start impersonation', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to start impersonation',
    });
  }
});

/**
 * @openapi
 * /api/auth/impersonate/stop:
 *   post:
 *     tags: [Auth]
 *     summary: Stop impersonating and return to your own identity
 *     responses:
 *       200:
 *         description: Impersonation cleared
 */
router.post('/impersonate/stop', requireAuth, async (req: Request, res: Response) => {
  const identity = await resolveViewerIdentity(req);

  clearImpersonationCookie(req, res);

  if (identity.isImpersonating) {
    log.warn('[IMPERSONATION] Admin stopped impersonating', {
      adminSteamId: identity.realSteamId,
      targetSteamId: identity.effectiveSteamId,
    });
  }

  return res.json({ success: true, active: false });
});

export default router;
