import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, getAuthHeader } from '../helpers/auth';
import {
  setupShuffleTournament,
  createShuffleTournament,
  registerPlayers,
  getRegisteredPlayers,
  getLeaderboard,
  getStandings,
} from '../helpers/shuffleTournament';
import { createTestPlayers, type Player } from '../helpers/players';
import { dismissSnackbars } from '../helpers/ui';

/**
 * Shuffle Tournament UI tests
 * Tests shuffle tournament functionality via browser interaction
 *
 * @tag ui
 * @tag shuffle
 * @tag tournament
 */

test.describe.serial('Shuffle Tournament UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);
    // The creation wizard is only reachable from the welcome screen, which only
    // appears when no tournament exists. Other specs leave one behind, so clear
    // it rather than depending on file order.
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test(
    'should offer shuffle as a tournament type and explain its map sequence',
    {
      tag: ['@ui', '@shuffle', '@tournament'],
    },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.waitForLoadState('networkidle');

      // /tournament opens on a welcome screen; the wizard is behind "Create New".
      await page.getByTestId('tournament-welcome-create-new').click();

      // The wizard's Next button is bottom-right, where snackbars appear.
      await dismissSnackbars(page);
      const nextButton = page.getByTestId('tournament-next-button');

      // Step 1 of 6 — Name.
      const nameInput = page.getByTestId('tournament-name-input');
      await expect(nameInput).toBeVisible({ timeout: 15000 });
      await nameInput.fill(`Shuffle UI Test ${Date.now()}`);
      await nextButton.click();

      // Step 2 — Type. Shuffle must be on offer.
      const typeSelector = page.getByTestId('tournament-type-selector');
      await expect(typeSelector).toBeVisible({ timeout: 15000 });
      await page.getByTestId('tournament-type-option-shuffle').click();
      await nextButton.click();

      // Step 3 — Format. Shuffle sets its own format, so this step just passes through.
      await nextButton.click();

      // Step 4 — Maps. Shuffle plays the pool in sequence instead of running a
      // veto, and the map step says so. That notice is the shuffle-specific
      // behaviour worth pinning down here.
      await expect(page.getByTestId('shuffle-map-sequence-field')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('tournament-map-pool-select')).toBeVisible();
    }
  );

  // Consolidated tournament UI test - verifies tournament page loads
  test('should display tournament page',
    {
      tag: ['@ui', '@shuffle', '@tournament'],
    },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.waitForLoadState('networkidle');
      
      // Verify tournament page loaded
      await expect(page.getByTestId('tournament-page')).toBeVisible({ timeout: 15000 });
      expect(page.url()).toContain('/tournament');
    }
  );
});

