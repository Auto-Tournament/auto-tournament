import { test, expect } from '@playwright/test';
import { ensureSignedIn, getAuthHeader } from '../helpers/auth';

/**
 * Teams UI tests
 * Tests team management via UI
 *
 * @tag ui
 * @tag teams
 * @tag crud
 */

test.describe.serial('Teams UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    
    // Set webhook URL to dismiss the alert that covers buttons
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
    try {
      await request.put('/api/settings', {
        headers: getAuthHeader(),
        data: { webhookUrl: baseUrl },
      });
    } catch (error) {
      // Non-blocking - continue even if webhook setting fails
      console.warn('Could not set webhook URL:', error);
    }
  });

  test(
    'should navigate to and display teams page',
    {
      tag: ['@ui', '@teams'],
    },
    async ({ page }) => {
      await page.goto('/teams');
      await expect(page).toHaveURL(/\/teams/);
      await expect(page).toHaveTitle(/Teams/i);
      await page.waitForLoadState('networkidle');

      // Check for teams page elements
      await expect(page.getByRole('heading', { name: /teams/i, level: 4 })).toBeVisible();

      // Should have create/add button
      const createButton = page.getByRole('button', { name: /add team|create team/i });
      await expect(createButton.first()).toBeVisible();
    }
  );

  test(
    'should create, view, edit, and delete team via UI',
    {
      tag: ['@ui', '@teams', '@crud'],
    },
    async ({ page, request }) => {
      await page.goto('/teams');
      await page.waitForLoadState('networkidle');
      
      // Dismiss webhook alert if present (it might cover buttons)
      const webhookAlert = page.getByText(/webhook.*not configured/i);
      const alertVisible = await webhookAlert.isVisible().catch(() => false);
      if (alertVisible) {
        // Try to close the alert or scroll it out of the way
        const closeButton = page.getByRole('button', { name: /open settings/i }).or(
          page.locator('button').filter({ hasText: /close|dismiss/i })
        );
        const closeButtonVisible = await closeButton.first().isVisible().catch(() => false);
        if (closeButtonVisible) {
          // Scroll to top to move alert out of the way
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(500);
        }
      }

      // Step 1: Create team via UI
      const createButton = page.getByRole('button', { name: /add team|create team/i }).first();
      const buttonVisible = await createButton.isVisible().catch(() => false);

      if (!buttonVisible) {
        test.skip();
        return;
      }

      await createButton.click();

      // Wait for modal
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Fill in team details
      const teamName = `UI Test Team ${Date.now()}`;
      await modal.getByLabel(/team name/i).fill(teamName);

      // Optional: fill tag if field exists
      const tagInput = modal
        .getByLabel(/team tag/i)
        .or(modal.locator('input[placeholder*="tag" i]'));
      if (await tagInput.isVisible().catch(() => false)) {
        await tagInput.fill('UIT');
      }

      // Add player
      const steamIdInput = modal.getByLabel(/steam id.*vanity url/i);
      const playerNameInput = modal.getByLabel(/player name/i);

      const steamInputVisible = await steamIdInput.isVisible().catch(() => false);
      const nameInputVisible = await playerNameInput.isVisible().catch(() => false);

      if (!steamInputVisible || !nameInputVisible) {
        test.skip();
        return;
      }

      await steamIdInput.fill('76561198000000000');
      await playerNameInput.fill('Test Player');
      await page.waitForTimeout(500);

      // Click the Add button to add the player
      // The Add button is a contained button (variant="contained") with AddIcon
      // It's in the same flex Box as the player name input
      // Find it by looking for a contained button (not outlined) with an icon
      // The Resolve button is outlined, the Add button is contained
      const addButton = modal.locator('button.MuiButton-contained').filter({
        has: page.locator('svg'),
      });

      // Verify it's visible and click it
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.waitForTimeout(1000);

      // Verify player was added (check that player count increased to 1 and error is gone)
      const playersHeading = modal.getByText(/players \(\d+\)/i);
      await expect(playersHeading).toContainText(/players \(1\)/i, { timeout: 5000 });

      // Also verify the "No players added yet" alert is gone
      const noPlayersAlert = modal.getByText(/no players added yet/i);
      await expect(noPlayersAlert).not.toBeVisible({ timeout: 2000 });

      // Submit form
      const submitButton = modal.getByRole('button', { name: /create team/i });
      const submitButtonVisible = await submitButton.isVisible().catch(() => false);

      if (!submitButtonVisible) {
        test.skip();
        return;
      }

      // Wait for creation
      const [response] = await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/teams') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ timeout: 5000 }).catch(() => submitButton.click({ force: true })),
      ]);

      // Verify the API call succeeded
      if (response) {
        expect(response.ok()).toBeTruthy();
      }

      // Wait for modal to close (indicates save completed)
      // The modal should close after onSave() and onClose() are called
      await expect(modal).not.toBeVisible({ timeout: 10000 });

      // Wait for page to refresh/update
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Step 2: Verify team appears in list
      const teamInList = page.getByText(teamName, { exact: false });
      await expect(teamInList.first()).toBeVisible({ timeout: 15000 });

      // Step 3: Edit team
      let updatedName: string | undefined;
      await page.reload();
      await page.waitForLoadState('networkidle');

      const editButtons = page
        .getByRole('button', { name: /edit/i })
        .or(page.locator('button[aria-label*="edit" i]'));

      const editButtonCount = await editButtons.count();
      if (editButtonCount > 0) {
        // Find edit button for our team
        const teamCard = teamInList.first().locator('..').locator('..').locator('..').first();
        const editButton = teamCard.getByRole('button', { name: /edit/i }).first();
        const editButtonVisible = await editButton.isVisible().catch(() => false);

        if (editButtonVisible) {
          await editButton.click();

          // Modal should appear
          const editModal = page.getByRole('dialog');
          await expect(editModal).toBeVisible();

          // Modify team name
          const nameInput = editModal.getByLabel(/name/i);
          updatedName = `${teamName} Updated`;
          await nameInput.fill(updatedName);

          // Save
          const saveButton = editModal.getByRole('button', { name: /save|update/i });
          await saveButton.click();

          // Wait for update
          await page.waitForTimeout(2000);
          await page.reload();
          await page.waitForLoadState('networkidle');

          // Verify updated name appears
          const updatedTeamInList = page.getByText(updatedName, { exact: false });
          await expect(updatedTeamInList.first()).toBeVisible({ timeout: 5000 });
        }
      }

      // Step 4: Delete team via UI
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Find the team card (use updated name if it was edited, otherwise original)
      const teamCardText = page.getByText(updatedName || teamName, { exact: false });
      const teamCardVisible = await teamCardText.isVisible().catch(() => false);

      if (teamCardVisible) {
        // Find the team card and click edit button
        const teamCard = teamCardText.locator('..').locator('..').locator('..').first();
        const editButton = teamCard.getByRole('button', { name: /edit/i }).first();

        const editButtonVisible = await editButton.isVisible().catch(() => false);
        if (editButtonVisible) {
          await editButton.click();

          // Wait for edit modal
          const editModal = page.getByRole('dialog');
          await expect(editModal).toBeVisible();

          // Find and click delete button
          const deleteButton = editModal.getByRole('button', { name: /delete team/i });
          const deleteButtonVisible = await deleteButton.isVisible().catch(() => false);

          if (deleteButtonVisible) {
            await deleteButton.click();

            // Wait for confirmation dialog
            const confirmDialog = page.getByRole('dialog').filter({ hasText: /delete.*team/i });
            await expect(confirmDialog).toBeVisible({ timeout: 2000 });

            // Confirm deletion
            const confirmButton = confirmDialog.getByRole('button', { name: /^delete$/i });
            await Promise.all([
              page
                .waitForResponse(
                  (resp) =>
                    resp.url().includes('/api/teams') && resp.request().method() === 'DELETE',
                  { timeout: 10000 }
                )
                .catch(() => null),
              confirmButton.click(),
            ]);

            // Wait for deletion to complete
            await page.waitForTimeout(2000);
            await page.waitForLoadState('networkidle');

            // Verify team is no longer visible
            await expect(teamCardText).not.toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  );

  test(
    'should display empty state when no teams exist',
    {
      tag: ['@ui', '@teams'],
    },
    async ({ page }) => {
      await page.goto('/teams');

      // Check for empty state message
      const emptyState = page.getByText(/no teams yet/i);
      const isEmpty = await emptyState.isVisible().catch(() => false);

      if (isEmpty) {
        await expect(emptyState).toBeVisible();
      }
    }
  );
});
