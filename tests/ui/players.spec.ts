import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { createPlayer, getAllPlayers } from '../helpers/players';
import { dismissSnackbars } from '../helpers/ui';

/**
 * Player Management UI tests
 *
 * The previous version wrapped each stage in
 * `if (await x.isVisible().catch(() => false))`, so creating and editing a
 * player both passed whether or not they happened. The rating test was the worst
 * of them: three nested guards, and a final assertion that only checked the
 * player still existed — its own comment conceded the rating was never verified.
 *
 * @tag ui
 * @tag players
 * @tag shuffle
 */

test.describe.serial('Player Management UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    // `page` and `request` have separate cookie jars – the API helpers below
    // use `request`, so it needs its own admin session.
    await signInViaRequest(request);
  });

  test(
    'should display the players page',
    { tag: ['@ui', '@players'] },
    async ({ page }) => {
      await page.goto('/players');
      await expect(page).toHaveURL(/\/players/);
      await expect(page.getByTestId('players-page')).toBeVisible();
    }
  );

  test(
    'should create a player via the UI',
    { tag: ['@ui', '@players', '@crud'] },
    async ({ page, request }) => {
      await page.goto('/players');
      await expect(page.getByTestId('players-page')).toBeVisible();

      await dismissSnackbars(page);
      await page
        .getByTestId('add-player-button')
        .or(page.getByTestId('empty-state-action'))
        .first()
        .click();

      const modal = page.getByTestId('player-modal');
      await expect(modal).toBeVisible();

      const timestamp = Date.now();
      const playerId = `76561198${String(timestamp).slice(-9)}`;
      const playerName = `UI Test Player ${timestamp}`;

      await page.getByTestId('player-steam-id-input').fill(playerId);
      await page.getByTestId('player-name-input').fill(playerName);
      await page.getByTestId('player-elo-input').fill('3200');

      await dismissSnackbars(page);
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/players') && resp.request().method() === 'POST',
          { timeout: 15000 }
        ),
        page.getByTestId('player-save-button').click(),
      ]);
      expect(createResponse.ok(), 'POST /api/players should succeed').toBe(true);

      const players = await getAllPlayers(request);
      const created = players?.find((p) => p.id === playerId);
      expect(created, 'created player should come back from the API').toBeTruthy();
      expect(created?.name).toBe(playerName);
      expect(created?.currentElo).toBe(3200);

      await expect(page.getByTestId(`player-card-${playerId}`)).toBeVisible();
    }
  );

  test(
    'should render seeded players in the list',
    { tag: ['@ui', '@players'] },
    async ({ page, request }) => {
      const seeded = await createPlayer(request, {
        id: '76561198000000700',
        name: 'List Render Test',
        initialELO: 1800,
      });
      expect(seeded, 'seed player should be created').toBeTruthy();

      await page.goto('/players');

      // NOTE: this deliberately does not assert the empty state. Admin rights
      // are held by a *player* row, so an authenticated admin session always has
      // at least one player and players-empty-state is unreachable here. The
      // previous `expect(hasList || hasEmptyState).toBeTruthy()` passed without
      // ever revealing that only one of its two branches could occur.
      await expect(page.getByTestId('players-list')).toBeVisible();
      await expect(page.getByTestId(`player-card-${seeded!.id}`)).toBeVisible();
    }
  );

  test(
    'should update a player Skill Rating from the UI',
    { tag: ['@ui', '@players', '@elo'] },
    async ({ page, request }) => {
      const testPlayer = await createPlayer(request, {
        id: '76561198000000701',
        name: 'Rating Edit Test',
        initialELO: 1500,
      });
      expect(testPlayer, 'test player should have been created').toBeTruthy();

      await page.goto('/players');

      const playerCard = page.getByTestId(`player-card-${testPlayer!.id}`);
      await expect(playerCard).toBeVisible();

      await dismissSnackbars(page);
      await playerCard.click();

      const modal = page.getByTestId('player-modal');
      await expect(modal).toBeVisible();

      const eloField = page.getByTestId('player-elo-input');
      await expect(eloField).toBeVisible();
      await eloField.fill('3500');

      await dismissSnackbars(page);
      await page.getByTestId('player-save-button').click();

      // Changing an existing player's rating is gated behind a confirmation
      // dialog, so the PUT only fires after it is accepted. The old test clicked
      // Save, waited two seconds and asserted nothing about the rating, so it
      // never noticed this step existed.
      const confirmEloUpdate = page.getByTestId('confirm-dialog-confirm-button');
      await expect(confirmEloUpdate).toBeVisible();

      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes(`/api/players/${testPlayer!.id}`) &&
            resp.request().method() === 'PUT',
          { timeout: 15000 }
        ),
        confirmEloUpdate.click(),
      ]);
      expect(updateResponse.ok(), 'PUT /api/players/:id should succeed').toBe(true);

      // The point of the test: the new rating actually persisted.
      await expect
        .poll(
          async () => {
            const players = await getAllPlayers(request);
            return players?.find((p) => p.id === testPlayer!.id)?.currentElo;
          },
          { message: 'skill rating to persist as 3500', timeout: 15000 }
        )
        .toBe(3500);
    }
  );
});
