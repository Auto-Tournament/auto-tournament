import type {
  AuthProviderConfig,
  DiscordAuthProviderConfig,
  KeycloakAuthProviderConfig,
  SteamAuthProviderConfig,
} from '../types/auth.types';

/**
 * Build the list of configured auth providers based on environment variables.
 *
 * This is intentionally conservative: it only exposes **public metadata**
 * (labels, login URLs, issuer URLs) – secrets like client secrets stay on the
 * server and will be wired into Passport/OIDC flows later.
 */
export function getAuthProvidersConfig(): AuthProviderConfig[] {
  const providers: AuthProviderConfig[] = [];

  // Steam – existing OpenID flow used for player convenience login.
  const steamEnabledEnv = process.env.AUTH_STEAM_ENABLED;
  const steamEnabled =
    !steamEnabledEnv ||
    steamEnabledEnv.toLowerCase() === '1' ||
    steamEnabledEnv.toLowerCase() === 'true' ||
    steamEnabledEnv.toLowerCase() === 'yes';

  const steamProvider: SteamAuthProviderConfig = {
    id: 'steam',
    kind: 'steam-openid',
    label: 'Steam',
    loginUrl: '/api/auth/steam',
    enabled: steamEnabled,
  };

  providers.push(steamProvider);

  // Keycloak – planned OIDC provider for admin/SSO style logins.
  const keycloakEnabledEnv = process.env.AUTH_KEYCLOAK_ENABLED;
  const keycloakEnabled =
    keycloakEnabledEnv &&
    (keycloakEnabledEnv.toLowerCase() === '1' ||
      keycloakEnabledEnv.toLowerCase() === 'true' ||
      keycloakEnabledEnv.toLowerCase() === 'yes');

  const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL;

  if (keycloakEnabled && keycloakIssuerUrl && keycloakIssuerUrl.trim().length > 0) {
    const keycloakProvider: KeycloakAuthProviderConfig = {
      id: 'keycloak',
      kind: 'oidc',
      label: 'Keycloak',
      loginUrl: '/api/auth/keycloak', // To be implemented with Passport/OIDC
      enabled: true,
      issuerUrl: keycloakIssuerUrl.trim(),
    };

    providers.push(keycloakProvider);
  }

  // Discord – planned OAuth2 provider primarily for community/admin workflows.
  const discordEnabledEnv = process.env.AUTH_DISCORD_ENABLED;
  const discordEnabled =
    discordEnabledEnv &&
    (discordEnabledEnv.toLowerCase() === '1' ||
      discordEnabledEnv.toLowerCase() === 'true' ||
      discordEnabledEnv.toLowerCase() === 'yes');

  const discordClientId = process.env.DISCORD_CLIENT_ID;

  if (discordEnabled && discordClientId && discordClientId.trim().length > 0) {
    const discordProvider: DiscordAuthProviderConfig = {
      id: 'discord',
      kind: 'oauth2',
      label: 'Discord',
      loginUrl: '/api/auth/discord', // To be implemented with Passport/OAuth2
      enabled: true,
    };

    providers.push(discordProvider);
  }

  return providers;
}


