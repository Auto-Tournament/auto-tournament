import type {
  AuthProviderConfig,
  DiscordAuthProviderConfig,
  GitHubAuthProviderConfig,
  GoogleAuthProviderConfig,
  KeycloakAuthProviderConfig,
  SteamAuthProviderConfig,
  TwitchAuthProviderConfig,
  EpicAuthProviderConfig,
} from '../types/auth.types';
import { effectiveProviderSettings } from './signInProviders';

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
 * A plain OAuth2 provider (Discord, GitHub, Google, Twitch) is listed when it
 * is enabled and has both a client id and a secret, from the environment
 * (AUTH_<PROVIDER>_ENABLED, <PROVIDER>_CLIENT_ID, <PROVIDER>_CLIENT_SECRET) or
 * from Settings -> Sign-in; the environment wins. Passport registers the
 * strategy under the same rule (config/passport.ts), so a listed button
 * always works.
 */
function isOAuthProviderConfigured(provider: 'discord' | 'github' | 'google' | 'twitch' | 'epic'): boolean {
  return effectiveProviderSettings(provider).active;
}

/**
 * Whether Steam sign-in is meant to be on. It is unless AUTH_STEAM_ENABLED
 * says otherwise; an operator who turned it off on purpose does not want to
 * be warned that Steam is unreachable.
 */
export function isSteamSignInWanted(): boolean {
  return effectiveProviderSettings('steam').enabled;
}

/**
 * Build the list of configured auth providers: environment variables first,
 * then what an admin saved on Settings -> Sign-in.
 *
 * This only exposes **public metadata** (labels, login URLs, issuer URLs).
 * Client secrets stay on the server.
 */
export function getAuthProvidersConfig(): AuthProviderConfig[] {
  const providers: AuthProviderConfig[] = [];

  // Steam – Passport/OpenID flow used for player convenience login and admin identity.
  // Unlike the others, Steam is on unless AUTH_STEAM_ENABLED says otherwise.
  const steamEnvEnabled = isSteamSignInWanted();
  const steamProvider: SteamAuthProviderConfig = {
    id: 'steam',
    kind: 'steam-openid',
    label: 'Steam',
    loginUrl: '/api/auth/steam',
    enabled: steamEnvEnabled && effectiveProviderSettings('steam').configured,
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

  if (isOAuthProviderConfigured('twitch')) {
    const twitchProvider: TwitchAuthProviderConfig = {
      id: 'twitch',
      kind: 'oauth2',
      label: 'Twitch',
      loginUrl: '/api/auth/twitch',
      enabled: true,
    };
    providers.push(twitchProvider);
  }

  if (isOAuthProviderConfigured('epic')) {
    const epicProvider: EpicAuthProviderConfig = {
      id: 'epic',
      kind: 'oauth2',
      label: 'Epic Games',
      loginUrl: '/api/auth/epic',
      enabled: true,
    };
    providers.push(epicProvider);
  }

  return providers;
}
