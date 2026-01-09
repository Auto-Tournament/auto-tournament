export type AuthProviderId = 'steam' | 'keycloak' | 'discord' | 'github';

export type AuthProviderKind = 'steam-openid' | 'oidc' | 'oauth2';

export interface BaseAuthProviderConfig {
  /**
   * Stable identifier used on both backend and frontend.
   */
  id: AuthProviderId;
  /**
   * High-level protocol/category for the provider.
   */
  kind: AuthProviderKind;
  /**
   * Human-friendly label to show in the UI (e.g. \"Sign in with Steam\").
   */
  label: string;
  /**
   * Public login URL to redirect the browser to when starting the flow.
   */
  loginUrl: string;
  /**
   * Whether this provider is currently enabled based on configuration.
   */
  enabled: boolean;
}

export interface SteamAuthProviderConfig extends BaseAuthProviderConfig {
  id: 'steam';
  kind: 'steam-openid';
}

export interface KeycloakAuthProviderConfig extends BaseAuthProviderConfig {
  id: 'keycloak';
  kind: 'oidc';
  /**
   * Public issuer URL of the Keycloak realm (e.g. https://sso.example.com/realms/my-realm).
   * This is intentionally public metadata; client IDs/secrets remain server-side only.
   */
  issuerUrl: string;
}

export interface DiscordAuthProviderConfig extends BaseAuthProviderConfig {
  id: 'discord';
  kind: 'oauth2';
}

export interface GitHubAuthProviderConfig extends BaseAuthProviderConfig {
  id: 'github';
  kind: 'oauth2';
}

export type AuthProviderConfig =
  | SteamAuthProviderConfig
  | KeycloakAuthProviderConfig
  | DiscordAuthProviderConfig
  | GitHubAuthProviderConfig;


