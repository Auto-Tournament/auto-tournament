import passport from 'passport';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const { Strategy: SteamStrategy } = require('passport-steam');
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const { Strategy: DiscordStrategy } = require('passport-discord');
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const { Strategy: KeycloakStrategy } = require('passport-keycloak-oauth2-oidc');
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const { Strategy: GitHubStrategy } = require('passport-github2');

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
      (identifier: string, profile: SteamProfile, done: (err: unknown, user?: unknown) => void) => {
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
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientID || !clientSecret || !redirectUri) {
    return;
  }

  passport.use(
    new DiscordStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: redirectUri,
        scope: ['identify', 'email'],
      },
      (
        accessToken: string,
        refreshToken: string,
        profile: DiscordProfile,
        done: (err: unknown, user?: unknown) => void
      ) => {
        done(null, {
          provider: 'discord',
          discordId: profile.id,
          username: profile.username,
          avatar: profile.avatar,
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
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  const callbackPath = process.env.KEYCLOAK_CALLBACK_PATH || '/api/auth/keycloak/callback';

  if (!issuerUrl || !clientID || !clientSecret) {
    return;
  }

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

  passport.use(
    new KeycloakStrategy(
      {
        clientID,
        clientSecret,
        authServerURL,
        realm,
        callbackURL,
      },
      (
        accessToken: string,
        refreshToken: string,
        profile: KeycloakProfile,
        done: (err: unknown, user?: unknown) => void
      ) => {
        done(null, {
          provider: 'keycloak',
          keycloakId: profile.id,
          displayName: profile.displayName || profile.username || profile.id,
          accessToken,
          refreshToken,
        });
      }
    )
  );
}

function configureGitHubStrategy(): void {
  const clientID = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const callbackURL = process.env.GITHUB_CALLBACK_URL;

  if (!clientID || !clientSecret || !callbackURL) {
    return;
  }

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
passport.serializeUser((user, done) => {
  done(null, user as unknown);
});

passport.deserializeUser((obj, done) => {
  done(null, obj as unknown);
});

export { passport };


