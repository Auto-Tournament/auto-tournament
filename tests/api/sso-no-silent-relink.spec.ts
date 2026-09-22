import { test, expect, request as playwrightRequest, type APIResponse } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * A provider login (GitHub, Google, Discord, Keycloak) in a browser that is
 * already signed in with Steam links the provider identity to that account.
 * It used to do so even when the identity already belonged to a different
 * Steam account, silently moving that account's sign-in method. The rule:
 *
 *   The login path never re-points an existing auth_identities row. An
 *   identity owned by another account is refused: the row stays, the browser
 *   stays signed in as who it was, and the user lands on
 *   /me/connections?link=taken, as with the explicit Connect flow.
 *
 * Driven through the test-only fake GitHub/Google provider (routes/test.ts),
 * which runs the real strategies and the real callback handler.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };

type Ctx = Awaited<ReturnType<typeof playwrightRequest.newContext>>;

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

function randomSteamId(): string {
  return `7656119${digits(10)}`;
}

function codeFor(profile: object): string {
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
}

function setsCookie(response: APIResponse, name: string): boolean {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value)
    .some((c) => c.startsWith(`${name}=`) && !/expires=thu, 01 jan 1970/i.test(c));
}

const providers = [
  {
    id: 'github',
    profile: (id: string) => ({ id: Number(id), login: `octo${id}`, name: `Octo ${id}` }),
    newId: () => `${1 + Math.floor(Math.random() * 9)}${digits(7)}`,
  },
  {
    id: 'google',
    profile: (id: string) => ({ sub: id, name: `Gee ${id}`, email: `gee${id}@example.com` }),
    newId: () => `1${digits(20)}`,
  },
] as const;

for (const provider of providers) {
  test.describe(`${provider.id} login with a Steam session present`, () => {
    /** Run a full provider login in `ctx` for `providerUserId`. */
    async function providerLogin(ctx: Ctx, providerUserId: string): Promise<APIResponse> {
      const start = await ctx.get(`/api/test/oauth/${provider.id}`, { maxRedirects: 0 });
      test.skip(
        start.status() !== 302,
        `fake ${provider.id} provider is not available (ENABLE_TEST_ENDPOINTS off?), status ${start.status()}`
      );
      const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
      const query = new URLSearchParams({
        code: codeFor(provider.profile(providerUserId)),
        state,
      });
      return ctx.get(`/api/test/oauth/${provider.id}/callback?${query}`, { maxRedirects: 0 });
    }

    async function withAdmin<T>(run: (admin: Ctx) => Promise<T>): Promise<T> {
      const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInViaRequest(admin)).toBe(true);
        return await run(admin);
      } finally {
        await admin.dispose();
      }
    }

    function seedIdentity(providerUserId: string, steamId: string): Promise<void> {
      return withAdmin(async (admin) => {
        const res = await admin.post('/api/test/auth-identities', {
          data: { provider: provider.id, providerUserId, steamId },
        });
        expect(res.ok(), await res.text()).toBe(true);
      });
    }

    function linkedSteamIds(providerUserId: string): Promise<string[]> {
      return withAdmin(async (admin) => {
        const res = await admin.get(
          `/api/test/auth-identities?provider=${provider.id}&providerUserId=${encodeURIComponent(providerUserId)}`
        );
        expect(res.ok(), await res.text()).toBe(true);
        return ((await res.json()) as { steamIds: string[] }).steamIds;
      });
    }

    async function signedInAs(ctx: Ctx): Promise<string | null> {
      const me = (await (await ctx.get('/api/auth/me')).json()) as { steamId?: string | null };
      return me.steamId ?? null;
    }

    test(
      "an identity owned by another account is refused and left where it was",
      TAGS,
      async () => {
        const providerUserId = provider.newId();
        const ownerSteamId = randomSteamId();
        const viewerSteamId = randomSteamId();
        await seedIdentity(providerUserId, ownerSteamId);

        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          expect(await signInAsPlayerViaRequest(ctx, viewerSteamId)).toBe(true);
          const res = await providerLogin(ctx, providerUserId);

          expect(res.status()).toBe(302);
          const location = new URL(res.headers()['location'] ?? '', BASE_URL);
          expect(location.pathname).toBe('/me/connections');
          expect(location.searchParams.get('link')).toBe('taken');
          expect(location.searchParams.get('provider')).toBe(provider.id);

          // No cookie switch to the owner, no pending link to complete later.
          expect(setsCookie(res, 'player_steam_id')).toBe(false);
          expect(setsCookie(res, 'pending_steam_link')).toBe(false);

          // The row still points at its owner; the browser is still the viewer.
          expect(await linkedSteamIds(providerUserId)).toEqual([ownerSteamId]);
          expect(await signedInAs(ctx)).toBe(viewerSteamId);
        } finally {
          await ctx.dispose();
        }

        // The owner's own login through that identity still works.
        const owner = await playwrightRequest.newContext({ baseURL: BASE_URL });
        try {
          const res = await providerLogin(owner, providerUserId);
          expect(res.status()).toBe(302);
          expect(await signedInAs(owner)).toBe(ownerSteamId);
        } finally {
          await owner.dispose();
        }
      }
    );

    test('an identity already on the signed-in account is a normal login', TAGS, async () => {
      const providerUserId = provider.newId();
      const steamId = randomSteamId();
      await seedIdentity(providerUserId, steamId);

      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
        const res = await providerLogin(ctx, providerUserId);
        expect(res.status()).toBe(302);
        expect(new URL(res.headers()['location'] ?? '', BASE_URL).pathname).toBe('/');
        expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
        expect(await signedInAs(ctx)).toBe(steamId);
      } finally {
        await ctx.dispose();
      }
    });

    test('a fresh identity still links to the signed-in account', TAGS, async () => {
      const steamId = randomSteamId();
      // The account already has one identity of this provider; the login path
      // has always allowed a second, and still does.
      const existingId = provider.newId();
      await seedIdentity(existingId, steamId);
      const providerUserId = provider.newId();

      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
        const res = await providerLogin(ctx, providerUserId);
        expect(res.status()).toBe(302);
        expect(new URL(res.headers()['location'] ?? '', BASE_URL).pathname).toBe('/');
        expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
        expect(await linkedSteamIds(existingId)).toEqual([steamId]);
        expect(await signedInAs(ctx)).toBe(steamId);
      } finally {
        await ctx.dispose();
      }
    });
  });
}
