/**
 * Twitch sign-in: plain OAuth2 (authorization code) against id.twitch.tv, then
 * the user from the Helix `GET /users` endpoint, which needs the app's client
 * id as a header. No scopes: the public profile is all the login uses, and it
 * keys on Twitch's numeric user id.
 *
 * https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
 * https://dev.twitch.tv/docs/api/reference/#get-users
 */
import { Strategy as OAuth2Strategy } from 'passport-oauth2';

export const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

export interface TwitchStrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  store: unknown;
}

/** One user from Helix `GET /users`. */
export interface TwitchHelixUser {
  id: string;
  login?: string;
  display_name?: string;
  profile_image_url?: string;
}

export interface TwitchUser {
  provider: 'twitch';
  twitchId: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
}

/** The Passport user for a Twitch login. No tokens: nothing uses them. */
export function twitchProfileToUser(profile: TwitchHelixUser): TwitchUser {
  return {
    provider: 'twitch',
    twitchId: String(profile.id),
    username: profile.login,
    displayName: profile.display_name || profile.login || String(profile.id),
    avatarUrl: profile.profile_image_url || undefined,
  };
}

type Done = (err: unknown, user?: unknown) => void;

export function createTwitchStrategy(
  options: TwitchStrategyOptions,
  verify: (user: TwitchUser, done: Done) => void
): unknown {
  const strategy = new OAuth2Strategy(
    {
      authorizationURL: TWITCH_AUTHORIZE_URL,
      tokenURL: TWITCH_TOKEN_URL,
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      // Twitch wants the parameter even when no scope is asked for.
      scope: [],
      store: options.store,
    },
    (_accessToken: string, _refreshToken: string, profile: TwitchUser, done: Done) => verify(profile, done)
  );
  strategy.name = 'twitch';
  strategy.userProfile = (accessToken: string, done: Done) => {
    globalThis.fetch(TWITCH_USERS_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': options.clientID },
      signal: globalThis.AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Twitch users endpoint answered HTTP ${response.status}`);
        const body = (await response.json()) as { data?: TwitchHelixUser[] };
        const user = body.data?.[0];
        if (!user?.id) throw new Error('Twitch returned no user');
        done(null, twitchProfileToUser(user));
      })
      .catch((error: unknown) => done(error));
  };
  return strategy;
}
