import type {
  AuthProviderConfig,
  DiscordAuthProviderConfig,
  GitHubAuthProviderConfig,
  GoogleAuthProviderConfig,
  OidcAuthProviderConfig,
  SteamAuthProviderConfig,
  TwitchAuthProviderConfig,
  EpicAuthProviderConfig,
} from '../types/auth.types';
import { OIDC_DEFAULT_LABEL, effectiveProviderSettings } from './signInProviders';

/**
 * A plain OAuth2 provider (Discord, GitHub, Google, Twitch) is listed when it
 * is enabled and has both a client id and a secret, from the environment
 * (AUTH_<PROVIDER>_ENABLED, <PROVIDER>_CLIENT_ID, <PROVIDER>_CLIENT_SECRET) or
 * from Settings -> Sign-in; the environment wins. Passport registers the
 * strategy under the same rule (config/passport.ts), so a listed button
 * always works.
 */
function isOAuthProviderConfigured(provider: 'discord' | 'github' | 'google' | 'twitch' | 'epic' | 'oidc'): boolean {
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

  // OpenID Connect: any OIDC server, under the name the admin gave it.
  if (isOAuthProviderConfigured('oidc')) {
    const oidc = effectiveProviderSettings('oidc');
    const oidcProvider: OidcAuthProviderConfig = {
      id: 'oidc',
      kind: 'oidc',
      label: oidc.label || OIDC_DEFAULT_LABEL,
      loginUrl: '/api/auth/oidc',
      enabled: true,
      issuerUrl: oidc.issuerUrl as string,
    };
    providers.push(oidcProvider);
  }

  return providers;
}
