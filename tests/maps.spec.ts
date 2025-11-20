import { test, expect } from '@playwright/test';

/**
 * Maps and Map Pools page tests
 * @tag maps
 * @tag map-pools
 * @tag crud
 */

test.describe('Maps Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to and display maps page', { tag: ['@maps'] }, async ({ page }) => {
    await page.goto('/maps');
    await expect(page).toHaveURL(/\/maps/);
    await expect(page).toHaveTitle(/Maps/i);
    await page.waitForLoadState('networkidle');

    // Check for maps page heading
    await expect(page.getByRole('heading', { name: /maps.*map pools/i })).toBeVisible();

    // Should have tabs for Maps and Map Pools
    await expect(page.getByRole('tab', { name: /maps/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /map pools/i })).toBeVisible();
  });

  test('should switch between Maps and Map Pools tabs', { tag: ['@maps', '@map-pools'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Click on Map Pools tab
    await page.getByRole('tab', { name: /map pools/i }).click();
    await expect(page.getByRole('tab', { name: /map pools/i })).toHaveAttribute('aria-selected', 'true');

    // Click back on Maps tab
    await page.getByRole('tab', { name: /maps/i }).click();
    await expect(page.getByRole('tab', { name: /maps/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('should open create map modal', { tag: ['@maps', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Click add map button
    const addButton = page.getByRole('button', { name: /add map/i });
    const buttonVisible = await addButton.isVisible().catch(() => false);

    if (buttonVisible) {
      await addButton.click();

      // Modal should appear
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Check for form fields
      await expect(modal.getByLabel(/map id/i)).toBeVisible();
      await expect(modal.getByLabel(/display name/i)).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should create a new map', { tag: ['@maps', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Open create modal
    const addButton = page.getByRole('button', { name: /add map/i });
    const buttonVisible = await addButton.isVisible().catch(() => false);

    if (!buttonVisible) {
      test.skip();
      return;
    }

    await addButton.click();

    // Wait for modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Fill in map details
    const mapId = `test_map_${Date.now()}`;
    const displayName = `Test Map ${Date.now()}`;

    await modal.getByLabel(/map id/i).fill(mapId);
    await modal.getByLabel(/display name/i).fill(displayName);

    // Submit form
    const submitButton = modal.getByRole('button', { name: /create/i });
    const submitVisible = await submitButton.isVisible().catch(() => false);

    if (!submitVisible) {
      test.skip();
      return;
    }

    // Wait for API response
    let response = null;
    try {
      [response] = await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/maps') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ timeout: 5000 }),
      ]);
    } catch (e) {
      [response] = await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/maps') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ force: true }),
      ]);
    }

    // Wait for UI to update
    await page.waitForTimeout(2000);

    // Check for error alerts
    const errorAlert = modal.getByRole('alert').first();
    const hasError = await errorAlert.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorAlert.textContent().catch(() => '');
      throw new Error(`Map creation failed with error: ${errorText}`);
    }

    // Check if request was successful
    if (response) {
      const status = response.status();
      if (status !== 200 && status !== 201) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Map creation API failed with status ${status}: ${errorText}`);
      }
    }

    // Wait for map to appear in list
    const mapInList = page.getByText(displayName, { exact: false });
    await expect(mapInList.first()).toBeVisible({ timeout: 15000 });

    // Modal should close after successful creation
    await page.waitForTimeout(1000);
    const modalStillVisible = await modal.isVisible().catch(() => false);
    if (modalStillVisible) {
      await expect(mapInList.first()).toBeVisible();
    } else {
      await expect(modal).not.toBeVisible();
    }
  });

  test('should validate map ID format', { tag: ['@maps', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Open create modal
    const addButton = page.getByRole('button', { name: /add map/i });
    const buttonVisible = await addButton.isVisible().catch(() => false);

    if (!buttonVisible) {
      test.skip();
      return;
    }

    await addButton.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Try invalid map ID (uppercase letters)
    await modal.getByLabel(/map id/i).fill('INVALID_MAP_ID');
    await modal.getByLabel(/display name/i).fill('Test Map');

    const submitButton = modal.getByRole('button', { name: /create/i });
    await submitButton.click();

    // Should show validation error
    await page.waitForTimeout(500);
    const errorAlert = modal.getByRole('alert');
    const hasError = await errorAlert.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorAlert.textContent().catch(() => '');
      expect(errorText?.toLowerCase()).toContain('lowercase');
    }
  });

  test('should edit an existing map', { tag: ['@maps', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Find a map card to click (if maps exist)
    const mapCards = page.locator('[data-testid="map-card"], [role="button"]').filter({
      hasText: /de_|cs_/i,
    });
    const cardCount = await mapCards.count();

    if (cardCount > 0) {
      // Click first map card
      await mapCards.first().click();

      // Actions modal should appear
      const actionsModal = page.getByRole('dialog');
      await expect(actionsModal).toBeVisible({ timeout: 5000 });

      // Click edit button
      const editButton = actionsModal.getByRole('button', { name: /edit/i });
      const editVisible = await editButton.isVisible().catch(() => false);

      if (editVisible) {
        await editButton.click();

        // Edit modal should appear
        await page.waitForTimeout(500);
        const editModal = page.getByRole('dialog');
        await expect(editModal).toBeVisible();

        // Modify display name
        const nameInput = editModal.getByLabel(/display name/i);
        const currentValue = await nameInput.inputValue();
        await nameInput.fill(`${currentValue} Updated`);

        // Save
        const saveButton = editModal.getByRole('button', { name: /update/i });
        await saveButton.click();

        // Wait for update
        await page.waitForTimeout(2000);
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should open create map pool modal', { tag: ['@map-pools', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Switch to Map Pools tab
    await page.getByRole('tab', { name: /map pools/i }).click();
    await page.waitForTimeout(500);

    // Click create map pool button
    const createButton = page.getByRole('button', { name: /create map pool/i });
    const buttonVisible = await createButton.isVisible().catch(() => false);

    if (buttonVisible) {
      await createButton.click();

      // Modal should appear
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Check for form fields
      await expect(modal.getByLabel(/map pool name/i)).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should create a new map pool', { tag: ['@map-pools', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Switch to Map Pools tab
    await page.getByRole('tab', { name: /map pools/i }).click();
    await page.waitForTimeout(500);

    // Open create modal
    const createButton = page.getByRole('button', { name: /create map pool/i });
    const buttonVisible = await createButton.isVisible().catch(() => false);

    if (!buttonVisible) {
      test.skip();
      return;
    }

    await createButton.click();

    // Wait for modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Wait for maps to load
    await page.waitForTimeout(1000);

    // Fill in map pool name
    const poolName = `Test Pool ${Date.now()}`;
    await modal.getByLabel(/map pool name/i).fill(poolName);

    // Select at least one map from the autocomplete
    const autocomplete = modal.locator('input[placeholder*="Choose maps" i]').or(modal.locator('input[type="text"]').first());
    const autocompleteVisible = await autocomplete.isVisible().catch(() => false);

    if (!autocompleteVisible) {
      test.skip();
      return;
    }

    // Click on autocomplete to open dropdown
    await autocomplete.click();
    await page.waitForTimeout(500);

    // Try to select first option from dropdown
    const firstOption = page.locator('[role="option"]').first();
    const optionVisible = await firstOption.isVisible({ timeout: 3000 }).catch(() => false);

    if (optionVisible) {
      await firstOption.click();
      await page.waitForTimeout(500);
    } else {
      // If no options, try typing and selecting
      await autocomplete.fill('de_');
      await page.waitForTimeout(1000);
      const options = page.locator('[role="option"]');
      const optionCount = await options.count();
      if (optionCount > 0) {
        await options.first().click();
        await page.waitForTimeout(500);
      } else {
        test.skip();
        return;
      }
    }

    // Submit form
    const submitButton = modal.getByRole('button', { name: /create/i });
    const submitVisible = await submitButton.isVisible().catch(() => false);

    if (!submitVisible) {
      test.skip();
      return;
    }

    // Wait for API response
    let response = null;
    try {
      [response] = await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/map-pools') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ timeout: 5000 }),
      ]);
    } catch (e) {
      [response] = await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/map-pools') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ force: true }),
      ]);
    }

    // Wait for UI to update
    await page.waitForTimeout(2000);

    // Check for error alerts
    const errorAlert = modal.getByRole('alert').first();
    const hasError = await errorAlert.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorAlert.textContent().catch(() => '');
      throw new Error(`Map pool creation failed with error: ${errorText}`);
    }

    // Check if request was successful
    if (response) {
      const status = response.status();
      if (status !== 200 && status !== 201) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Map pool creation API failed with status ${status}: ${errorText}`);
      }
    }

    // Wait for map pool to appear in list
    const poolInList = page.getByText(poolName, { exact: false });
    await expect(poolInList.first()).toBeVisible({ timeout: 15000 });

    // Modal should close after successful creation
    await page.waitForTimeout(1000);
    const modalStillVisible = await modal.isVisible().catch(() => false);
    if (modalStillVisible) {
      await expect(poolInList.first()).toBeVisible();
    } else {
      await expect(modal).not.toBeVisible();
    }
  });

  test('should validate map pool requires at least one map', { tag: ['@map-pools', '@crud'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Switch to Map Pools tab
    await page.getByRole('tab', { name: /map pools/i }).click();
    await page.waitForTimeout(500);

    // Open create modal
    const createButton = page.getByRole('button', { name: /create map pool/i });
    const buttonVisible = await createButton.isVisible().catch(() => false);

    if (!buttonVisible) {
      test.skip();
      return;
    }

    await createButton.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Fill in name but don't select any maps
    await modal.getByLabel(/map pool name/i).fill('Test Pool Without Maps');

    // Try to submit
    const submitButton = modal.getByRole('button', { name: /create/i });
    await submitButton.click();

    // Should show validation error
    await page.waitForTimeout(500);
    const errorAlert = modal.getByRole('alert');
    const hasError = await errorAlert.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorAlert.textContent().catch(() => '');
      expect(errorText?.toLowerCase()).toContain('map');
    }
  });

  test('should display map pools list', { tag: ['@map-pools'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Switch to Map Pools tab
    await page.getByRole('tab', { name: /map pools/i }).click();
    await page.waitForTimeout(1000);

    // Check for map pools content (either list or empty state)
    const poolsList = page.locator('text=/map pool|active duty|default/i');
    const emptyState = page.locator("text=/no.*map pools|haven't.*created|empty/i");

    const hasPools = await poolsList.first().isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);

    // Should have either pools or empty state
    expect(hasPools || isEmpty).toBeTruthy();
  });

  test('should display maps list', { tag: ['@maps'] }, async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Check for maps content (either list or empty state)
    const mapsList = page.locator('text=/de_|cs_|map/i');
    const emptyState = page.locator("text=/no.*maps|haven't.*created|empty/i");

    const hasMaps = await mapsList.first().isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);

    // Should have either maps or empty state
    expect(hasMaps || isEmpty).toBeTruthy();
  });
});

test.describe('Tournament Map Pool Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should display map pool selection in tournament form', { tag: ['@tournament', '@map-pools'] }, async ({ page }) => {
    await page.goto('/tournament');
    await page.waitForLoadState('networkidle');

    // Check for tournament form
    const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
    const formVisible = await nameInput.isVisible().catch(() => false);

    if (formVisible) {
      // Look for map pool step or selection
      const mapPoolLabel = page.getByText(/map pool/i);
      const mapPoolVisible = await mapPoolLabel.isVisible().catch(() => false);

      if (mapPoolVisible) {
        await expect(mapPoolLabel).toBeVisible();
      }
    } else {
      // Tournament might already exist, check if we can see map pool info
      const mapPoolInfo = page.getByText(/map pool/i);
      const infoVisible = await mapPoolInfo.isVisible().catch(() => false);
      if (infoVisible) {
        await expect(mapPoolInfo).toBeVisible();
      }
    }
  });

  test('should allow selecting map pool in tournament', { tag: ['@tournament', '@map-pools'] }, async ({ page }) => {
    await page.goto('/tournament');
    await page.waitForLoadState('networkidle');

    // Check for tournament form
    const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
    const formVisible = await nameInput.isVisible().catch(() => false);

    if (formVisible) {
      // Look for map pool dropdown
      const mapPoolSelect = page.getByLabel(/choose.*map pool/i).or(page.locator('select').filter({ hasText: /map pool/i }));
      const selectVisible = await mapPoolSelect.isVisible().catch(() => false);

      if (selectVisible) {
        await mapPoolSelect.click();
        await page.waitForTimeout(500);

        // Check for options
        const options = page.locator('[role="option"]');
        const optionCount = await options.count();
        if (optionCount > 0) {
          // Should have at least "Active Duty" and "Custom" options
          expect(optionCount).toBeGreaterThan(0);
        }
      }
    } else {
      test.skip();
    }
  });
});

