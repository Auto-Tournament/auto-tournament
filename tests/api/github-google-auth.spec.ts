import { test, expect, request as playwrightRequest, type APIResponse } from '@playwright/test';
import { getAuthProvidersConfig } from '../../api/src/config/authProviders';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * GitHub and Google sign-in.
 *
 * Three layers:
 *  - Provider listing: `getAuthProvidersConfig()` as a pure unit test (env in,
 *    list out), plus the live /api/auth/providers endpoint.
 *  - The real /api/auth/github and /api/auth/google routes. These need the API
 *    started with client credentials (fake values are fine), so they skip when
 *    the provider is not configured, like the tests in oauth-state.spec.ts.
 *  - A full login through the test-only fake provider (routes/test.ts). The
 *    API registers a `github-test` and `google-test` strategy when
 *    ENABLE_TEST_ENDPOINTS is on; they are the real strategies with the
 *    provider's token and profile endpoints pointed at the API itself. The
 *    authorization `code` is the base64url JSON of the profile the "provider"
 *    returns, so each test decides what GitHub or Google says. This covers the
 *    state check, the code exchange, profile parsing and the shared callback
 *    handler (Steam linking) without talking to github.com or google.com.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };

function setCookies(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
}

function isCleared(cookie: string): boolean {
  return /expires=thu, 01 jan 1970/i.test(cookie) || /max-age=0\b/i.test(cookie);
}

function setsCookie(response: APIResponse, name: string): boolean {
  return setCookies(response).some((c) => c.startsWith(`${name}=`) && !isCleared(c));
}

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

function randomSteamId(): string {
  return `7656119${digits(10)}`;
}

/** The authorization code the fake provider turns into this profile. */
function codeFor(profile: object): string {
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
}

const providers = [
  {
    id: 'github',
    authorizeHost: 'github.com',
    scope: 'read:user',
    // GitHub's /user response: numeric id, `login`, `name`, `avatar_url`.
    profile: (id: string) => ({
      id: Number(id),
      login: `octo${id}`,
      name: `Octo ${id}`,
      avatar_url: `https://avatars.example/${id}.png`,
    }),
    // No leading zero: GitHub ids are numbers, so the id round-trips as-is.
    newId: () => `${1 + Math.floor(Math.random() * 9)}${digits(7)}`,
  },
  {
    id: 'google',
    authorizeHost: 'accounts.google.com',
    scope: 'openid email profile',
    // Google's OIDC userinfo response, keyed by `sub`.
    profile: (id: string) => ({
      sub: id,
      name: `Gee ${id}`,
      email: `gee${id}@example.com`,
      email_verified: true,
      picture: `https://lh3.example/${id}.png`,
    }),
    newId: () => `1${digits(20)}`,
  },
] as const;

test.describe('GitHub and Google provider listing', () => {
  const KEYS = [
    'AUTH_GITHUB_ENABLED',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'AUTH_GOOGLE_ENABLED',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'AUTH_DISCORD_ENABLED',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'AUTH_KEYCLOAK_ENABLED',
  ];
  let saved: Record<string, string | undefined> = {};

  test.beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  test.afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('each enabled provider is listed with its login URL and no secret', TAGS, () => {
    process.env.AUTH_GITHUB_ENABLED = 'true';
    process.env.GITHUB_CLIENT_ID = 'gh-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-super-secret';
    process.env.AUTH_GOOGLE_ENABLED = 'yes';
    process.env.GOOGLE_CLIENT_ID = 'g-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'g-super-secret';

    const list = getAuthProvidersConfig();
    expect(list.find((p) => p.id === 'github')).toEqual({
      id: 'github',
      kind: 'oauth2',
      label: 'GitHub',
      loginUrl: '/api/auth/github',
      enabled: true,
    });
    expect(list.find((p) => p.id === 'google')).toEqual({
      id: 'google',
      kind: 'oauth2',
      label: 'Google',
      loginUrl: '/api/auth/google',
      enabled: true,
    });

    const json = JSON.stringify(list);
    expect(json).not.toContain('super-secret');
    expect(json).not.toContain('client-id');
  });

  test('a provider is not listed unless enabled and fully configured', TAGS, () => {
    // Credentials but no enable flag.
    process.env.GITHUB_CLIENT_ID = 'gh-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    // Enabled, but the secret is missing: the strategy would not be registered,
    // so a button would only lead to an error.
    process.env.AUTH_GOOGLE_ENABLED = 'true';
    process.env.GOOGLE_CLIENT_ID = 'g-client-id';
    // Explicitly off.
    process.env.AUTH_DISCORD_ENABLED = 'false';
    process.env.DISCORD_CLIENT_ID = '123456789012345678';
    process.env.DISCORD_CLIENT_SECRET = 'd-secret';

    const ids = getAuthProvidersConfig().map((p) => p.id);
    expect(ids).not.toContain('github');
    expect(ids).not.toContain('google');
    expect(ids).not.toContain('discord');
  });

  test('/api/auth/providers lists GitHub and Google the same way', TAGS, async ({ request }) => {
    const res = await request.get('/api/auth/providers');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      providers: Array<Record<string, unknown> & { id: string }>;
    };
    for (const provider of body.providers) {
      if (provider.id === 'github' || provider.id === 'google') {
        expect(provider.loginUrl).toBe(`/api/auth/${provider.id}`);
        expect(provider.enabled).toBe(true);
      }
      expect(Object.keys(provider).some((k) => /secret/i.test(k))).toBe(false);
    }
  });
});

for (const provider of providers) {
  test.describe(`${provider.id} sign-in`, () => {
    test('real start route redirects to the provider with minimal scope', TAGS, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const res = await ctx.get(`/api/auth/${provider.id}`, { maxRedirects: 0 });
        test.skip(
          res.status() !== 302,
          `${provider.id} is not configured on this API (status ${res.status()})`
        );
        const location = new URL(res.headers()['location'] ?? '');
        expect(location.host).toContain(provider.authorizeHost);
        expect(location.searchParams.get('scope')).toBe(provider.scope);
        expect(location.searchParams.get('redirect_uri')).toMatch(
          new RegExp(`/api/auth/${provider.id}/callback$`)
        );
        expect(location.searchParams.get('state')).toBeTruthy();
        expect(setsCookie(res, `oauth_state_${provider.id}`)).toBe(true);
      } finally {
        await ctx.dispose();
      }
    });

    test.describe('through the fake provider', () => {
      /**
       * Start a login in `ctx` and return the state the provider was sent.
       * Skips the test when the fake provider is not available on this API.
       */
      async function start(ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>) {
        const res = await ctx.get(`/api/test/oauth/${provider.id}`, { maxRedirects: 0 });
        test.skip(
          res.status() !== 302,
          `fake ${provider.id} provider is not available (ENABLE_TEST_ENDPOINTS off?), status ${res.status()}`
        );
        const location = new URL(res.headers()['location'] ?? '');
        return { res, location, state: location.searchParams.get('state') ?? '' };
      }

      function callback(
        ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
        code: string,
        state: string
      ) {
        const query = new URLSearchParams({ code, state });
        return ctx.get(`/api/test/oauth/${provider.id}/callback?${query}`, { maxRedirects: 0 });
      }

      async function linkedSteamIds(providerUserId: string): Promise<string[]> {
        const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          expect(await signInViaRequest(admin)).toBe(true);
          const res = await admin.get(
            `/api/test/auth-identities?provider=${provider.id}&providerUserId=${encodeURIComponent(providerUserId)}`
          );
          expect(res.ok(), await res.text()).toBe(true);
          return ((await res.json()) as { steamIds: string[] }).steamIds;
        } finally {
          await admin.dispose();
        }
      }

      test('start sets a state cookie scoped to the callback', TAGS, async () => {
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { res, location, state } = await start(ctx);
          expect(location.pathname).toBe(`/api/test/fake-oauth/${provider.id}/authorize`);
          expect(location.searchParams.get('scope')).toBe(provider.scope);
          expect(state).toBeTruthy();

          const cookie = setCookies(res).find((c) =>
            c.startsWith(`oauth_state_${provider.id}-test=`)
          );
          expect(cookie).toBeTruthy();
          expect(cookie!).toMatch(/httponly/i);
          expect(cookie!).toMatch(/samesite=lax/i);
          expect(cookie!).toMatch(
            new RegExp(`path=/api/test/oauth/${provider.id}/callback`, 'i')
          );
          expect(decodeURIComponent(cookie!.split(';')[0].split('=')[1]).split('.')[0]).toBe(
            state
          );
        } finally {
          await ctx.dispose();
        }
      });

      test('callback rejects a forged or missing state', TAGS, async () => {
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(ctx);
          const code = codeFor(provider.profile(provider.newId()));

          const forged = await callback(ctx, code, 'forged-state');
          expect(forged.status()).toBe(302);
          expect(forged.headers()['location']).toBe('/login');
          expect(setsCookie(forged, 'player_steam_id')).toBe(false);
          expect(setsCookie(forged, 'pending_steam_link')).toBe(false);

          // The forged attempt consumed the state cookie, so even the real
          // state no longer works in this browser.
          const replay = await callback(ctx, code, state);
          expect(replay.status()).toBe(302);
          expect(replay.headers()['location']).toBe('/login');
          expect(setsCookie(replay, 'player_steam_id')).toBe(false);
        } finally {
          await ctx.dispose();
        }
      });

      test('a state from another browser is rejected', TAGS, async () => {
        const attacker = await playwrightRequest.newContext({ baseURL: BASE_URL });
        const victim = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(attacker);
          const res = await callback(victim, codeFor(provider.profile(provider.newId())), state);
          expect(res.status()).toBe(302);
          expect(res.headers()['location']).toBe('/login');
          expect(setsCookie(res, 'player_steam_id')).toBe(false);
          expect(setsCookie(res, 'pending_steam_link')).toBe(false);
        } finally {
          await attacker.dispose();
          await victim.dispose();
        }
      });

      test('a failed code exchange signs nobody in', TAGS, async () => {
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(ctx);
          const res = await callback(ctx, 'fail-bogus-code', state);
          expect(res.status()).toBeGreaterThanOrEqual(400);
          expect(setsCookie(res, 'player_steam_id')).toBe(false);
          expect(setsCookie(res, 'pending_steam_link')).toBe(false);
        } finally {
          await ctx.dispose();
        }
      });

      test('an unlinked account is sent to connect Steam, then linked', TAGS, async () => {
        const providerUserId = provider.newId();
        const steamId = randomSteamId();
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(ctx);
          const res = await callback(ctx, codeFor(provider.profile(providerUserId)), state);
          expect(res.status()).toBe(302);
          expect(res.headers()['location']).toMatch(/\/connect-steam$/);
          expect(setsCookie(res, 'pending_steam_link')).toBe(true);
          expect(setsCookie(res, 'player_steam_id')).toBe(false);
          expect(await linkedSteamIds(providerUserId)).toEqual([]);

          // Steam then proves an account. The test helper runs the Steam
          // callback's linking step against this browser's cookies.
          expect(await signInViaRequest(ctx)).toBe(true);
          const done = await ctx.post('/api/test/complete-steam-link', { data: { steamId } });
          expect(done.ok(), await done.text()).toBe(true);
          const result = (await done.json()) as {
            linked: boolean;
            link: { provider: string; providerUserId: string } | null;
          };
          expect(result.linked).toBe(true);
          expect(result.link).toEqual({ provider: provider.id, providerUserId });
          expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
        } finally {
          await ctx.dispose();
        }
      });

      test('a linked account signs in as its Steam ID', TAGS, async () => {
        const providerUserId = provider.newId();
        const steamId = randomSteamId();

        const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          expect(await signInViaRequest(admin)).toBe(true);
          const seed = await admin.post('/api/test/auth-identities', {
            data: { provider: provider.id, providerUserId, steamId },
          });
          expect(seed.ok(), await seed.text()).toBe(true);
        } finally {
          await admin.dispose();
        }

        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(ctx);
          const res = await callback(ctx, codeFor(provider.profile(providerUserId)), state);
          expect(res.status()).toBe(302);
          expect(new URL(res.headers()['location'] ?? '').pathname).toBe('/');
          expect(setsCookie(res, 'player_steam_id')).toBe(true);
          expect(setsCookie(res, 'pending_steam_link')).toBe(false);

          const me = await (await ctx.get('/api/auth/me')).json();
          expect(me.authenticated).toBe(true);
          expect(me.steamId).toBe(steamId);

          // The seeded player is not an admin, and a GitHub/Google login does
          // not change that: admin follows the Steam ID's player record.
          const adminMe = await (await ctx.get('/api/auth/admin/me')).json();
          expect(adminMe.authenticated).toBe(false);
          expect(adminMe.reason).toBe('not_admin');
        } finally {
          await ctx.dispose();
        }
      });

      test('an account linked to an admin gets admin access', TAGS, async () => {
        const providerUserId = provider.newId();
        const steamId = randomSteamId();

        const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          // login-admin makes this Steam ID an admin player.
          expect(await signInViaRequest(admin, steamId)).toBe(true);
          const seed = await admin.post('/api/test/auth-identities', {
            data: { provider: provider.id, providerUserId, steamId },
          });
          expect(seed.ok(), await seed.text()).toBe(true);
        } finally {
          await admin.dispose();
        }

        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const { state } = await start(ctx);
          const res = await callback(ctx, codeFor(provider.profile(providerUserId)), state);
          expect(res.status()).toBe(302);

          const adminMe = await (await ctx.get('/api/auth/admin/me')).json();
          expect(adminMe.authenticated).toBe(true);
          expect(adminMe.steamId).toBe(steamId);
        } finally {
          await ctx.dispose();
        }
      });

      test('a login in a browser already signed in with Steam links to it', TAGS, async () => {
        const providerUserId = provider.newId();
        const steamId = randomSteamId();
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
          const { state } = await start(ctx);
          const res = await callback(ctx, codeFor(provider.profile(providerUserId)), state);
          expect(res.status()).toBe(302);
          expect(new URL(res.headers()['location'] ?? '').pathname).toBe('/');
          expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
        } finally {
          await ctx.dispose();
        }
      });
    });
  });
}
