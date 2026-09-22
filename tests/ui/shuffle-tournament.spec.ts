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
    // The creation flow only opens when no tournament exists. Other specs
    // leave one behind, so clear it rather than depending on file order.
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

      // With no tournament, /tournament opens the setup flow on its Game step.
      const nextButton = page.getByTestId('tournament-next-button');
      await expect(page.getByTestId('tournament-setup-step-game')).toHaveAttribute(
        'aria-current',
        'step'
      );
      await nextButton.click();

      // Basics — name.
      const nameInput = page.getByTestId('tournament-name-input');
      await expect(nameInput).toBeVisible({ timeout: 15000 });
      await nameInput.fill(`Shuffle UI Test ${Date.now()}`);
      await nextButton.click();

      // Format. Shuffle must be on offer, and choosing it shows its own settings.
      const typeSelector = page.getByTestId('tournament-type-selector');
      await expect(typeSelector).toBeVisible({ timeout: 15000 });
      await page.getByTestId('tournament-type-option-shuffle').click();
      await expect(page.getByTestId('tournament-type-option-shuffle')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('shuffle-team-size-field')).toBeVisible();
      await nextButton.click();

      // Teams and sign-up. Shuffle has solo sign-up, which opens once the
      // tournament exists.
      await expect(page.getByTestId('shuffle-signup-after-create')).toBeVisible();
      await nextButton.click();

      // Maps and veto. Shuffle plays the pool in sequence instead of running a
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

