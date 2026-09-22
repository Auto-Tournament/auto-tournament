import { test, expect } from '@playwright/test';
import {
  ensureSignedIn,
  signInViaRequest,
  signInAsPlayerViaRequest,
  impersonatePlayer,
  stopImpersonating,
  DEFAULT_ADMIN_STEAM_ID,
} from '../helpers/auth';
import { createTestTeams, deleteTeam, type Team } from '../helpers/teams';

/**
 * Admin impersonation API tests
 *
 * Impersonation lets an admin act as a specific player so player-only flows
 * (veto above all) can be exercised without that player's Steam credentials.
 *
 * The security contract these tests pin down:
 *  - only admins can start it, and never against another admin
 *  - the admin keeps their own admin rights while impersonating, so they can
 *    always stop
 *  - the cookie is inert for anyone who is not a verified admin
 *
 * @tag api
 * @tag auth
 * @tag impersonation
 */

test.describe.serial('Admin impersonation API', () => {
  let teams: [Team, Team];
  let playerSteamId: string;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);

    const created = await createTestTeams(request, 'impersonation');
    expect(created).toBeTruthy();
    teams = created!;
    playerSteamId = teams[0].players[0].steamId;
  });

  test.afterEach(async ({ request }) => {
    await stopImpersonating(request);
    // Delete BOTH teams: a leaked roster is picked up by `ensureTeams` in other
    // specs and can produce a match whose two teams share players, which the
    // veto API (correctly) treats as ambiguous and rejects.
    for (const team of teams ?? []) {
      await deleteTeam(request, team.id);
    }
  });

  test(
    'should switch the effective identity and restore it on stop',
    { tag: ['@api', '@auth', '@impersonation'] },
    async ({ request }) => {
      const before = await (await request.get('/api/auth/me')).json();
      expect(before.steamId).toBe(DEFAULT_ADMIN_STEAM_ID);
      expect(before.impersonation.active).toBe(false);

      expect(await impersonatePlayer(request, playerSteamId)).toBe(true);

      const during = await (await request.get('/api/auth/me')).json();
      expect(during.steamId).toBe(playerSteamId);
      expect(during.impersonation.active).toBe(true);
      expect(during.impersonation.realSteamId).toBe(DEFAULT_ADMIN_STEAM_ID);

      expect(await stopImpersonating(request)).toBe(true);

      const after = await (await request.get('/api/auth/me')).json();
      expect(after.steamId).toBe(DEFAULT_ADMIN_STEAM_ID);
      expect(after.impersonation.active).toBe(false);
    }
  );

  test(
    'should keep the admin their own admin rights while impersonating',
    { tag: ['@api', '@auth', '@impersonation'] },
    async ({ request }) => {
      expect(await impersonatePlayer(request, playerSteamId)).toBe(true);

      // Admin identity is resolved from the real session, not the impersonation
      // cookie — otherwise an admin could lock themselves out of stopping.
      const adminMe = await (await request.get('/api/auth/admin/me')).json();
      expect(adminMe.authenticated).toBe(true);
      expect(adminMe.steamId).toBe(DEFAULT_ADMIN_STEAM_ID);

      // An admin-guarded endpoint still works while impersonating.
      const teamsResponse = await request.get('/api/teams');
      expect(teamsResponse.ok()).toBe(true);

      // And the impersonation state endpoint reports the target.
      const state = await (await request.get('/api/auth/impersonate')).json();
      expect(state.active).toBe(true);
      expect(state.steamId).toBe(playerSteamId);
    }
  );

  test(
    'should reject impersonating an admin, an unknown player, or a malformed id',
    { tag: ['@api', '@auth', '@impersonation', '@security'] },
    async ({ request }) => {
      // Another admin is off-limits: impersonation must not launder admin identity.
      const adminTarget = await request.post('/api/auth/impersonate', {
        data: { steamId: DEFAULT_ADMIN_STEAM_ID },
      });
      // Impersonating yourself is a 400; a *different* admin is a 403. The test
      // admin is the caller, so assert the self-case explicitly below and use a
      // second admin for the 403 case.
      expect(adminTarget.status()).toBe(400);

      const secondAdmin = '76561198000000009';
      await request.post('/api/test/login-admin', { data: { steamId: secondAdmin } });
      // Re-establish our own admin session (login-admin switched it).
      await signInViaRequest(request);

      const otherAdmin = await request.post('/api/auth/impersonate', {
        data: { steamId: secondAdmin },
      });
      expect(otherAdmin.status()).toBe(403);
      expect((await otherAdmin.json()).error).toContain('cannot impersonate other admins');

      const unknown = await request.post('/api/auth/impersonate', {
        data: { steamId: '76561199999999999' },
      });
      expect(unknown.status()).toBe(404);

      const malformed = await request.post('/api/auth/impersonate', {
        data: { steamId: 'not-a-steam-id' },
      });
      expect(malformed.status()).toBe(400);
    }
  );

  test(
    'should refuse impersonation for non-admins',
    { tag: ['@api', '@auth', '@impersonation', '@security'] },
    async ({ playwright, baseURL }) => {
      const playerContext = await playwright.request.newContext({ baseURL });

      try {
        // A signed-in but non-admin player.
        expect(await signInAsPlayerViaRequest(playerContext)).toBe(true);

        const response = await playerContext.post('/api/auth/impersonate', {
          data: { steamId: playerSteamId },
        });
        expect(response.status()).toBe(403);
      } finally {
        await playerContext.dispose();
      }

      // And an anonymous caller gets 401.
      const anonContext = await playwright.request.newContext({ baseURL });
      try {
        const response = await anonContext.post('/api/auth/impersonate', {
          data: { steamId: playerSteamId },
        });
        expect(response.status()).toBe(401);
      } finally {
        await anonContext.dispose();
      }
    }
  );

  test(
    'should ignore a stolen impersonation cookie held by a non-admin',
    { tag: ['@api', '@auth', '@impersonation', '@security'] },
    async ({ request, playwright, baseURL }) => {
      // Mint a genuine impersonation cookie as the admin.
      expect(await impersonatePlayer(request, playerSteamId)).toBe(true);

      const { cookies } = await request.storageState();
      const stolen = cookies.find((cookie) => cookie.name === 'mat_impersonate');
      expect(stolen, 'admin should have an impersonation cookie').toBeTruthy();

      // Replay it in a session belonging to a normal player.
      const victimContext = await playwright.request.newContext({ baseURL });
      try {
        expect(await signInAsPlayerViaRequest(victimContext)).toBe(true);

        const victimState = await victimContext.storageState();
        const withStolenCookie = await playwright.request.newContext({
          baseURL,
          storageState: {
            ...victimState,
            cookies: [...victimState.cookies, stolen!],
          },
        });

        try {
          const me = await (await withStolenCookie.get('/api/auth/me')).json();

          // The cookie signature is valid, but the requester is not an admin, so
          // it must be ignored entirely.
          expect(me.steamId).not.toBe(playerSteamId);
          expect(me.impersonation.active).toBe(false);
        } finally {
          await withStolenCookie.dispose();
        }
      } finally {
        await victimContext.dispose();
      }
    }
  );
});
