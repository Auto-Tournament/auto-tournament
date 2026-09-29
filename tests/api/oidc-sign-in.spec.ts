import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  checkDiscovery,
  createOidcStrategy,
  oidcUserInfoToUser,
  type OidcDiscovery,
} from '../../api/src/config/oidcStrategy';
import {
  normalizeIssuerUrl,
  parseProviderPatch,
  resolveProviderSettings,
  signInProviderDefinition,
} from '../../api/src/config/signInProviders';
import { signInViaRequest } from '../helpers/auth';

/**
 * Sign-in with any OpenID Connect server (config/oidcStrategy.ts), set up on
 * Settings -> Sign-in with an issuer URL, a client id and secret, and a
 * button name.
 *
 *  - Pure: issuer URL rules, discovery document checks, the claims -> user
 *    mapping, PUT validation, "configured" needing the issuer.
 *  - Strategy: discovery runs once, on first use, and points the redirect at
 *    the discovered authorization endpoint; a failed discovery is retried.
 *  - API: configured against the app's own fake issuer (/api/test/oidc), the
 *    login page lists the button under the admin's name and /api/auth/oidc
 *    redirects to the discovered endpoint with state.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };
const DEF = signInProviderDefinition('oidc');

test.describe('OpenID Connect: pure rules', () => {
  test('issuer URLs: http(s), no query, fragment or credentials, no trailing slash', TAGS, () => {
    expect(normalizeIssuerUrl('https://sso.example.com/realms/lan/')).toBe('https://sso.example.com/realms/lan');
    expect(normalizeIssuerUrl(' http://127.0.0.1:3000/api/test/oidc ')).toBe('http://127.0.0.1:3000/api/test/oidc');
    expect(normalizeIssuerUrl('ftp://sso.example.com')).toBeNull();
    expect(normalizeIssuerUrl('https://sso.example.com/?realm=lan')).toBeNull();
    expect(normalizeIssuerUrl('https://sso.example.com/#x')).toBeNull();
    expect(normalizeIssuerUrl('https://user:pass@sso.example.com')).toBeNull();
    expect(normalizeIssuerUrl('not a url')).toBeNull();
  });

  test('a discovery document must name the configured issuer and have the endpoints', TAGS, () => {
    const issuer = 'https://sso.example.com/realms/lan';
    const doc = {
      issuer: `${issuer}/`,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
    };
    expect(checkDiscovery(issuer, doc).authorization_endpoint).toBe(`${issuer}/auth`);
    expect(() => checkDiscovery(issuer, { ...doc, issuer: 'https://sso.example.com/realms/other' })).toThrow(
      /realms\/other/
    );
    expect(() => checkDiscovery(issuer, { ...doc, userinfo_endpoint: undefined })).toThrow(/userinfo_endpoint/);
    expect(() => checkDiscovery(issuer, null)).toThrow(/\(none\)/);
  });

  test('claims to user: sub is the id; only a verified email; only an https picture', TAGS, () => {
    expect(
      oidcUserInfoToUser({
        sub: 'abc-123',
        name: 'Kari Nordmann',
        preferred_username: 'kari',
        email: 'kari@example.com',
        email_verified: true,
        picture: 'https://sso.example.com/p.png',
      })
    ).toEqual({
      provider: 'oidc',
      oidcId: 'abc-123',
      username: 'kari',
      displayName: 'Kari Nordmann',
      avatarUrl: 'https://sso.example.com/p.png',
      verifiedEmail: 'kari@example.com',
    });
    const bare = oidcUserInfoToUser({ sub: 'x', email: 'a@b.c', email_verified: false, picture: 'http://x/p.png' });
    expect(bare.displayName).toBe('x');
    expect(bare.verifiedEmail).toBeUndefined();
    expect(bare.avatarUrl).toBeUndefined();
  });

  test('PUT: issuer and button name only for OpenID Connect, validated', TAGS, () => {
    expect(parseProviderPatch(DEF, { issuerUrl: 'https://sso.example.com/realms/lan/', label: ' NTLAN ' })).toEqual({
      ok: true,
      patch: { issuerUrl: 'https://sso.example.com/realms/lan', label: 'NTLAN' },
    });
    expect(parseProviderPatch(DEF, { issuerUrl: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseProviderPatch(DEF, { label: 'x'.repeat(41) }).ok).toBe(false);
    expect(parseProviderPatch(DEF, { label: 'bad\nname' }).ok).toBe(false);
    expect(parseProviderPatch(DEF, { issuerUrl: null, label: '' })).toEqual({
      ok: true,
      patch: { issuerUrl: null, label: null },
    });
    expect(parseProviderPatch(signInProviderDefinition('discord'), { issuerUrl: 'https://x' }).ok).toBe(false);
  });

  test('configured needs the issuer as well as the client id and secret', TAGS, () => {
    const base = { enabled: true, clientId: 'at', secret: 's' };
    expect(resolveProviderSettings(DEF, base).configured).toBe(false);
    expect(resolveProviderSettings(DEF, { ...base, issuerUrl: 'https://sso.example.com' }).active).toBe(true);
  });
});

test.describe('OpenID Connect: strategy', () => {
  function fakeReq() {
    return { query: {}, session: {}, headers: {}, cookies: {}, url: '/api/auth/oidc' };
  }

  test('discovers once, redirects to the discovered endpoint, retries after a failure', TAGS, async () => {
    let calls = 0;
    let fail = true;
    const doc: OidcDiscovery = {
      issuer: 'https://sso.example.com',
      authorization_endpoint: 'https://login.example.com/auth',
      token_endpoint: 'https://login.example.com/token',
      userinfo_endpoint: 'https://login.example.com/userinfo',
    };
    const strategy = createOidcStrategy(
      {
        issuerUrl: 'https://sso.example.com',
        clientID: 'at',
        clientSecret: 's',
        callbackURL: 'https://at.example.com/api/auth/oidc/callback',
        store: { store: (_req: unknown, ...rest: unknown[]) => (rest.pop() as (e: null, s: string) => void)(null, 'st') },
      },
      () => undefined,
      async () => {
        calls++;
        if (fail) throw new Error('down');
        return doc;
      }
    ) as {
      authenticate(req: unknown, options: unknown): void;
      redirect: (url: string) => void;
      error: (err: Error) => void;
    };

    // Like Passport: a per-request copy carries redirect and error, the
    // strategy itself has neither.
    const outcome = () =>
      new Promise<{ redirect?: string; error?: string }>((resolve) => {
        const perRequest = Object.create(strategy) as typeof strategy;
        perRequest.redirect = (url) => resolve({ redirect: url });
        perRequest.error = (err) => resolve({ error: err.message });
        perRequest.authenticate(fakeReq(), {});
      });

    expect((await outcome()).error).toMatch(/discovery failed: down/);
    fail = false;
    const first = await outcome();
    expect(first.redirect).toMatch(/^https:\/\/login\.example\.com\/auth\?/);
    expect(new URL(first.redirect!).searchParams.get('scope')).toBe('openid profile email');
    await outcome();
    expect(calls).toBe(2);
  });
});

test.describe.serial('OpenID Connect: configured on Settings -> Sign-in', () => {
  const json = { 'Content-Type': 'application/json' };

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/sign-in-providers/oidc', {
      data: { enabled: false, clientId: null, clientSecret: null, issuerUrl: null, label: null },
      headers: json,
    });
  });

  test('the button carries the admin\'s name and starts at the discovered endpoint', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    // The app fetches the discovery document from itself, inside its container.
    const put = await request.put('/api/sign-in-providers/oidc', {
      data: {
        enabled: true,
        clientId: 'auto-tournament',
        clientSecret: 'e2e-oidc-secret-0123456789',
        issuerUrl: 'http://127.0.0.1:3000/api/test/oidc',
        label: 'NTLAN',
      },
      headers: json,
    });
    expect(put.status(), await put.text()).toBe(200);

    const providers = (await (await request.get('/api/auth/providers')).json()).providers as Array<{
      id: string;
      label: string;
    }>;
    expect(providers.find((p) => p.id === 'oidc')?.label).toBe('NTLAN');

    const ctx = await playwrightRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069' });
    try {
      const res = await ctx.get('/api/auth/oidc', { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      const location = new URL(res.headers()['location'] ?? '');
      expect(location.host).toBe('sso.invalid');
      expect(location.pathname).toBe('/protocol/openid-connect/auth');
      expect(location.searchParams.get('client_id')).toBe('auto-tournament');
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/oidc\/callback$/);
    } finally {
      await ctx.dispose();
    }

    const list = (await (await request.get('/api/sign-in-providers')).json()).providers as Array<{
      id: string;
      issuerUrl: string | null;
      buttonName: string | null;
      secretSet: boolean;
    }>;
    const oidc = list.find((p) => p.id === 'oidc');
    expect(oidc).toMatchObject({ issuerUrl: 'http://127.0.0.1:3000/api/test/oidc', buttonName: 'NTLAN', secretSet: true });
    expect(JSON.stringify(list)).not.toContain('e2e-oidc-secret');
  });
});
