import { test, expect } from '@playwright/test';
import { signInAsPlayer } from '../helpers/auth';

/**
 * Account connections page (/me/connections).
 *
 * CI runs with no sign-in provider configured, so the connections response is
 * the real one with a configured, unlinked GitHub added: the page must show
 * Steam as the primary method and a Connect button for GitHub.
 *
 * @tag ui
 * @tag auth
 */

function uniqueSteamId(): string {
  return `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
}

test.describe('Account connections page', () => {
  test('shows Steam as primary and Connect for a configured provider', { tag: ['@ui', '@auth'] }, async ({
    page,
  }) => {
    const steamId = uniqueSteamId();
    expect(await signInAsPlayer(page, steamId)).toBe(true);

    await page.route('**/api/me/connections', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.signInMethods = [
        ...body.signInMethods.filter((m: { provider: string }) => m.provider !== 'github'),
        {
          provider: 'github',
          label: 'GitHub',
          linked: false,
          primary: false,
          linkedAt: null,
          signInEnabled: true,
          canConnect: true,
          removable: false,
        },
      ];
      await route.fulfill({ response, json: body });
    });

    // /me goes to /me/connections.
    await page.goto('/me');
    await expect(page).toHaveURL(/\/me\/connections$/);

    await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible();
    const steam = page.getByTestId('sign-in-steam');
    await expect(steam).toContainText('Steam');
    await expect(steam).toContainText('Primary');
    await expect(steam.getByRole('button', { name: 'Remove' })).toHaveCount(0);

    const github = page.getByTestId('sign-in-github');
    await expect(github).toContainText('Not connected');
    await expect(github.getByRole('button', { name: 'Connect' })).toBeVisible();

    // Game accounts come from the installed game modules: Steam for CS2.
    const gameSteam = page.getByTestId('game-account-steam');
    await expect(gameSteam).toContainText('Verified');
    await expect(gameSteam).toContainText('Counter-Strike 2');

    // The account menu links here — and the page it links to works. The menu
    // navigates client-side, so the URL is right the instant the click lands,
    // before the page has loaded anything. Stopping at the URL ended the test
    // while the page's own GET /api/me/connections was still inside the
    // route handler above, and closing the page mid-`route.fetch()` failed the
    // test: "route.fetch: Target page, context or browser has been closed".
    // Whether that request finished first was a race, so it failed about one
    // run in five. Waiting for the rows the response draws waits for the
    // request itself, and checks the destination actually renders.
    await page.goto(`/player/${steamId}`);
    await page.getByTestId('nav-avatar-button').click();
    await page.getByTestId('nav-account-connections').click();
    await expect(page).toHaveURL(/\/me\/connections$/);
    await expect(page.getByTestId('sign-in-steam')).toContainText('Primary');
    await expect(page.getByTestId('sign-in-github')).toContainText('Not connected');
  });

  test('anonymous visitors are sent to login', { tag: ['@ui', '@auth'] }, async ({ page }) => {
    await page.goto('/me/connections');
    await expect(page).toHaveURL(/\/login/);
  });
});
