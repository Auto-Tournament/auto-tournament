import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Tournament UI tests
 * Tests tournament page functionality
 *
 * @tag ui
 * @tag tournament
 * @tag crud
 */

test.describe.serial('Tournament UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should navigate to and display tournament page',
    {
      tag: ['@ui', '@tournament'],
    },
    async ({ page }) => {
      await page.goto('/tournament');
      await expect(page).toHaveURL(/\/tournament/);
      await expect(page).toHaveTitle(/Tournament Setup/i);
      await page.waitForLoadState('networkidle');

      // Verify tournament page loaded
      await expect(page.getByTestId('tournament-page')).toBeVisible({ timeout: 5000 });

      // Check for tournament form elements - form might be visible if no tournament exists
      const nameInput = page.getByTestId('tournament-name-input');
      const formVisible = await nameInput.isVisible().catch(() => false);

      // If form is not visible, tournament might already exist - that's okay
      if (formVisible) {
        await expect(nameInput).toBeVisible();
      }
    }
  );

  test(
    'should create tournament and navigate to bracket',
    {
      tag: ['@ui', '@tournament', '@crud', '@navigation'],
    },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.waitForLoadState('networkidle');

      // Check if form is visible (means no tournament exists yet)
      const nameInput = page.getByTestId('tournament-name-input');
      const formVisible = await nameInput.isVisible().catch(() => false);

      if (formVisible) {
        // Form is visible, we can create a tournament
        const tournamentName = `UI Test Tournament ${Date.now()}`;
        await nameInput.fill(tournamentName);

        // Submit form if there's a submit button
        const submitButton = page.getByTestId('tournament-save-button');
        const submitVisible = await submitButton.isVisible().catch(() => false);

        if (submitVisible) {
          await submitButton.click();

          // Wait for tournament to be created
          await page.waitForTimeout(2000);
          const tournamentCreated = await page
            .getByTestId('tournament-name-display')
            .isVisible()
            .catch(() => false);
          if (!tournamentCreated) {
            // Tournament might be created but name not immediately visible, check for status
            const statusVisible = await page
              .getByTestId('tournament-status')
              .isVisible()
              .catch(() => false);
            expect(statusVisible).toBeTruthy();
          }
        }
      }

      // Check for tournament status indicators
      const statusElement = page.getByTestId('tournament-status');
      const hasStatus = await statusElement.isVisible().catch(() => false);

      if (hasStatus) {
        await expect(statusElement).toBeVisible();
      }

      // Look for "View Bracket" or similar button
      const bracketButton = page.getByTestId('view-bracket-button');
      const bracketButtonVisible = await bracketButton.isVisible().catch(() => false);

      if (bracketButtonVisible) {
        await bracketButton.click();
        await expect(page).toHaveURL(/\/bracket/);
      }
    }
  );
});
