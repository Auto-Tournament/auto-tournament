import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as KeycloakStrategy } from 'passport-keycloak-oauth2-oidc';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { log } from '../utils/logger';
import { SignedCookieStateStore } from '../utils/oauthStateCookie';

interface SteamProfile {
  id: string;
  displayName?: string;
  _json?: {
    avatarfull?: string;
  };
}

interface DiscordProfile {
  id: string;
  username?: string;
  avatar?: string | null;
}

interface KeycloakProfile {
  id: string;
  displayName?: string;
  username?: string;
}

export interface GitHubProfile {
  id: string;
  username?: string;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

/** Profile as passport-google-oauth20 parses it from Google's OIDC userinfo. */
export interface GoogleProfile {
  /** The OIDC `sub` claim: stable, unlike the email address. */
  id: string;
  displayName?: string;
  emails?: Array<{ value: string; verified?: boolean }>;
  photos?: Array<{ value: string }>;
}

type VerifyDone = (err: unknown, user?: unknown) => void;

/**
 * Endpoint overrides for a provider strategy. Only the test-only fake provider
 * sets these (see configureTestOAuthStrategies); real logins use each
 * library's defaults.
 */
interface OAuthEndpoints {
  authorizationURL?: string;
  tokenURL?: string;
  userProfileURL?: string;
}

interface OAuthStrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  /** Namespace for the signed state cookie (oauth_state_<stateProvider>). */
  stateProvider: string;
  endpoints?: OAuthEndpoints;
}

export function configurePassportAuth(): void {
  configureSteamStrategy();
  configureDiscordStrategy();
  configureKeycloakStrategy();
  configureOAuthStrategy('github', createGitHubStrategy);
  configureOAuthStrategy('google', createGoogleStrategy);
  configureTestOAuthStrategies();
}

function getBackendBaseUrl(): string {
  // Prefer explicit backend URL, then FRONTEND_BASE_URL (with /api), then localhost.
  const explicit = process.env.BACKEND_BASE_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/+$/, '');
  }

  const frontend = process.env.FRONTEND_BASE_URL;
  if (frontend && frontend.trim().length > 0) {
    const base = frontend.trim().replace(/\/+$/, '');
    return base;
  }

  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

function configureSteamStrategy(): void {
  const steamApiKey = process.env.STEAM_API_KEY;

  if (!steamApiKey) {
    // If Steam is not configured, leave the strategy unregistered.
    // The auth providers config will also treat Steam as disabled in this case.
    // This avoids exposing a broken "Sign in with Steam" button.
    return;
  }

  const baseUrl = getBackendBaseUrl();
  const returnURL = `${baseUrl}/api/auth/steam/callback`;
  const realm = baseUrl;

  passport.use(
    new SteamStrategy(
      {
        apiKey: steamApiKey,
        returnURL,
        realm,
      },
      (
        _identifier: string,
        profile: SteamProfile,
        done: (err: unknown, user?: unknown) => void
      ) => {
        // Minimal structured debug for Steam logins so we can correlate
        // Passport-level data with downstream auth routes.
        const safeProfile = {
          id: profile.id,
          displayName: profile.displayName,
          hasAvatar: Boolean(profile._json?.avatarfull),
        };

        log.info('SteamStrategy callback: received profile from Steam', {
          profile: safeProfile,
        });

        const steamId = profile.id;
        const displayName = profile.displayName || steamId;
        const avatarUrl = profile._json?.avatarfull;
        done(null, {
          provider: 'steam',
          steamId,
          displayName,
          avatarUrl,
        });
      }
    )
  );
}

function configureDiscordStrategy(): void {
  const clientID = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    return;
  }

  const baseUrl = getBackendBaseUrl();
  const callbackURL = `${baseUrl}/api/auth/discord/callback`;

  passport.use(
    new DiscordStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
        scope: ['identify', 'email'],
        // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
        store: new SignedCookieStateStore({ provider: 'discord', callbackURL }),
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: DiscordProfile,
        done: (err: unknown, user?: unknown) => void
      ) => {
        const safeProfile = {
          id: profile.id,
          username: profile.username,
          hasAvatar: profile.avatar != null,
        };
        log.info('DiscordStrategy callback: received profile from Discord', {
          profile: safeProfile,
        });

        let avatarUrl: string | undefined;
        if (profile.avatar) {
          const ext = profile.avatar.startsWith('a_') ? 'gif' : 'png';
          avatarUrl = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}`;
        }

        done(null, {
          provider: 'discord',
          discordId: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          avatarUrl,
        });
      }
    )
  );
}

function configureKeycloakStrategy(): void {
  const issuerUrl = process.env.KEYCLOAK_ISSUER_URL;
  const clientID = process.env.KEYCLOAK_CLIENT_ID;
  const rawClientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  const callbackPath = process.env.KEYCLOAK_CALLBACK_PATH || '/api/auth/keycloak/callback';

  if (!issuerUrl || !clientID) {
    return;
  }

  // Treat absence of KEYCLOAK_CLIENT_SECRET as a "public" client (no secret).
  // When a secret is provided, assume a confidential client.
  const clientSecret =
    rawClientSecret && rawClientSecret.trim().length > 0 ? rawClientSecret.trim() : undefined;

  const baseUrl = getBackendBaseUrl();
  const callbackURL = `${baseUrl}${callbackPath}`;

  // passport-keycloak-oauth2-oidc expects authServerURL and realm; derive them from issuer URL when possible.
  // Example issuer: https://sso.example.com/realms/auto-tournament
  let authServerURL = issuerUrl;
  let realm = 'master';

  try {
    const url = new URL(issuerUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const realmsIndex = parts.indexOf('realms');
    if (realmsIndex >= 0 && parts[realmsIndex + 1]) {
      realm = parts[realmsIndex + 1];
      url.pathname = parts.slice(0, realmsIndex).join('/') || '/';
      authServerURL = url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Fallback to raw issuer URL
    authServerURL = issuerUrl.replace(/\/+$/, '');
  }

  const strategyOptions: {
    clientID: string;
    authServerURL: string;
    realm: string;
    callbackURL: string;
    clientSecret?: string;
    publicClient?: boolean;
    store: SignedCookieStateStore;
  } = {
    clientID,
    authServerURL,
    realm,
    callbackURL,
    // passport-keycloak-oauth2-oidc passes options straight to passport-oauth2,
    // so the same signed-cookie state store applies. See utils/oauthStateCookie.
    store: new SignedCookieStateStore({ provider: 'keycloak', callbackURL }),
  };

  if (clientSecret) {
    // Confidential client – use client secret, mark as non-public.
    strategyOptions.clientSecret = clientSecret;
    strategyOptions.publicClient = false;
  } else {
    // Public client – no secret.
    strategyOptions.publicClient = true;
  }

  const keycloakStrategy = new KeycloakStrategy(
    strategyOptions,
    (
      _accessToken: string,
      _refreshToken: string,
      profile: KeycloakProfile,
      done: (err: unknown, user?: unknown) => void
    ) => {
      const safeProfile = {
        id: profile.id,
        displayName: profile.displayName,
        username: profile.username,
      };
      log.info('KeycloakStrategy callback: received profile from Keycloak', {
        profile: safeProfile,
      });

      done(null, {
        provider: 'keycloak',
        keycloakId: profile.id,
        displayName: profile.displayName || profile.username || profile.id,
      });
    }
  );

  // Optionally force Keycloak to immediately redirect to a specific external IdP
  // (e.g. Vipps) by appending `kc_idp_hint` to the authorization URL.
  // Set KEYCLOAK_IDP_HINT to the IdP alias configured in Keycloak.
  const idpHint = process.env.KEYCLOAK_IDP_HINT;
  if (idpHint && idpHint.trim().length > 0) {
    try {
      const hint = encodeURIComponent(idpHint.trim());
      const anyStrategy = keycloakStrategy as unknown as {
        _oauth2?: { _authorizeUrl?: string };
      };
      if (anyStrategy._oauth2 && typeof anyStrategy._oauth2._authorizeUrl === 'string') {
        const original = anyStrategy._oauth2._authorizeUrl;
        const separator = original.includes('?') ? '&' : '?';
        anyStrategy._oauth2._authorizeUrl = `${original}${separator}kc_idp_hint=${hint}`;
      }
    } catch {
      // If internals change, fail softly and continue without idp hint.
    }
  }

  passport.use(keycloakStrategy);
}

/**
 * Register a plain OAuth2 provider (GitHub, Google) when both its client ID
 * and secret are set: <PROVIDER>_CLIENT_ID / <PROVIDER>_CLIENT_SECRET, with
 * the callback at <base>/api/auth/<provider>/callback.
 */
function configureOAuthStrategy(
  provider: 'github' | 'google',
  create: (options: OAuthStrategyOptions) => unknown
): void {
  const prefix = provider.toUpperCase();
  const clientID = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();

  if (!clientID || !clientSecret) {
    return;
  }

  const callbackURL = `${getBackendBaseUrl()}/api/auth/${provider}/callback`;
  passport.use(provider, create({ clientID, clientSecret, callbackURL, stateProvider: provider }));
}

/** The Passport user for a GitHub login. No tokens: nothing uses them. */
export function githubProfileToUser(profile: GitHubProfile) {
  return {
    provider: 'github' as const,
    githubId: String(profile.id),
    username: profile.username,
    displayName: profile.displayName || profile.username || String(profile.id),
    avatarUrl: profile.photos?.[0]?.value,
  };
}

/** The Passport user for a Google login, keyed by `sub`. No tokens: nothing uses them. */
export function googleProfileToUser(profile: GoogleProfile) {
  return {
    provider: 'google' as const,
    googleId: String(profile.id),
    displayName: profile.displayName || profile.emails?.[0]?.value || String(profile.id),
    avatarUrl: profile.photos?.[0]?.value,
  };
}

function createGitHubStrategy(options: OAuthStrategyOptions) {
  return new GitHubStrategy(
    {
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      ...options.endpoints,
      // Public profile only. The login keys on the numeric user id, so no
      // email scope is needed.
      scope: ['read:user'],
      // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
      store: new SignedCookieStateStore({
        provider: options.stateProvider,
        callbackURL: options.callbackURL,
      }),
    },
    (_accessToken: string, _refreshToken: string, profile: GitHubProfile, done: VerifyDone) => {
      const user = githubProfileToUser(profile);
      log.info('GitHubStrategy callback: received profile from GitHub', {
        profile: { id: user.githubId, username: user.username, hasAvatar: !!user.avatarUrl },
      });
      done(null, user);
    }
  );
}

function createGoogleStrategy(options: OAuthStrategyOptions) {
  return new GoogleStrategy(
    {
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      ...options.endpoints,
      scope: ['openid', 'email', 'profile'],
      // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
      store: new SignedCookieStateStore({
        provider: options.stateProvider,
        callbackURL: options.callbackURL,
      }),
    },
    (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done: VerifyDone) => {
      const user = googleProfileToUser(profile);
      // No email in the log: the id is enough to correlate.
      log.info('GoogleStrategy callback: received profile from Google', {
        profile: { id: user.googleId, hasAvatar: !!user.avatarUrl },
      });
      done(null, user);
    }
  );
}

/** Passport strategy name for the test-only fake provider of `provider`. */
export function testOAuthStrategyName(provider: 'github' | 'google'): string {
  return `${provider}-test`;
}

/**
 * Test-only: a second GitHub and Google strategy whose authorize, token and
 * profile endpoints point at the fake provider in routes/test.ts instead of
 * github.com / google.com. They run the real strategy code (state cookie, code
 * exchange, profile parsing, profile-to-user mapping), so the API tests can
 * drive a full callback without a real provider.
 *
 * Registered only when ENABLE_TEST_ENDPOINTS is explicitly on. That flag
 * already exposes /api/test/login-admin, so this adds no new way in.
 */
function configureTestOAuthStrategies(): void {
  const flag = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') {
    return;
  }

  // The token and profile calls are server-to-server, so they go to this
  // process directly rather than through FRONTEND_BASE_URL.
  const self = `http://127.0.0.1:${process.env.PORT || '3000'}/api/test/fake-oauth`;
  const base = getBackendBaseUrl();

  const create = {
    github: createGitHubStrategy,
    google: createGoogleStrategy,
  } as const;

  for (const provider of ['github', 'google'] as const) {
    const name = testOAuthStrategyName(provider);
    passport.use(
      name,
      create[provider]({
        clientID: 'test-client-id',
        clientSecret: 'test-client-secret',
        callbackURL: `${base}/api/test/oauth/${provider}/callback`,
        stateProvider: name,
        endpoints: {
          authorizationURL: `${self}/${provider}/authorize`,
          tokenURL: `${self}/${provider}/token`,
          // Must end in /userinfo so passport-google-oauth20 parses it as OIDC.
          userProfileURL: `${self}/${provider}/userinfo`,
        },
      })
    );
  }
}

/** Whether a Passport strategy with this name is registered. */
export function isStrategyConfigured(name: string): boolean {
  const anyPassport = passport as unknown as { _strategy?: (n: string) => unknown };
  return typeof anyPassport._strategy === 'function' && !!anyPassport._strategy(name);
}

// We don't currently use sessions, but Passport still expects serialize/deserialize
// when session support is enabled. Define no-op versions for future use.
passport.serializeUser((user: unknown, done: (err: unknown, id?: unknown) => void) => {
  done(null, user);
});

passport.deserializeUser((obj: unknown, done: (err: unknown, user?: unknown) => void) => {
  done(null, obj);
});

export { passport };
