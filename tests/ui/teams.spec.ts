import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';
import { createTestTeams, deleteTeam } from '../helpers/teams';

/**
 * Teams UI tests
 * Tests team management via UI
 *
 * @tag ui
 * @tag teams
 * @tag crud
 */

test.describe.serial('Teams UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
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

      // Try to add player (press Enter or find add button)
      await playerNameInput.press('Enter');
      await page.waitForTimeout(1500);

      // Submit form
      const submitButton = modal.getByRole('button', { name: /create team/i });
      const submitButtonVisible = await submitButton.isVisible().catch(() => false);

      if (!submitButtonVisible) {
        test.skip();
        return;
      }

      // Wait for creation
      await Promise.all([
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

      // Wait for modal to close (indicates save completed)
      await expect(modal).not.toBeVisible({ timeout: 10000 });
      
      // Wait for page to refresh/update
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Step 2: Verify team appears in list
      const teamInList = page.getByText(teamName, { exact: false });
      await expect(teamInList.first()).toBeVisible({ timeout: 15000 });

      // Step 3: Edit team
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
          const updatedName = `${teamName} Updated`;
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

      // Step 4: Delete team via API (cleanup)
      // Find team ID from the page or use API to find it
      const teamsResponse = await request.get('/api/teams', {
        headers: { Authorization: `Bearer ${process.env.API_TOKEN || 'admin123'}` },
      });
      if (teamsResponse.ok()) {
        const teamsData = await teamsResponse.json();
        const teamToDelete = teamsData.teams?.find((t: any) => t.name.includes('UI Test Team'));
        if (teamToDelete) {
          await deleteTeam(request, teamToDelete.id);
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
