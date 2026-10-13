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

/** The tournament's own pages, by their tab in the tournament bar. */
const TOURNAMENT_BAR_ITEMS: [string, RegExp][] = [
  ['needsYou', /\/manage$/],
  ['matches', /\/manage\/tournaments\/(new|\d+)\/matches$/],
  ['bracket', /\/manage\/tournaments\/(new|\d+)\/bracket$/],
  ['tournament', /\/manage\/tournaments\/(new|\d+)\/setup$/],
];

/** Every platform admin page, by its rail item's test id, and the URL it opens. */
const CORE_RAIL_ITEMS: [string, RegExp][] = [
  ['tournaments', /\/tournaments$/],
  ['teams', /\/teams$/],
  ['players', /\/players$/],
  ['modules', /\/modules$/],
  ['templates', /\/templates$/],
  ['settings', /\/settings$/],
  ['adminTools', /\/manage\/system$/],
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

      // An admin who plays lands on the player Home at "/", with Manage in
      // the top bar.
      await page.goto('/');
      await expect(page.getByTestId('home-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('nav-manage')).toHaveAttribute('href', '/manage');

      // Manage is its own dashboard, with its header in place of the public
      // top bar, and no sidebar drawer.
      await page.goto('/manage');
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('top-nav')).toHaveCount(0);
      await expect(page.locator('.MuiDrawer-root')).toHaveCount(0);
      await expect(page.getByTestId('manage-back-to-site')).toHaveAttribute('href', '/');
      const rail = page.getByTestId('manage-rail');
      await expect(rail).toBeVisible({ timeout: 15000 });

      // On the public site an admin's top bar has the player's four places,
      // then Manage.
      await page.goto('/tournaments');
      await expect(page.getByTestId('nav-tournaments')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('nav-leaderboards')).toBeVisible();
      await expect(page.getByTestId('nav-community')).toBeVisible();
      await expect(page.getByTestId('nav-manage')).toHaveAttribute('href', '/manage');
      await expect(page.getByTestId('nav-admin')).toHaveCount(0);
      await page.getByTestId('nav-manage').click();
      await expect(page).toHaveURL(/\/manage$/);
      await expect(rail).toBeVisible({ timeout: 15000 });

      // The tournament's pages are tabs over them, not rail items.
      for (const [key, url] of TOURNAMENT_BAR_ITEMS) {
        const tab = page.getByTestId(`tournament-bar-${key}`);
        await expect(tab, `tournament tab ${key}`).toBeVisible({ timeout: 15000 });
        await tab.click();
        await expect(page).toHaveURL(url);
        if (key === 'tournament') {
          // With no tournament this opens the setup: its steps, under a way
          // back, are a column beside the form; the rail stays.
          await expect(page.getByTestId('tournament-setup-column')).toBeVisible({ timeout: 15000 });
          await expect(rail).toBeVisible();
          await expect(page.locator('h1'), 'one h1 on the setup').toHaveCount(1);
          await expect(page).toHaveTitle(/ · Auto Tournament$/);
          await page.getByTestId('tournament-setup-back-to-manage').click();
          await expect(page).toHaveURL(/\/manage$/);
          await expect(rail).toBeVisible({ timeout: 15000 });
          continue;
        }
        await expect(rail).toBeVisible();
        await expect(page.getByTestId(`tournament-bar-${key}`)).toHaveAttribute(
          'aria-current',
          'page'
        );
        await expect(page.locator('h1'), `one h1 on ${key}`).toHaveCount(1);
        await expect(page).toHaveTitle(/ · Auto Tournament$/);
      }

      // The rail: every page in one list, the platform's and CS2's group
      // (Games · Counter-Strike 2) together; no dropdown.
      await expect(page.getByTestId('manage-rail-group-game-cs2')).toBeVisible();
      for (const items of [CORE_RAIL_ITEMS, CS2_RAIL_ITEMS]) {
        for (const [key, url] of items) {
          const item = page.getByTestId(`manage-rail-${key}`);
          await expect(item, `rail item ${key}`).toBeVisible({ timeout: 15000 });
          await item.click();
          await expect(page).toHaveURL(url);
          // Still in the same layout, with the page it opened marked.
          await expect(rail).toBeVisible();
          await expect(page.getByTestId(`manage-rail-${key}`)).toHaveAttribute(
            'aria-current',
            'page'
          );
          // Every item has an icon (CS2's come from the module); the open
          // page's is filled.
          await expect(page.getByTestId(`manage-rail-${key}-icon`)).toHaveAttribute(
            'data-weight',
            'fill'
          );
          // The shell prints no title of its own: one H1, the page's, and the
          // tab says "Page · Auto Tournament".
          await expect(page.locator('h1'), `one h1 on ${key}`).toHaveCount(1);
          await expect(page).toHaveTitle(/ · Auto Tournament$/);
        }
      }

      // The documentation link, under System.
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
    'on a phone the rail is a menu that opens as a drawer, and the page does not scroll sideways',
    { tag: ['@ui', '@navigation'] },
    async ({ page, request }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await ensureSignedIn(page);
      expect(await signInViaRequest(request)).toBe(true);

      await page.goto('/manage');
      await expect(page.getByTestId('manage-rail')).toBeHidden({ timeout: 15000 });
      await page.getByTestId('manage-rail-open').click();
      const drawer = page.getByTestId('manage-rail-drawer');
      await expect(drawer).toBeVisible();

      // The last core item is at the bottom; it can still be reached.
      await drawer.getByTestId('manage-rail-adminTools').click();
      await expect(page).toHaveURL(/\/manage\/system$/);
      await expect(drawer).toBeHidden();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, 'the page must not scroll sideways at 375px').toBeLessThanOrEqual(0);
    }
  );

  test('a player sees no admin navigation', { tag: ['@ui', '@navigation'] }, async ({ page }) => {
    expect(await signInAsPlayer(page)).toBe(true);

    await page.goto('/');
    await expect(page.getByTestId('nav-tournaments')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('nav-manage')).toHaveCount(0);
    await expect(page.getByTestId('nav-admin')).toHaveCount(0);
    await expect(page.getByTestId('manage-rail')).toHaveCount(0);
    await expect(page.locator('a[href="/manage"]')).toHaveCount(0);
    // A player's places: Tournaments, Leaderboards, and Community for the
    // directories (the logo is Home).
    await expect(page.getByTestId('nav-tournaments')).toHaveAttribute('href', '/tournaments');
    await expect(page.getByTestId('nav-leaderboards')).toHaveAttribute('href', '/leaderboards');
    await page.getByTestId('nav-community').click();
    await expect(page.getByTestId('nav-community-teams')).toHaveAttribute(
      'href',
      '/community/teams'
    );
    await expect(page.getByTestId('nav-community-players')).toHaveAttribute(
      'href',
      '/community/players'
    );
    await page.keyboard.press('Escape');

    // Typing the address sends them to their own page, still without it.
    await page.goto('/manage');
    await expect(page).toHaveURL(/\/player\//);
    await expect(page.getByTestId('manage-rail')).toHaveCount(0);
    await expect(page.getByTestId('nav-manage')).toHaveCount(0);
  });

  test(
    'a visitor who is not signed in sees no admin navigation',
    { tag: ['@ui', '@navigation'] },
    async ({ page }) => {
      await page.goto('/tournaments');
      await expect(page.getByTestId('nav-tournaments')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('nav-manage')).toHaveCount(0);
      await expect(page.getByTestId('manage-rail')).toHaveCount(0);
    }
  );
});
