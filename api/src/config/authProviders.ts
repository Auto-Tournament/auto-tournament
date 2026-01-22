import type {
  AuthProviderConfig,
  DiscordAuthProviderConfig,
  GitHubAuthProviderConfig,
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

  // Steam – Passport/OpenID flow used for player convenience login and admin identity.
  const steamEnabledEnv = process.env.AUTH_STEAM_ENABLED;
  const steamApiKey = process.env.STEAM_API_KEY;
  const steamEnvEnabled =
    !steamEnabledEnv ||
    steamEnabledEnv.toLowerCase() === '1' ||
    steamEnabledEnv.toLowerCase() === 'true' ||
    steamEnabledEnv.toLowerCase() === 'yes';
  const steamEnabled =
    steamEnvEnabled &&
    !!steamApiKey &&
    steamApiKey.trim().length > 0;

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
    const keycloakLabelEnv = process.env.AUTH_KEYCLOAK_LABEL;
    const keycloakLabel =
      keycloakLabelEnv && keycloakLabelEnv.trim().length > 0
        ? keycloakLabelEnv.trim()
        : 'Keycloak';

    const keycloakButtonLabelEnv = process.env.AUTH_KEYCLOAK_BUTTON_LABEL;
    const keycloakButtonLabel =
      keycloakButtonLabelEnv && keycloakButtonLabelEnv.trim().length > 0
        ? keycloakButtonLabelEnv.trim()
        : undefined;

    const keycloakButtonBgColorEnv = process.env.AUTH_KEYCLOAK_BUTTON_BG_COLOR;
    const keycloakButtonBgColor =
      keycloakButtonBgColorEnv && keycloakButtonBgColorEnv.trim().length > 0
        ? keycloakButtonBgColorEnv.trim()
        : undefined;

    const keycloakButtonTextColorEnv = process.env.AUTH_KEYCLOAK_BUTTON_TEXT_COLOR;
    const keycloakButtonTextColor =
      keycloakButtonTextColorEnv && keycloakButtonTextColorEnv.trim().length > 0
        ? keycloakButtonTextColorEnv.trim()
        : undefined;

    const keycloakButtonHoverBgColorEnv = process.env.AUTH_KEYCLOAK_BUTTON_HOVER_BG_COLOR;
    const keycloakButtonHoverBgColor =
      keycloakButtonHoverBgColorEnv && keycloakButtonHoverBgColorEnv.trim().length > 0
        ? keycloakButtonHoverBgColorEnv.trim()
        : undefined;

    const keycloakProvider: KeycloakAuthProviderConfig = {
      id: 'keycloak',
      kind: 'oidc',
      label: keycloakLabel,
      loginUrl: '/api/auth/keycloak',
      enabled: true,
      issuerUrl: keycloakIssuerUrl.trim(),
      buttonLabel: keycloakButtonLabel,
      buttonBgColor: keycloakButtonBgColor,
      buttonTextColor: keycloakButtonTextColor,
      buttonHoverBgColor: keycloakButtonHoverBgColor,
    };

    providers.push(keycloakProvider);
  }

  // Discord – OAuth2 provider primarily for community/admin workflows.
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

  // GitHub – OAuth2 provider primarily for contributor/admin workflows.
  const githubEnabledEnv = process.env.AUTH_GITHUB_ENABLED;
  const githubEnabled =
    githubEnabledEnv &&
    (githubEnabledEnv.toLowerCase() === '1' ||
      githubEnabledEnv.toLowerCase() === 'true' ||
      githubEnabledEnv.toLowerCase() === 'yes');

  const githubClientId = process.env.GITHUB_CLIENT_ID;

  if (githubEnabled && githubClientId && githubClientId.trim().length > 0) {
    const githubProvider: GitHubAuthProviderConfig = {
      id: 'github',
      kind: 'oauth2',
      label: 'GitHub',
      loginUrl: '/api/auth/github',
      enabled: true,
    };

    providers.push(githubProvider);
  }

  return providers;
}


