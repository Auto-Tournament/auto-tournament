import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * "What do you play?" onboarding.
 *
 * A new player who lands anywhere is redirected to the full-page
 * `/welcome/games` (the intended destination preserved as `?next=`), picks a
 * game through the search (served by the fake Wikidata in routes/test.ts) and
 * through a card in the grid, saves, and lands back where they were heading.
 * There are no "Popular here" shortcuts: the page only asks what they play.
 * "Not now" dismisses without saving and does not redirect again.
 *
 * Other UI specs never see this: the test sign-in helpers mark the prompt as
 * answered unless `gamesPrompt: true` is passed.
 *
 * @tag ui
 * @tag games
 */

let counter = 0;
function uniqueSteamId(): string {
  counter += 1;
  return `7656119${String((Date.now() + counter * 7919) % 1e10).padStart(10, '0')}`;
}

test.describe('Games you play', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect((await request.post('/api/test/wikidata', { data: { fake: true } })).ok()).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/wikidata', { data: { fake: false } });
  });

  test(
    'a new player is redirected, picks a game by search and by card, and lands back where they were heading',
    { tag: ['@ui', '@games'] },
    async ({ page }) => {
      const steamId = uniqueSteamId();
      const login = await page.request.post('/api/test/login-player', {
        data: { steamId, gamesPrompt: true },
      });
      expect(login.ok(), await login.text()).toBe(true);

      await page.goto(`/player/${steamId}`);

      // Redirected to the full onboarding page, not a dialog on top of the
      // profile — the intended destination is preserved as ?next=.
      await page.waitForURL(new RegExp(`/welcome/games\\?next=${encodeURIComponent(`/player/${steamId}`)}`));
      await expect(page.getByRole('heading', { name: 'What do you play?', level: 1 })).toBeVisible();
      await expect(page.getByTestId('welcome-games-suggestions')).toHaveCount(0);

      const search = page.getByRole('combobox', { name: 'Search games' });
      await search.fill('rocket league');
      const option = page.getByRole('option', { name: /Rocket League/ });
      await expect(option).toBeVisible();
      await option.click();

      // The bar at the bottom shows each pick as its icon only: the name is
      // the chip's accessible name and its tooltip, not text on it.
      const rlChip = page.getByTestId('welcome-games-chip-rocket-league');
      await expect(rlChip).toBeVisible();
      await expect(rlChip).toHaveAttribute('aria-label', 'Rocket League');
      await expect(rlChip).not.toContainText('Rocket League');
      await rlChip.hover();
      await expect(page.getByRole('tooltip', { name: 'Rocket League' })).toBeVisible();
      await expect(search).toHaveValue('');
      // The credit is now an ExternalLink (arrow icon + visually-hidden
      // "(opens in a new tab)"), so match the visible text rather than the
      // exact node text.
      await expect(page.getByTestId('wikidata-credit')).toContainText('Game data from Wikidata');

      // Keyboard: the first result is highlighted, Enter picks it.
      await search.fill('hollow knight');
      await expect(page.getByRole('option', { name: /Hollow Knight/ })).toBeVisible();
      await search.press('Enter');
      await expect(page.getByTestId('welcome-games-chip-hollow-knight')).toBeVisible();

      // Remove one again.
      await page.getByTestId('welcome-games-chip-hollow-knight').locator('.MuiChip-deleteIcon').click();
      await expect(page.getByTestId('welcome-games-chip-hollow-knight')).toHaveCount(0);

      // Pick straight from the grid: clicking a card toggles it selected.
      const csCard = page.getByTestId('game-card-counter-strike-2');
      await expect(csCard).toHaveAttribute('aria-pressed', 'false');
      await csCard.click();
      await expect(csCard).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('welcome-games-chip-counter-strike-2')).toBeVisible();

      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/me/games') && r.request().method() === 'PUT'
        ),
        page.getByTestId('welcome-games-continue').click(),
      ]);
      expect(saved.ok()).toBe(true);

      // Continue sends the player back to where they were heading.
      await page.waitForURL(new RegExp(`/player/${steamId}$`));
      const profileGames = page.getByTestId('profile-games-section');
      await expect(profileGames.getByTestId('profile-game-rocket-league')).toBeVisible();
      await expect(profileGames.getByTestId('profile-game-counter-strike-2')).toBeVisible();

      // The prompt does not come back.
      await page.reload();
      await expect(page.getByTestId('profile-games-section')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/player/${steamId}$`));
    }
  );

  test(
    '"Not now" dismisses without saving and does not redirect again',
    { tag: ['@ui', '@games'] },
    async ({ page }) => {
      const steamId = uniqueSteamId();
      const login = await page.request.post('/api/test/login-player', {
        data: { steamId, gamesPrompt: true },
      });
      expect(login.ok(), await login.text()).toBe(true);

      await page.goto(`/player/${steamId}`);
      await page.waitForURL(/\/welcome\/games\?next=/);

      const [dismissed] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/me/games/prompt/dismiss') && r.request().method() === 'POST'
        ),
        page.getByTestId('welcome-games-not-now').click(),
      ]);
      expect(dismissed.ok()).toBe(true);

      await page.waitForURL(new RegExp(`/player/${steamId}$`));
      await expect(page.getByTestId('profile-games-section')).toBeVisible();

      // Landing anywhere again does not send the player back to onboarding.
      await page.goto(`/player/${steamId}`);
      await expect(page).toHaveURL(new RegExp(`/player/${steamId}$`));
      await expect(page.getByTestId('welcome-games-continue')).toHaveCount(0);
    }
  );
});
