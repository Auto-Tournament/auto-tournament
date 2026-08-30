import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { signInViaRequest } from '../helpers/auth';

/**
 * Why admin access was refused.
 *
 * `/api/auth/admin/me` used to answer a bare `{ authenticated: false }`, and
 * the client then redirected to the player profile without a word. Three quite
 * different situations — nobody signed in, a Steam ID with no player row, and a
 * player who simply is not an admin — were indistinguishable from outside.
 *
 * That is why the reports of "it sends me to my player page even though
 * is_admin = 1" were never diagnosable: there was nothing for the affected user
 * to collect or repeat back. The reason now travels with the response and the
 * UI shows it.
 *
 * @tag api
 * @tag auth
 * @tag regression
 */

async function adminMe(request: APIRequestContext) {
  const res = await request.get('/api/auth/admin/me');
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    authenticated: boolean;
    reason?: string;
    message?: string;
  };
}

test.describe.serial('Admin denial reasons', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'an admin is still just authenticated, with no leftover reason',
    { tag: ['@api', '@auth'] },
    async ({ request }) => {
      const body = await adminMe(request);
      expect(body.authenticated).toBe(true);
      // A stale explanation on a successful check would be worse than none.
      expect(body.reason).toBeUndefined();
    }
  );

  test(
    'says so when nobody is signed in',
    { tag: ['@api', '@auth', '@regression'] },
    async ({ playwright }) => {
      // A context with no cookies at all.
      const anon = await playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
      });
      try {
        const body = await adminMe(anon);
        expect(body.authenticated).toBe(false);
        expect(body.reason).toBe('not_signed_in');
        expect(body.message).toBeTruthy();
      } finally {
        await anon.dispose();
      }
    }
  );

  test(
    'names the account when it is signed in but not an admin',
    { tag: ['@api', '@auth', '@regression'] },
    async ({ playwright, request }) => {
      const playerSteamId = '76561198000000077';

      // Create the player as an admin, then demote — leaves a real player row
      // that is not an admin, which is the interesting case.
      const ctx = await playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
      });
      try {
        expect(await signInViaRequest(ctx, playerSteamId)).toBe(true);

        const demote = await request.put(`/api/players/${playerSteamId}`, {
          data: { isAdmin: false },
        });
        expect(demote.ok(), `demote failed: ${await demote.text()}`).toBe(true);

        const body = await adminMe(ctx);
        expect(body.authenticated).toBe(false);
        expect(body.reason).toBe('not_admin');
        // The Steam ID is the thing a confused user can actually check against
        // the players table.
        expect(body.message).toContain(playerSteamId);
      } finally {
        await ctx.dispose();
      }
    }
  );
});
