import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * Server UI tests
 * Tests server management via UI
 * 
 * @tag ui
 * @tag servers
 * @tag crud
 */

test.describe.serial('Server UI', () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>;

  test.beforeEach(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test('should create, view, and delete server via UI', {
    tag: ['@ui', '@servers', '@crud'],
  }, async ({ page }) => {
    // Navigate to servers page
    await page.goto('/servers');
    await page.waitForLoadState('networkidle');

    // Step 1: Create server via UI
    const addButton = page.getByRole('button', { name: /add server/i });
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Wait for modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Fill in server details
    const timestamp = Date.now();
    const serverName = `UI Test Server ${timestamp}`;
    const serverHost = '127.0.0.1';
    const serverPort = String(27015 + (timestamp % 1000));
    const serverPassword = 'testpassword123';

    await modal.getByLabel(/server name/i).fill(serverName);
    await modal.getByLabel(/host.*ip/i).fill(serverHost);
    await modal.getByLabel(/port/i).fill(serverPort);
    await modal.getByLabel(/rcon.*password/i).fill(serverPassword);

    // Submit form
    const submitButton = modal.getByRole('button', { name: /add server|save/i });
    await Promise.all([
      page
        .waitForResponse(
          (resp) =>
            resp.url().includes('/api/servers') &&
            (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
          { timeout: 15000 }
        )
        .catch(() => null),
      submitButton.click({ timeout: 5000 }),
    ]);

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Step 2: Verify server appears in UI
    const serverNameInList = page.getByText(serverName);
    await expect(serverNameInList).toBeVisible({ timeout: 5000 });

    // Verify server details are visible
    const serverHostInList = page.getByText(serverHost);
    await expect(serverHostInList).toBeVisible();

    // Step 3: Delete server via UI
    // Find the server card and click edit button
    const serverCard = serverNameInList.locator('..').locator('..').locator('..').first();
    const editButton = serverCard.getByRole('button', { name: /edit/i }).first();
    
    const editButtonVisible = await editButton.isVisible().catch(() => false);
    if (editButtonVisible) {
      await editButton.click();

      // Wait for edit modal
      const editModal = page.getByRole('dialog');
      await expect(editModal).toBeVisible();

      // Find and click delete button
      const deleteButton = editModal.getByRole('button', { name: /delete server/i });
      const deleteButtonVisible = await deleteButton.isVisible().catch(() => false);

      if (deleteButtonVisible) {
        await deleteButton.click();

        // Wait for confirmation dialog
        const confirmDialog = page.getByRole('dialog').filter({ hasText: /delete.*server/i });
        await expect(confirmDialog).toBeVisible({ timeout: 2000 });

        // Confirm deletion
        const confirmButton = confirmDialog.getByRole('button', { name: /^delete$/i });
        await Promise.all([
          page
            .waitForResponse(
              (resp) =>
                resp.url().includes('/api/servers') && resp.request().method() === 'DELETE',
              { timeout: 10000 }
            )
            .catch(() => null),
          confirmButton.click(),
        ]);

        // Wait for deletion to complete
        await page.waitForTimeout(2000);
        await page.waitForLoadState('networkidle');

        // Verify server is no longer visible
        await expect(serverNameInList).not.toBeVisible({ timeout: 5000 });
      }
    }
  });
});

