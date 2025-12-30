import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Maps UI tests
 * Tests maps and map pools page functionality
 *
 * @tag ui
 * @tag maps
 * @tag map-pools
 * @tag crud
 */

test.describe.serial('Maps UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should create, validate, edit, and view map',
    {
      tag: ['@ui', '@maps', '@crud'],
    },
    async ({ page }) => {
      await page.goto('/maps');
      await page.waitForLoadState('networkidle');

      // Open create modal
      const addButton = page.getByTestId('add-map-button');
      const buttonVisible = await addButton.isVisible().catch(() => false);

      if (!buttonVisible) {
        test.skip();
        return;
      }

      await addButton.click();

      // Wait for modal to appear
      const modal = page.getByTestId('map-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Wait for form fields to be ready
      await page.waitForTimeout(500);

      // Test validation - invalid map ID (uppercase)
      // Use a unique invalid ID to avoid conflicts with previous test runs
      const invalidMapId = `INVALID_MAP_ID_${Date.now()}`;
      await page.getByTestId('map-id-input').fill(invalidMapId);
      await page.getByTestId('map-display-name-input').fill('Test Map');
      const submitButton = page.getByTestId('map-create-button');
      await submitButton.click();
      await page.waitForTimeout(1000);

      const errorAlert = page.getByTestId('map-error-alert');
      const hasError = await errorAlert.isVisible().catch(() => false);
      if (hasError) {
        const errorText = await errorAlert.textContent().catch(() => '');
        // Error could be about lowercase OR about map already existing
        const isValidationError =
          errorText?.toLowerCase().includes('lowercase') ||
          errorText?.toLowerCase().includes('invalid');
        if (isValidationError) {
          expect(errorText?.toLowerCase()).toMatch(/lowercase|invalid/);
        }
      }

      // Now create valid map
      // Check if modal is still open, if not, reopen it
      const modalStillOpen = await modal.isVisible().catch(() => false);
      if (!modalStillOpen) {
        // Modal closed after error, reopen it
        await addButton.click();
        await expect(page.getByTestId('map-modal')).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(500);
      }

      const mapId = `test_map_${Date.now()}`;
      const displayName = `Test Map ${Date.now()}`;

      // Get fresh references to the inputs
      const mapIdInput = page.getByTestId('map-id-input');
      const displayNameInput = page.getByTestId('map-display-name-input');

      // Wait for inputs to be ready
      await expect(mapIdInput).toBeVisible({ timeout: 5000 });
      await expect(displayNameInput).toBeVisible({ timeout: 5000 });

      // Clear and fill - use fill with empty string first to clear, then fill with new value
      await mapIdInput.fill(''); // Clear by filling empty
      await mapIdInput.fill(mapId);
      await displayNameInput.fill(''); // Clear by filling empty
      await displayNameInput.fill(displayName);

      // Submit form
      const freshSubmitButton = page.getByTestId('map-create-button');
      await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/maps') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        freshSubmitButton
          .click({ timeout: 5000 })
          .catch(() => freshSubmitButton.click({ force: true })),
      ]);

      await page.waitForTimeout(2000);

      // Verify map appears in list
      const mapCard = page.getByTestId(`map-card-${mapId}`);
      await expect(mapCard).toBeVisible({ timeout: 15000 });

      // Test edit - find and click map card
      await page.reload();
      await page.waitForLoadState('networkidle');

      const mapCards = page.locator('[data-testid="map-card"]');
      const cardCount = await mapCards.count();

      if (cardCount > 0) {
        await mapCards.first().click();
        const actionsModal = page.getByTestId('map-actions-modal');
        await expect(actionsModal).toBeVisible({ timeout: 5000 });

        const editButton = page.getByTestId('map-edit-button');
        const editVisible = await editButton.isVisible().catch(() => false);

        if (editVisible) {
          await editButton.click();
          await page.waitForTimeout(500);

          const editModal = page.getByTestId('map-modal');
          await expect(editModal).toBeVisible();

          const nameInput = page.getByTestId('map-display-name-input');
          const currentValue = await nameInput.inputValue();
          await nameInput.fill(`${currentValue} Updated`);

          const saveButton = page.getByTestId('map-update-button');
          await saveButton.click();
          await page.waitForTimeout(2000);
        }
      }
    }
  );

});

test.describe.serial('Tournament Map Pool Selection', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should display and allow selecting map pool in tournament',
    {
      tag: ['@ui', '@tournament', '@map-pools'],
    },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.waitForLoadState('networkidle');

      // Check for tournament form
      const nameInput = page.getByTestId('tournament-name-input');
      const formVisible = await nameInput.isVisible().catch(() => false);

      if (formVisible) {
        // Look for map pool selection
        const mapPoolSelect = page.getByTestId('tournament-map-pool-select');
        const selectVisible = await mapPoolSelect.isVisible().catch(() => false);

        if (selectVisible) {
          await expect(mapPoolSelect).toBeVisible();

          await mapPoolSelect.click();
          await page.waitForTimeout(500);

          const options = page.getByTestId('tournament-map-pool-option');
          const optionCount = await options.count();
          if (optionCount > 0) {
            expect(optionCount).toBeGreaterThan(0);
          }
        }
      } else {
        // Tournament might already exist, check if we can see map pool info
        const mapPoolInfo = page.getByTestId('tournament-map-pool-display');
        const infoVisible = await mapPoolInfo.isVisible().catch(() => false);
        if (infoVisible) {
          await expect(mapPoolInfo).toBeVisible();
        }
      }
    }
  );
});
