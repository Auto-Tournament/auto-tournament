/**
 * Sign-in with any OpenID Connect server (Keycloak, Authentik, Authelia,
 * Zitadel, Microsoft Entra ID, Okta, ...): the authorization code flow, with
 * the endpoints from the issuer's discovery document
 * (`<issuer>/.well-known/openid-configuration`), then the UserInfo endpoint for
 * the account. Keys on the `sub` claim.
 *
 * Discovery happens on the first sign-in after the strategy is (re)built and
 * is kept for the strategy's life: saving Settings -> Sign-in rebuilds it.
 * A failed discovery is not kept, so the next sign-in tries again.
 *
 * https://openid.net/specs/openid-connect-discovery-1_0.html
 */
import { Strategy as OAuth2Strategy } from 'passport-oauth2';

export interface OidcStrategyOptions {
  issuerUrl: string;
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  store: unknown;
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

/** The UserInfo answer (standard claims). */
export interface OidcUserInfo {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}

export interface OidcUser {
  provider: 'oidc';
  oidcId: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  /** Only when the server says it verified the address (ADMIN_EMAILS). */
  verifiedEmail?: string;
}

const TIMEOUT_MS = 10_000;

/** The Passport user for an OpenID Connect login. No tokens: nothing uses them. */
export function oidcUserInfoToUser(info: OidcUserInfo): OidcUser {
  const sub = String(info.sub);
  const picture = typeof info.picture === 'string' && /^https:\/\//.test(info.picture) ? info.picture : undefined;
  return {
    provider: 'oidc',
    oidcId: sub,
    username: info.preferred_username,
    displayName: info.name || info.preferred_username || sub,
    avatarUrl: picture,
    verifiedEmail: info.email_verified === true && info.email ? info.email : undefined,
  };
}

/**
 * Check a discovery document: the four endpoints we use, as http(s) URLs, and
 * `issuer` equal to the configured one (the spec requires it; a mismatch means
 * the URL points at the wrong realm or tenant). Throws a message an admin can act on.
 */
export function checkDiscovery(issuerUrl: string, doc: unknown): OidcDiscovery {
  const d = (doc ?? {}) as Record<string, unknown>;
  const issuer = typeof d.issuer === 'string' ? d.issuer.replace(/\/+$/, '') : '';
  if (issuer !== issuerUrl) {
    throw new Error(`The discovery document is for issuer "${issuer || '(none)'}", not ${issuerUrl}`);
  }
  const endpoint = (name: string): string => {
    const value = d[name];
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
      throw new Error(`The discovery document has no ${name}`);
    }
    return value;
  };
  return {
    issuer,
    authorization_endpoint: endpoint('authorization_endpoint'),
    token_endpoint: endpoint('token_endpoint'),
    userinfo_endpoint: endpoint('userinfo_endpoint'),
  };
}

export async function discoverOidc(issuerUrl: string): Promise<OidcDiscovery> {
  const url = `${issuerUrl}/.well-known/openid-configuration`;
  const response = await globalThis.fetch(url, {
    headers: { Accept: 'application/json' },
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return checkDiscovery(issuerUrl, await response.json());
}

type Done = (err: unknown, user?: unknown) => void;

/** passport-oauth2's internals the strategy points at the discovered endpoints. */
interface OAuth2Internals {
  _oauth2: { _authorizeUrl: string; _accessTokenUrl: string };
}

export function createOidcStrategy(
  options: OidcStrategyOptions,
  verify: (user: OidcUser, done: Done) => void,
  discover: (issuerUrl: string) => Promise<OidcDiscovery> = discoverOidc
): unknown {
  // Placeholders until discovery: passport-oauth2 wants URLs up front.
  const strategy = new OAuth2Strategy(
    {
      authorizationURL: `${options.issuerUrl}/authorize`,
      tokenURL: `${options.issuerUrl}/token`,
      clientID: options.clientID,
      clientSecret: options.clientSecret,
      callbackURL: options.callbackURL,
      scope: ['openid', 'profile', 'email'],
      store: options.store,
    },
    (_accessToken: string, _refreshToken: string, profile: OidcUser, done: Done) => verify(profile, done)
  );
  strategy.name = 'oidc';

  let discovered: Promise<OidcDiscovery> | null = null;
  const ready = (): Promise<OidcDiscovery> => {
    discovered ??= discover(options.issuerUrl).then(
      (doc) => {
        const oauth2 = (strategy as unknown as OAuth2Internals)._oauth2;
        oauth2._authorizeUrl = doc.authorization_endpoint;
        oauth2._accessTokenUrl = doc.token_endpoint;
        return doc;
      },
      (error: unknown) => {
        discovered = null;
        throw error;
      }
    );
    return discovered;
  };

  const authenticate = strategy.authenticate.bind(strategy);
  strategy.authenticate = function (this: { error(err: Error): void }, req: unknown, authOptions: unknown) {
    ready().then(
      () => authenticate(req, authOptions),
      (error: unknown) => this.error(new Error(`OpenID Connect discovery failed: ${(error as Error).message}`))
    );
  };

  strategy.userProfile = (accessToken: string, done: Done) => {
    ready()
      .then((doc) =>
        globalThis.fetch(doc.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
        })
      )
      .then(async (response) => {
        if (!response.ok) throw new Error(`UserInfo answered HTTP ${response.status}`);
        const info = (await response.json()) as OidcUserInfo;
        if (!info?.sub) throw new Error('The UserInfo answer has no sub');
        done(null, oidcUserInfoToUser(info));
      })
      .catch((error: unknown) => done(error));
  };
  return strategy;
}
