import { test, expect, request as playwrightRequest, type APIResponse } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * OAuth `state` (login CSRF) and logout cookie behaviour, end to end.
 *
 * The provider tests need the strategy registered, i.e. the API started with
 * client credentials for that provider (fake values are fine: nothing here
 * talks to the provider). CI's e2e stack does not configure any SSO provider,
 * so those tests skip themselves there. To run them locally, start the API with
 * e.g. DISCORD_CLIENT_ID=123456789012345678 DISCORD_CLIENT_SECRET=fake
 * GITHUB_CLIENT_ID=Iv1.fake GITHUB_CLIENT_SECRET=fake GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake
 * KEYCLOAK_ISSUER_URL=https://sso.invalid/realms/test KEYCLOAK_CLIENT_ID=auto-tournament.
 *
 * @tag api
 * @tag auth
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

function setCookies(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
}

function isCleared(cookie: string): boolean {
  return /expires=thu, 01 jan 1970/i.test(cookie) || /max-age=0\b/i.test(cookie);
}

const providers = [
  { id: 'discord', authorizeHost: 'discord.com' },
  { id: 'github', authorizeHost: 'github.com' },
  { id: 'google', authorizeHost: 'accounts.google.com' },
  { id: 'keycloak', authorizeHost: 'sso.invalid' },
] as const;

for (const provider of providers) {
  test.describe(`${provider.id} OAuth state`, () => {
    test(`start redirect carries state and sets the state cookie`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const res = await ctx.get(`/api/auth/${provider.id}`, { maxRedirects: 0 });
        test.skip(
          res.status() !== 302,
          `${provider.id} strategy is not configured on this API (status ${res.status()})`
        );

        const location = res.headers()['location'] ?? '';
        expect(location).toContain(provider.authorizeHost);
        const state = new URL(location).searchParams.get('state');
        expect(state).toBeTruthy();

        const stateCookie = setCookies(res).find((c) =>
          c.startsWith(`oauth_state_${provider.id}=`)
        );
        expect(stateCookie).toBeTruthy();
        expect(stateCookie!).toMatch(/httponly/i);
        expect(stateCookie!).toMatch(/samesite=lax/i);
        expect(stateCookie!).toMatch(new RegExp(`path=/api/auth/${provider.id}/callback`, 'i'));
        // The cookie's nonce is the state that went to the provider.
        const cookieValue = decodeURIComponent(stateCookie!.split(';')[0].split('=')[1]);
        expect(cookieValue.split('.')[0]).toBe(state);
      } finally {
        await ctx.dispose();
      }
    });

    test(`callback rejects a missing or forged state before any code exchange`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const start = await ctx.get(`/api/auth/${provider.id}`, { maxRedirects: 0 });
        test.skip(
          start.status() !== 302,
          `${provider.id} strategy is not configured on this API (status ${start.status()})`
        );

        const callback = `/api/auth/${provider.id}/callback`;
        const attempts = [
          // State cookie present (from the start above), but the state is not ours.
          `${callback}?code=attacker-code&state=forged-state`,
          // State cookie was consumed by the previous attempt; no state at all.
          `${callback}?code=attacker-code`,
        ];

        for (const url of attempts) {
          const res = await ctx.get(url, { maxRedirects: 0 });
          // A failed state check is a Passport `fail` → failureRedirect. A code
          // exchange against the (fake) provider would instead surface as a 500.
          expect(res.status(), url).toBe(302);
          expect(res.headers()['location'], url).toBe('/login');
          const cookies = setCookies(res);
          expect(
            cookies.some((c) => c.startsWith('player_steam_id=') && !isCleared(c)),
            url
          ).toBe(false);
          expect(cookies.some((c) => c.startsWith('pending_steam_link=')), url).toBe(false);
        }

        // A fresh browser with no state cookie, holding a valid-looking state.
        const victim = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const location = start.headers()['location'] ?? '';
          const attackerState = new URL(location).searchParams.get('state');
          const res = await victim.get(
            `${callback}?code=attacker-code&state=${encodeURIComponent(attackerState ?? '')}`,
            { maxRedirects: 0 }
          );
          expect(res.status()).toBe(302);
          expect(res.headers()['location']).toBe('/login');
          expect(setCookies(res).some((c) => c.startsWith('player_steam_id='))).toBe(false);
        } finally {
          await victim.dispose();
        }
      } finally {
        await ctx.dispose();
      }
    });
  });
}

test.describe('Logout clears identity cookies', () => {
  for (const route of ['/api/auth/admin/logout', '/api/auth/logout']) {
    test(`${route} clears player_steam_id so the jar is no longer admin`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInViaRequest(ctx)).toBe(true);
        const before = await (await ctx.get('/api/auth/admin/me')).json();
        expect(before.authenticated).toBe(true);

        const res = await ctx.post(route);
        expect(res.status()).toBe(204);

        const cookies = setCookies(res);
        for (const name of ['player_steam_id', 'pending_steam_link', 'mat_impersonate']) {
          const cleared = cookies.find((c) => c.startsWith(`${name}=`));
          expect(cleared, name).toBeTruthy();
          expect(isCleared(cleared!), name).toBe(true);
          expect(cleared!, name).toMatch(/path=\//i);
        }

        // For /api/auth/logout the Passport session survives on purpose (the
        // client calls both routes), so only check admin status after the
        // admin logout, or after both.
        if (route === '/api/auth/logout') {
          await ctx.post('/api/auth/admin/logout');
        }
        const after = await (await ctx.get('/api/auth/admin/me')).json();
        expect(after.authenticated).toBe(false);
      } finally {
        await ctx.dispose();
      }
    });
  }
});
