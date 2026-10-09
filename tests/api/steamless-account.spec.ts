import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * An account a sign-in method made on its own (acc_*, here OpenID Connect
 * with self-registration on) has no Steam: the connections page must say so
 * and offer to connect it, not show its id as a Steam ID.
 */

const TAGS = { tag: ['@api'] };
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const codeFor = (profile: object) =>
  Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');

test.describe.serial('an account without Steam', () => {
  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings', { data: { allowSelfRegister: false } });
  });

  test('shows Steam as not connected, and can connect it', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect((await request.put('/api/settings', { data: { allowSelfRegister: true } })).ok()).toBe(
      true
    );

    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const start = await ctx.get('/api/test/oauth/oidc', { maxRedirects: 0 });
      test.skip(
        start.status() !== 302,
        `fake OpenID Connect provider not available (${start.status()})`
      );
      const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
      const sub = `steamless-${Date.now()}`;
      const query = new URLSearchParams({ code: codeFor({ sub, name: 'No Steam Yet' }), state });
      expect(
        (await ctx.get(`/api/test/oauth/oidc/callback?${query}`, { maxRedirects: 0 })).status()
      ).toBe(302);

      const res = await ctx.get('/api/me/connections');
      expect(res.ok(), await res.text()).toBe(true);
      const body = (await res.json()) as {
        account: { steamId: string };
        signInMethods: Array<{
          provider: string;
          linked: boolean;
          primary?: boolean;
          canConnect?: boolean;
        }>;
        gameAccounts: Array<{
          linked: boolean;
          verified?: boolean;
          externalId: string | null;
          canConnect?: boolean;
        }>;
      };
      expect(body.account.steamId).toMatch(/^acc_/);
      const steam = body.signInMethods.find((m) => m.provider === 'steam');
      expect(steam).toMatchObject({ linked: false, primary: false });
      for (const game of body.gameAccounts) {
        expect(game.externalId ?? '').not.toMatch(/^acc_/);
      }
    } finally {
      await ctx.dispose();
    }
  });
});
