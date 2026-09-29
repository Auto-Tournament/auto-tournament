import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { log } from '../utils/logger';
import { SignedCookieStateStore } from '../utils/oauthStateCookie';
import { effectiveProviderSettings } from './signInProviders';
import { adminEmailsConfigured } from '../utils/adminEmails';
import { createTwitchStrategy, type TwitchStrategyOptions } from './twitchStrategy';
import { createEpicStrategy } from './epicStrategy';
import { createOidcStrategy } from './oidcStrategy';

interface SteamProfile {
  id: string;
  displayName?: string;
  _json?: {
    avatarfull?: string;
  };
}

export interface DiscordProfile {
  id: string;
  username?: string;
  avatar?: string | null;
  /** Present with the `email` scope. */
  email?: string | null;
  /** Discord has verified `email`. */
  verified?: boolean;
}

export interface GitHubProfile {
  id: string;
  username?: string;
  displayName?: string;
  photos?: Array<{ value: string }>;
  /** With the `user:email` scope and `allRawEmails`: every address, flagged. */
  emails?: Array<{ value: string; primary?: boolean; verified?: boolean }>;
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
  configureSettingsManagedStrategies();
  configureTestOAuthStrategies();
}

/** The strategies Settings -> Sign-in manages; `reloadPassportAuth` redoes them. */
const SETTINGS_MANAGED_STRATEGIES = ['steam', 'discord', 'github', 'google', 'twitch', 'epic', 'oidc'] as const;

function configureSettingsManagedStrategies(): void {
  configureSteamStrategy();
  configureDiscordStrategy();
  configureOAuthStrategy('github', createGitHubStrategy);
  configureOAuthStrategy('google', createGoogleStrategy);
  configureOAuthStrategy('twitch', createTwitchLoginStrategy);
  configureOAuthStrategy('epic', createEpicLoginStrategy);
  configureOidcStrategy();
}

/**
 * Re-register the Settings-managed strategies from the current settings
 * (environment, then saved rows), without a restart. Passport looks a
 * strategy up by name on every request, so the next sign-in uses the new
 * credentials.
 */
export function reloadPassportAuth(): void {
  for (const name of SETTINGS_MANAGED_STRATEGIES) {
    passport.unuse(name);
  }
  configureSettingsManagedStrategies();
  log.info('[SIGN-IN] Sign-in strategies reloaded', {
    active: SETTINGS_MANAGED_STRATEGIES.filter((name) => isStrategyConfigured(name)),
  });
}

export function getBackendBaseUrl(): string {
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
  const steam = effectiveProviderSettings('steam');
  const steamApiKey = steam.secret;

  if (!steam.active || !steamApiKey) {
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
  const discord = effectiveProviderSettings('discord');
  const clientID = discord.clientId;
  const clientSecret = discord.secret;

  if (!discord.active || !clientID || !clientSecret) {
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
          verifiedEmail: discordVerifiedEmail(profile),
        });
      }
    )
  );
}

/**
 * OpenID Connect (any OIDC server) when it is enabled and has an issuer, a
 * client id and a secret in Settings -> Sign-in. The endpoints come from the
 * issuer's discovery document on the first sign-in (config/oidcStrategy.ts).
 */
function configureOidcStrategy(): void {
  const settings = effectiveProviderSettings('oidc');
  if (!settings.active || !settings.issuerUrl || !settings.clientId || !settings.secret) return;
  const callbackURL = `${getBackendBaseUrl()}/api/auth/oidc/callback`;
  const strategy = createOidcStrategy(
    {
      issuerUrl: settings.issuerUrl,
      clientID: settings.clientId,
      clientSecret: settings.secret,
      callbackURL,
      // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
      store: new SignedCookieStateStore({ provider: 'oidc', callbackURL }),
    },
    (user, done) => {
      log.info('OidcStrategy callback: received profile', { profile: { id: user.oidcId } });
      done(null, user);
    }
  );
  passport.use('oidc', strategy);
}

/**
 * Register a plain OAuth2 provider (GitHub, Google, Twitch) when it is enabled
 * and has a client id and secret (environment or Settings -> Sign-in), with
 * the callback at <base>/api/auth/<provider>/callback.
 */
function configureOAuthStrategy(
  provider: 'github' | 'google' | 'twitch' | 'epic',
  create: (options: OAuthStrategyOptions) => unknown
): void {
  const settings = effectiveProviderSettings(provider);
  const clientID = settings.clientId;
  const clientSecret = settings.secret;

  if (!settings.active || !clientID || !clientSecret) {
    return;
  }

  const callbackURL = `${getBackendBaseUrl()}/api/auth/${provider}/callback`;
  passport.use(provider, create({ clientID, clientSecret, callbackURL, stateProvider: provider }));
}

/*
 * Verified email addresses, for the ADMIN_EMAILS bootstrap only
 * (utils/adminEmails). Each returns an address only when the provider says it
 * verified it. Accounts are never linked or merged by email.
 */

/** Discord's address when Discord marks it verified. */
export function discordVerifiedEmail(profile: DiscordProfile): string | undefined {
  return profile.verified === true && profile.email ? profile.email : undefined;
}

/** GitHub's primary address when it is verified (needs `user:email` and `allRawEmails`). */
export function githubVerifiedEmail(profile: GitHubProfile): string | undefined {
  return profile.emails?.find((e) => e.primary === true && e.verified === true)?.value || undefined;
}

/** Google's address when `email_verified` is true. */
export function googleVerifiedEmail(profile: GoogleProfile): string | undefined {
  return profile.emails?.find((e) => e.verified === true)?.value || undefined;
}

/** The Passport user for a GitHub login. No tokens: nothing uses them. */
export function githubProfileToUser(profile: GitHubProfile) {
  return {
    provider: 'github' as const,
    githubId: String(profile.id),
    username: profile.username,
    displayName: profile.displayName || profile.username || String(profile.id),
    avatarUrl: profile.photos?.[0]?.value,
    verifiedEmail: githubVerifiedEmail(profile),
  };
}

/** The Passport user for a Google login, keyed by `sub`. No tokens: nothing uses them. */
export function googleProfileToUser(profile: GoogleProfile) {
  return {
    provider: 'google' as const,
    googleId: String(profile.id),
    displayName: profile.displayName || profile.emails?.[0]?.value || String(profile.id),
    avatarUrl: profile.photos?.[0]?.value,
    verifiedEmail: googleVerifiedEmail(profile),
  };
}

function createGitHubStrategy(options: OAuthStrategyOptions) {
  return new GitHubStrategy(
    {
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      ...options.endpoints,
      // Public profile only: the login keys on the numeric user id. The
      // email scope is asked for only when ADMIN_EMAILS is set, so a primary
      // verified address can grant admin (utils/adminEmails).
      scope: adminEmailsConfigured() ? ['read:user', 'user:email'] : ['read:user'],
      allRawEmails: true,
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

function createTwitchLoginStrategy(options: OAuthStrategyOptions) {
  const twitchOptions: TwitchStrategyOptions = {
    clientID: options.clientID,
    clientSecret: options.clientSecret,
    callbackURL: options.callbackURL,
    // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
    store: new SignedCookieStateStore({
      provider: options.stateProvider,
      callbackURL: options.callbackURL,
    }),
  };
  return createTwitchStrategy(twitchOptions, (user, done) => {
    log.info('TwitchStrategy callback: received profile from Twitch', {
      profile: { id: user.twitchId, hasAvatar: !!user.avatarUrl },
    });
    done(null, user);
  });
}

function createEpicLoginStrategy(options: OAuthStrategyOptions) {
  return createEpicStrategy(
    {
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      // CSRF protection for the OAuth round trip; see utils/oauthStateCookie.
      store: new SignedCookieStateStore({
        provider: options.stateProvider,
        callbackURL: options.callbackURL,
      }),
    },
    (user, done) => {
      log.info('EpicStrategy callback: received profile from Epic', { profile: { id: user.epicId } });
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
