import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * The admin shell shows the chrome of the game the tournament runs, and no
 * other game's (3.0 phase E).
 *
 * Until now the admin nav, the manage rail, the admin home's link grid and its
 * fleet card were asked of the instance, which meant CS2 — so an instance
 * running Rocket League through manual reporting still listed Servers and
 * Maps, and still offered a server card on pages where a server can never
 * exist. That is the CS2-shaped UI phase C was supposed to have taken out.
 *
 * The pages themselves stay mounted, which this pins too: the *links* follow
 * the game, but a bookmark to /servers still opens the page.
 *
 * @tag ui
 * @tag manual-report
 */

const MR = '/api/test/integration/manual-report';

/** The two teams a tournament needs before it can be created. */
async function createTeams(admin: APIRequestContext, count: number): Promise<string[]> {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = `chrome-${stamp}-${index}`;
    const res = await admin.post('/api/teams', {
      data: {
        id,
        name: `Chrome ${stamp} ${index}`,
        players: [{ steamId: `76561199${stamp}${index}0`, name: `Chrome ${index}` }],
      },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    ids.push(id);
  }
  return ids;
}

test.describe.serial('The shell follows the tournament game', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test(
    'a Rocket League tournament hides every CS2 page, card and rail item',
    { tag: ['@ui', '@manual-report'] },
    async ({ page, request }) => {
      const teamIds = await createTeams(request, 2);
      const created = await request.post(`${MR}/tournament`, {
        data: {
          name: 'Rocket League night',
          type: 'single_elimination',
          format: 'bo1',
          game: 'rocket-league',
          teamIds,
          settings: { manualReport: { confirmation: 'opponent', confirmTimeoutMin: 60 } },
        },
      });
      expect(created.status(), `creating: ${await created.text()}`).toBe(200);

      // Admin home: no Servers link in the site grid, no fleet card. The
      // Settings link is there to prove the grid itself rendered — an empty
      // page would pass the two negatives on its own.
      await page.goto('/');
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('admin-home-site-grid')).toBeVisible();
      await expect(page.getByTestId('admin-home-site-link-settings')).toBeVisible();
      await expect(page.getByTestId('admin-home-site-link-servers')).toHaveCount(0);
      await expect(page.getByTestId('admin-home-site-link-maps')).toHaveCount(0);
      await expect(page.getByTestId('admin-home-servers-card')).toHaveCount(0);

      // Nothing on the page links to CS2's pages (the top bar included).
      await expect(page.locator('a[href="/servers"]')).toHaveCount(0);
      await expect(page.locator('a[href="/maps"]')).toHaveCount(0);

      // Manage: no server grid under the queue, no Servers or Maps in the rail.
      await page.goto('/manage');
      await expect(page.getByTestId('manage-rail')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('manage-rail-matches')).toBeVisible();
      await expect(page.getByTestId('manage-rail-servers')).toHaveCount(0);
      await expect(page.getByTestId('manage-rail-maps')).toHaveCount(0);
      // A game with no pages of its own leaves the rail's game group out; a
      // result that can be argued about brings Disputes in.
      await expect(page.getByTestId('manage-rail-group-game')).toHaveCount(0);
      await expect(page.getByTestId('manage-rail-disputes')).toBeVisible();
      await expect(page.getByTestId('manage-servers')).toHaveCount(0);

      // The page behind the hidden link still answers, so a bookmark or a
      // link someone pasted in Discord is not a 404.
      await page.goto('/servers');
      await expect(page).toHaveURL(/\/servers$/);
    }
  );
});
