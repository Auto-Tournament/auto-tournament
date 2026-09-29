/**
 * Epic Games sign-in: OpenID Connect (authorization code) against Epic Account
 * Services, then the userInfo endpoint for the account id and display name.
 * Keys on Epic's account id (`sub`). Epic gives no profile picture.
 *
 * https://dev.epicgames.com/docs/web-api-ref/authentication
 * Endpoints from https://api.epicgames.dev/epic/oauth/v2/.well-known/openid-configuration
 */
import { Strategy as OAuth2Strategy } from 'passport-oauth2';

export const EPIC_AUTHORIZE_URL = 'https://www.epicgames.com/id/authorize';
export const EPIC_TOKEN_URL = 'https://api.epicgames.dev/epic/oauth/v2/token';
export const EPIC_USERINFO_URL = 'https://api.epicgames.dev/epic/oauth/v2/userInfo';

export interface EpicStrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  store: unknown;
}

/** The userInfo answer (OIDC claims). */
export interface EpicUserInfo {
  sub: string;
  preferred_username?: string;
}

export interface EpicUser {
  provider: 'epic';
  epicId: string;
  username?: string;
  displayName: string;
}

/** The Passport user for an Epic login. No tokens: nothing uses them. */
export function epicProfileToUser(info: EpicUserInfo): EpicUser {
  return {
    provider: 'epic',
    epicId: String(info.sub),
    username: info.preferred_username,
    displayName: info.preferred_username || String(info.sub),
  };
}

type Done = (err: unknown, user?: unknown) => void;

export function createEpicStrategy(
  options: EpicStrategyOptions,
  verify: (user: EpicUser, done: Done) => void
): unknown {
  // Epic authenticates the client on the token endpoint with HTTP Basic.
  const basic = Buffer.from(`${options.clientID}:${options.clientSecret}`).toString('base64');
  const strategy = new OAuth2Strategy(
    {
      authorizationURL: EPIC_AUTHORIZE_URL,
      tokenURL: EPIC_TOKEN_URL,
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      scope: ['basic_profile'],
      customHeaders: { Authorization: `Basic ${basic}` },
      store: options.store,
    },
    (_accessToken: string, _refreshToken: string, profile: EpicUser, done: Done) => verify(profile, done)
  );
  strategy.name = 'epic';
  strategy.userProfile = (accessToken: string, done: Done) => {
    globalThis
      .fetch(EPIC_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: globalThis.AbortSignal.timeout(10_000),
      })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Epic userInfo answered HTTP ${response.status}`);
        const info = (await response.json()) as EpicUserInfo;
        if (!info?.sub) throw new Error('Epic returned no account id');
        done(null, epicProfileToUser(info));
      })
      .catch((error: unknown) => done(error));
  };
  return strategy;
}
