import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, signInAsPlayer } from '../helpers/auth';

/**
 * One admin navigation (3.0).
 *
 * The 2.x left sidebar is gone. Admins get in from the top bar ("Manage"),
 * and the Manage rail is the admin menu, beside every admin page. These pin
 * that nothing the sidebar reached became unreachable, that the rail stays
 * put from page to page (the tournament setup excepted: it takes the rail's
 * column for its steps), and that players and visitors see no admin links.
 *
 * @tag ui
 * @tag navigation
 */

/** Every core admin page, by its rail item's test id, and the URL it opens. */
const CORE_RAIL_ITEMS: [string, RegExp][] = [
  ['needsYou', /\/manage$/],
  ['matches', /\/matches$/],
  ['bracket', /\/bracket$/],
  ['tournament', /\/tournament$/],
  ['teams', /\/teams$/],
  ['players', /\/players$/],
  ['modules', /\/modules$/],
  ['templates', /\/templates$/],
  ['ratings', /\/ratings$/],
  ['settings', /\/settings$/],
  ['adminTools', /\/admin$/],
];

/**
 * CS2's pages, which come through the module's nav items, never from core.
 * With no tournament the shell shows every installed module's pages, and CI
 * installs CS2 from the catalog.
 */
const CS2_RAIL_ITEMS: [string, RegExp][] = [
  ['servers', /\/servers$/],
  ['maps', /\/maps$/],
];

test.describe.serial('Admin navigation', () => {
  test.setTimeout(120_000);

  test(
    'an admin reaches every admin page from the rail, and the rail stays on each one',
    { tag: ['@ui', '@navigation'] },
    async ({ page, request }) => {
      await ensureSignedIn(page);
      expect(await signInViaRequest(request)).toBe(true);
      await request.delete('/api/tournament');

      // The admin home: the top bar's way in, and no sidebar anywhere.
      await page.goto('/');
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.MuiDrawer-root')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /navigation menu/i })).toHaveCount(0);

      // An admin's links: Admin, Manage, Browse. No player links.
      await expect(page.getByTestId('nav-admin')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('nav-browse')).toBeVisible();
      await expect(page.getByTestId('nav-home')).toHaveCount(0);
      await expect(page.getByTestId('nav-leaderboards')).toHaveCount(0);

      await page.getByTestId('nav-manage').click();
      await expect(page).toHaveURL(/\/manage$/);
      const rail = page.getByTestId('manage-rail');
      await expect(rail).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('nav-manage')).toHaveAttribute('aria-current', 'page');

      for (const [key, url] of [...CORE_RAIL_ITEMS, ...CS2_RAIL_ITEMS]) {
        const item = page.getByTestId(`manage-rail-${key}`);
        await expect(item, `rail item ${key}`).toBeVisible({ timeout: 15000 });
        await item.click();
        await expect(page).toHaveURL(url);
        if (key === 'tournament') {
          // With no tournament this opens the setup, which takes the page
          // over: its steps sit in the rail's column, under a way back.
          await expect(page.getByTestId('tournament-setup-column')).toBeVisible({ timeout: 15000 });
          await expect(rail).toHaveCount(0);
          await expect(page.locator('h1'), 'one h1 on the setup').toHaveCount(1);
          await expect(page).toHaveTitle(/ · Auto Tournament$/);
          await page.getByTestId('tournament-setup-back-to-manage').click();
          await expect(page).toHaveURL(/\/manage$/);
          await expect(rail).toBeVisible({ timeout: 15000 });
          continue;
        }
        // Still in the same layout, with the page it opened marked.
        await expect(rail).toBeVisible();
        await expect(page.getByTestId(`manage-rail-${key}`)).toHaveAttribute('aria-current', 'page');
        // Every item has an icon (CS2's come from the module); the open
        // page's is filled.
        await expect(page.getByTestId(`manage-rail-${key}-icon`)).toHaveAttribute('data-weight', 'fill');
        // The shell prints no title of its own: one H1, the page's, and the
        // tab says "Page · Auto Tournament".
        await expect(page.locator('h1'), `one h1 on ${key}`).toHaveCount(1);
        await expect(page).toHaveTitle(/ · Auto Tournament$/);
      }

      await expect(page.getByTestId('manage-rail-documentation-icon')).toBeVisible();
      // The sidebar's documentation link lives on in the rail.
      await expect(page.getByTestId('manage-rail-documentation')).toHaveAttribute(
        'href',
        'https://docs.autotournament.gg'
      );

      // Old addresses keep working, inside the same layout.
      await page.goto('/elo-templates');
      await expect(page).toHaveURL(/\/ratings$/);
      await expect(rail).toBeVisible({ timeout: 15000 });
    }
  );

  test(
    'on a phone the rail scrolls sideways instead of the page',
    { tag: ['@ui', '@navigation'] },
    async ({ page, request }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await ensureSignedIn(page);
      expect(await signInViaRequest(request)).toBe(true);

      await page.goto('/manage');
      await expect(page.getByTestId('manage-rail')).toBeVisible({ timeout: 15000 });

      // The last core item is off to the right; it can still be reached.
      await page.getByTestId('manage-rail-adminTools').click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByTestId('manage-rail-adminTools')).toBeInViewport();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, 'the page must not scroll sideways at 375px').toBeLessThanOrEqual(0);
    }
  );

  test(
    'a player sees no admin navigation',
    { tag: ['@ui', '@navigation'] },
    async ({ page }) => {
      expect(await signInAsPlayer(page)).toBe(true);

      await page.goto('/');
      await expect(page.getByTestId('nav-home')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('nav-manage')).toHaveCount(0);
      await expect(page.getByTestId('nav-admin')).toHaveCount(0);
      await expect(page.getByTestId('manage-rail')).toHaveCount(0);
      await expect(page.locator('a[href="/manage"]')).toHaveCount(0);
      // A player's links: Home, Browse, and the current tournament's Teams
      // and Standings tabs (never a hard-coded leaderboard).
      await expect(page.getByTestId('nav-teams')).toHaveAttribute('href', /^\/tournament\/\d+\/teams$/);
      await expect(page.getByTestId('nav-leaderboards')).toHaveAttribute(
        'href',
        /^\/tournament\/\d+\/standings$/
      );

      // Typing the address sends them to their own page, still without it.
      await page.goto('/manage');
      await expect(page).toHaveURL(/\/player\//);
      await expect(page.getByTestId('manage-rail')).toHaveCount(0);
      await expect(page.getByTestId('nav-manage')).toHaveCount(0);
    }
  );

  test(
    'a visitor who is not signed in sees no admin navigation',
    { tag: ['@ui', '@navigation'] },
    async ({ page }) => {
      await page.goto('/browse');
      await expect(page.getByTestId('nav-browse')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('nav-manage')).toHaveCount(0);
      await expect(page.getByTestId('manage-rail')).toHaveCount(0);
    }
  );
});
