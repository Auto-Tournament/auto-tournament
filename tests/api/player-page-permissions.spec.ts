import { test, expect } from '@playwright/test';
import { signInViaRequest, signInAsPlayer, getAuthHeader } from '../helpers/auth';
import { createPlayer } from '../helpers/players';

/**
 * Non-admin pages must not call admin-only endpoints.
 *
 * Reported repeatedly on Discord: an ordinary player opening their profile got
 * "Failed to load allocation status for Player page: Error: Forbidden - Admin
 * access required" in the console, because the page polled
 * /api/tournament/server-availability, which is admin-only.
 *
 * That has since been addressed by splitting out a public
 * /api/tournament/allocation-status carrying only the countdown fields. This
 * test pins that down: it drives the pages a non-admin can actually reach and
 * fails if any request comes back 401 or 403.
 *
 * @tag api
 * @tag permissions
 * @tag players
 */

const PLAYER_STEAM_ID = '76561198000000902';

test.describe.serial('Non-admin page permissions', () => {
  test(
    'should not hit admin-only endpoints from a player profile page',
    { tag: ['@api', '@permissions', '@players'] },
    async ({ page, request }) => {
      // Seed the player as admin, then drop to that player's own session.
      await signInViaRequest(request);
      const player = await createPlayer(request, {
        id: PLAYER_STEAM_ID,
        name: 'Permission Probe',
        initialELO: 1500,
      });
      expect(player, 'seed player should be created').toBeTruthy();

      const signedIn = await signInAsPlayer(page, PLAYER_STEAM_ID);
      expect(signedIn, 'player sign-in should succeed').toBe(true);

      const denied: string[] = [];
      page.on('response', (response) => {
        const status = response.status();
        if (status === 401 || status === 403) {
          denied.push(`${status} ${response.request().method()} ${new URL(response.url()).pathname}`);
        }
      });

      await page.goto(`/player/${PLAYER_STEAM_ID}`);
      await expect(page.getByTestId('public-player-page')).toBeVisible();

      // The allocation poll runs on an interval; give the first pass time to
      // land rather than asserting on an empty network log.
      await page.waitForLoadState('networkidle');

      expect(
        denied,
        'a player viewing their own profile should not be refused any request'
      ).toEqual([]);
    }
  );

  test(
    'should serve allocation status without an admin session',
    { tag: ['@api', '@permissions'] },
    async ({ request }) => {
      // No auth header at all: this endpoint exists precisely so the player
      // page does not need one.
      const response = await request.get('/api/tournament/allocation-status');
      expect(response.status(), 'allocation-status should be public').toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(typeof body.availableServerCount).toBe('number');

      // The admin-only endpoint it was split out of must stay admin-only.
      const adminOnly = await request.get('/api/tournament/server-availability', {
        headers: { Authorization: '' },
      });
      expect(
        [401, 403],
        'server-availability should still require an admin session'
      ).toContain(adminOnly.status());
    }
  );
});
