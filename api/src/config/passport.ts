import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as KeycloakStrategy } from 'passport-keycloak-oauth2-oidc';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { log } from '../utils/logger';

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

interface GitHubProfile {
  id: string;
  username?: string;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

export function configurePassportAuth(): void {
  configureSteamStrategy();
  configureDiscordStrategy();
  configureKeycloakStrategy();
  configureGitHubStrategy();
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
      },
      (
        accessToken: string,
        refreshToken: string,
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
          accessToken,
          refreshToken,
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
  // Example issuer: https://sso.example.com/realms/matchzy
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
  } = {
    clientID,
    authServerURL,
    realm,
    callbackURL,
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
      accessToken: string,
      refreshToken: string,
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
        accessToken,
        refreshToken,
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

function configureGitHubStrategy(): void {
  const clientID = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    return;
  }

  const baseUrl = getBackendBaseUrl();
  const callbackURL = `${baseUrl}/api/auth/github/callback`;

  passport.use(
    new GitHubStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
        scope: ['read:user', 'user:email'],
      },
      (
        accessToken: string,
        refreshToken: string,
        profile: GitHubProfile,
        done: (err: unknown, user?: unknown) => void
      ) => {
        const safeProfile = {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          hasAvatar: Boolean(profile.photos && profile.photos[0]?.value),
        };
        log.info('GitHubStrategy callback: received profile from GitHub', {
          profile: safeProfile,
        });

        done(null, {
          provider: 'github',
          githubId: profile.id,
          username: profile.username,
          displayName: profile.displayName || profile.username || profile.id,
          avatarUrl: profile.photos && profile.photos[0]?.value,
          accessToken,
          refreshToken,
        });
      }
    )
  );
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
