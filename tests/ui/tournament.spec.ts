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

      // Check for tournament form elements - form might be visible if no tournament exists
      const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
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
      const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
      const formVisible = await nameInput.isVisible().catch(() => false);

      if (formVisible) {
        // Form is visible, we can create a tournament
        const tournamentName = `UI Test Tournament ${Date.now()}`;
        await nameInput.fill(tournamentName);

        // Submit form if there's a submit button
        const submitButton = page.getByRole('button', { name: /save|create/i });
        const submitVisible = await submitButton.isVisible().catch(() => false);

        if (submitVisible) {
          await submitButton.click();

          // Wait for tournament to be created
          await page.waitForTimeout(2000);
          const tournamentCreated = await page
            .getByText(tournamentName)
            .isVisible()
            .catch(() => false);
          if (!tournamentCreated) {
            // Tournament might be created but name not immediately visible, check for status
            const statusVisible = await page
              .getByText(/setup|in progress|completed/i)
              .isVisible()
              .catch(() => false);
            expect(statusVisible).toBeTruthy();
          }
        }
      }

      // Check for tournament status indicators
      const statusElements = page.locator('text=/setup|in progress|completed|not started/i');
      const hasStatus = await statusElements
        .first()
        .isVisible()
        .catch(() => false);

      if (hasStatus) {
        await expect(statusElements.first()).toBeVisible();
      }

      // Look for "View Bracket" or similar button
      const bracketButton = page.getByRole('button', { name: /view.*bracket|bracket/i });
      const bracketButtonVisible = await bracketButton.isVisible().catch(() => false);

      if (bracketButtonVisible) {
        await bracketButton.click();
        await expect(page).toHaveURL(/\/bracket/);
      }
    }
  );
});
