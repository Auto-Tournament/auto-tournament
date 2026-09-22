import type {
  AuthProviderConfig,
  DiscordAuthProviderConfig,
  GitHubAuthProviderConfig,
  GoogleAuthProviderConfig,
  KeycloakAuthProviderConfig,
  SteamAuthProviderConfig,
} from '../types/auth.types';

/** True when the env var is set to 1/true/yes (case-insensitive). */
function isEnvFlagOn(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/** Trimmed env var, or undefined when unset or blank. */
function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * A plain OAuth2 provider (Discord, GitHub, Google) is listed when
 * AUTH_<PROVIDER>_ENABLED is on and both <PROVIDER>_CLIENT_ID and
 * <PROVIDER>_CLIENT_SECRET are set. Passport only registers the strategy when
 * both are set (config/passport.ts), so listing it without the secret would
 * show a button that cannot work.
 */
function isOAuthProviderConfigured(provider: 'discord' | 'github' | 'google'): boolean {
  const prefix = provider.toUpperCase();
  return (
    isEnvFlagOn(`AUTH_${prefix}_ENABLED`) &&
    !!envValue(`${prefix}_CLIENT_ID`) &&
    !!envValue(`${prefix}_CLIENT_SECRET`)
  );
}

/**
 * Build the list of configured auth providers based on environment variables.
 *
 * This only exposes **public metadata** (labels, login URLs, issuer URLs).
 * Client secrets stay on the server.
 */
export function getAuthProvidersConfig(): AuthProviderConfig[] {
  const providers: AuthProviderConfig[] = [];

  // Steam – Passport/OpenID flow used for player convenience login and admin identity.
  // Unlike the others, Steam is on unless AUTH_STEAM_ENABLED says otherwise.
  const steamEnvEnabled = !process.env.AUTH_STEAM_ENABLED || isEnvFlagOn('AUTH_STEAM_ENABLED');
  const steamProvider: SteamAuthProviderConfig = {
    id: 'steam',
    kind: 'steam-openid',
    label: 'Steam',
    loginUrl: '/api/auth/steam',
    enabled: steamEnvEnabled && !!envValue('STEAM_API_KEY'),
  };
  providers.push(steamProvider);

  // Keycloak – OIDC provider for admin/SSO style logins.
  const keycloakIssuerUrl = envValue('KEYCLOAK_ISSUER_URL');
  if (isEnvFlagOn('AUTH_KEYCLOAK_ENABLED') && keycloakIssuerUrl) {
    const keycloakProvider: KeycloakAuthProviderConfig = {
      id: 'keycloak',
      kind: 'oidc',
      label: envValue('AUTH_KEYCLOAK_LABEL') ?? 'Keycloak',
      loginUrl: '/api/auth/keycloak',
      enabled: true,
      issuerUrl: keycloakIssuerUrl,
      buttonLabel: envValue('AUTH_KEYCLOAK_BUTTON_LABEL'),
      buttonBgColor: envValue('AUTH_KEYCLOAK_BUTTON_BG_COLOR'),
      buttonTextColor: envValue('AUTH_KEYCLOAK_BUTTON_TEXT_COLOR'),
      buttonHoverBgColor: envValue('AUTH_KEYCLOAK_BUTTON_HOVER_BG_COLOR'),
    };
    providers.push(keycloakProvider);
  }

  // Discord, GitHub, Google – plain OAuth2 providers.
  if (isOAuthProviderConfigured('discord')) {
    const discordProvider: DiscordAuthProviderConfig = {
      id: 'discord',
      kind: 'oauth2',
      label: 'Discord',
      loginUrl: '/api/auth/discord',
      enabled: true,
    };
    providers.push(discordProvider);
  }

  if (isOAuthProviderConfigured('github')) {
    const githubProvider: GitHubAuthProviderConfig = {
      id: 'github',
      kind: 'oauth2',
      label: 'GitHub',
      loginUrl: '/api/auth/github',
      enabled: true,
    };
    providers.push(githubProvider);
  }

  if (isOAuthProviderConfigured('google')) {
    const googleProvider: GoogleAuthProviderConfig = {
      id: 'google',
      kind: 'oauth2',
      label: 'Google',
      loginUrl: '/api/auth/google',
      enabled: true,
    };
    providers.push(googleProvider);
  }

  return providers;
}
