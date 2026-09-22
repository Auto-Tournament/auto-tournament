import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * "What do you play?" UI.
 *
 * A new player gets the dialog once, picks a game through the search (served
 * by the fake IGDB in routes/test.ts), sees it as a chip, saves, and after a
 * reload the dialog stays away and the game is on their profile.
 *
 * Other UI specs never see the dialog: the test sign-in helpers mark it as
 * answered unless `gamesPrompt: true` is passed.
 *
 * @tag ui
 * @tag games
 */

function uniqueSteamId(): string {
  return `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
}

test.describe('Games you play', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const creds = await request.put('/api/settings/igdb', {
      data: { clientId: 'fake-client', clientSecret: 'fake-ui-secret' },
    });
    expect(creds.ok(), await creds.text()).toBe(true);
    expect((await request.post('/api/test/igdb', { data: { fake: true } })).ok()).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings/igdb', { data: { clientId: null } });
    await request.post('/api/test/igdb', { data: { fake: false } });
  });

  test(
    'a new player picks a game in the dialog and it sticks',
    { tag: ['@ui', '@games'] },
    async ({ page }) => {
      const steamId = uniqueSteamId();
      const login = await page.request.post('/api/test/login-player', {
        data: { steamId, gamesPrompt: true },
      });
      expect(login.ok(), await login.text()).toBe(true);

      await page.goto(`/player/${steamId}`);

      const dialog = page.getByRole('dialog', { name: 'What do you play?' });
      await expect(dialog).toBeVisible();

      const search = dialog.getByRole('combobox', { name: 'Search games' });
      await search.fill('rock');
      const option = page.getByRole('option', { name: /Rocket League/ });
      await expect(option).toBeVisible();
      await expect(page.getByRole('option', { name: /Rocket Knight Adventures/ })).toBeVisible();
      await option.click();

      await expect(dialog.getByTestId('game-chip-rocket-league')).toBeVisible();
      await expect(search).toHaveValue('');
      await expect(dialog.getByTestId('igdb-credit')).toHaveText('Game data from IGDB');

      // Keyboard: the first result is highlighted, Enter picks it.
      await search.fill('celes');
      await expect(page.getByRole('option', { name: /Celeste/ })).toBeVisible();
      await search.press('Enter');
      await expect(dialog.getByTestId('game-chip-celeste')).toBeVisible();

      // Remove one again.
      await dialog.getByTestId('game-chip-celeste').locator('.MuiChip-deleteIcon').click();
      await expect(dialog.getByTestId('game-chip-celeste')).toHaveCount(0);

      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/me/games') && r.request().method() === 'PUT'
        ),
        dialog.getByRole('button', { name: 'Save my games' }).click(),
      ]);
      expect(saved.ok()).toBe(true);
      await expect(dialog).toBeHidden();

      const profileGames = page.getByTestId('profile-games-section');
      await expect(profileGames.getByTestId('profile-game-rocket-league')).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('profile-games-section')).toBeVisible();
      await expect(page.getByTestId('profile-game-rocket-league')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'What do you play?' })).toHaveCount(0);
    }
  );
});
