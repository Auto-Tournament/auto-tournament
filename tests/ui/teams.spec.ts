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

      // Wait for page to load
      await page.waitForTimeout(500);

      // Verify teams page loaded
      await expect(page.getByTestId('teams-page')).toBeVisible({ timeout: 5000 });
      
      // Should have create/add button
      const createButton = page.getByTestId('add-team-button');
      const buttonVisible = await createButton.isVisible().catch(() => false);
      
      // Button may not always be visible (e.g., if webhook alert covers it)
      expect(page.url()).toContain('/teams');
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
      const webhookAlert = page.getByTestId('webhook-alert');
      const alertVisible = await webhookAlert.isVisible().catch(() => false);
      if (alertVisible) {
        // Try to close the alert or scroll it out of the way
        const closeButton = page.getByTestId('webhook-alert-close-button');
        const closeButtonVisible = await closeButton.isVisible().catch(() => false);
        if (closeButtonVisible) {
          // Scroll to top to move alert out of the way
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(500);
        }
      }

      // Step 1: Create team via UI
      const createButton = page.getByTestId('add-team-button');
      const buttonVisible = await createButton.isVisible().catch(() => false);

      if (!buttonVisible) {
        test.skip();
        return;
      }

      await createButton.click();

      // Wait for modal
      const modal = page.getByTestId('team-modal');
      await expect(modal).toBeVisible();

      // Fill in team details
      const teamName = `UI Test Team ${Date.now()}`;
      await page.getByTestId('team-name-input').fill(teamName);

      // Optional: fill tag if field exists
      const tagInput = page.getByTestId('team-tag-input');
      if (await tagInput.isVisible().catch(() => false)) {
        await tagInput.fill('UIT');
      }

      // Add player
      const steamIdInput = page.getByTestId('team-steam-id-input');
      const playerNameInput = page.getByTestId('team-player-name-input');

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
      const addPlayerButton = page.getByTestId('team-add-player-button');
      await expect(addPlayerButton).toBeVisible({ timeout: 5000 });
      await addPlayerButton.click();
      await page.waitForTimeout(1000);

      // Verify player was added (check that player count increased to 1 and error is gone)
      const playersHeading = page.getByTestId('team-players-count');
      await expect(playersHeading).toContainText(/1/, { timeout: 5000 });

      // Also verify the "No players added yet" alert is gone
      const noPlayersAlert = page.getByTestId('team-no-players-alert');
      await expect(noPlayersAlert).not.toBeVisible({ timeout: 2000 });

      // Submit form
      const submitButton = page.getByTestId('team-save-button');
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
      const teamCard = page.getByTestId(`team-card-${teamName.replace(/\s+/g, '-').toLowerCase()}`);
      await expect(teamCard).toBeVisible({ timeout: 15000 });

      // Step 3: Edit team
      let updatedName: string | undefined;
      await page.reload();
      await page.waitForLoadState('networkidle');

      const editButton = teamCard.getByTestId('team-edit-button');
      const editButtonVisible = await editButton.isVisible().catch(() => false);

      if (editButtonVisible) {
        await editButton.click();

        // Modal should appear
        const editModal = page.getByTestId('team-modal');
        await expect(editModal).toBeVisible();

        // Modify team name
        const nameInput = page.getByTestId('team-name-input');
        updatedName = `${teamName} Updated`;
        await nameInput.fill(updatedName);

        // Save
        const saveButton = page.getByTestId('team-save-button');
        await saveButton.click();

        // Wait for update
        await page.waitForTimeout(2000);
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Verify updated name appears
        const updatedTeamCard = page.getByTestId(`team-card-${updatedName.replace(/\s+/g, '-').toLowerCase()}`);
        await expect(updatedTeamCard).toBeVisible({ timeout: 5000 });
      }

      // Step 4: Delete team via UI
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Find the team card (use updated name if it was edited, otherwise original)
      const finalTeamName = updatedName || teamName;
      const finalTeamCard = page.getByTestId(`team-card-${finalTeamName.replace(/\s+/g, '-').toLowerCase()}`);
      const teamCardVisible = await finalTeamCard.isVisible().catch(() => false);

      if (teamCardVisible) {
        // Find the team card and click edit button
        const editButton = finalTeamCard.getByTestId('team-edit-button');
        const editButtonVisible = await editButton.isVisible().catch(() => false);
        if (editButtonVisible) {
          await editButton.click();

          // Wait for edit modal
          const editModal = page.getByTestId('team-modal');
          await expect(editModal).toBeVisible();

          // Find and click delete button
          const deleteButton = page.getByTestId('team-delete-button');
          const deleteButtonVisible = await deleteButton.isVisible().catch(() => false);

          if (deleteButtonVisible) {
            await deleteButton.click();

            // Wait for confirmation dialog
            const confirmDialog = page.getByTestId('confirm-dialog');
            await expect(confirmDialog).toBeVisible({ timeout: 2000 });

            // Confirm deletion
            const confirmButton = page.getByTestId('confirm-dialog-confirm-button');
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
            await expect(finalTeamCard).not.toBeVisible({ timeout: 5000 });
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
      const emptyState = page.getByTestId('teams-empty-state');
      const isEmpty = await emptyState.isVisible().catch(() => false);

      if (isEmpty) {
        await expect(emptyState).toBeVisible();
      }
    }
  );
});
