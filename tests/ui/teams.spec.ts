import { test, expect } from '@playwright/test';
import { setupTestContext, configureWebhook } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';

/**
 * Teams UI tests
 *
 * Covers the full create -> edit -> delete round trip through the interface.
 *
 * The previous version guarded each stage behind
 * `if (await x.isVisible().catch(() => false))`, so a broken edit or delete
 * simply skipped and the test still reported success. Two of those guards could
 * never have been true at all: `team-edit-button`, `webhook-alert` and
 * `webhook-alert-close-button` do not exist anywhere in the client. Editing is
 * reached by clicking the team card itself, which opens the same modal.
 *
 * @tag ui
 * @tag teams
 * @tag crud
 */

/** The page slugifies team names for its card test ids. */
function teamCardId(name: string): string {
  return `team-card-${name.toLowerCase().replace(/\s+/g, '-')}`;
}

test.describe.serial('Teams UI', () => {
  test.beforeEach(async ({ page, request }) => {
    const context = await setupTestContext(page, request);
    // A missing webhook URL raises a banner that can sit over the page actions.
    await configureWebhook(request, context.baseUrl);
  });

  test(
    'should navigate to and display the teams page',
    { tag: ['@ui', '@teams'] },
    async ({ page }) => {
      await page.goto('/teams');
      await expect(page).toHaveURL(/\/teams/);
      await expect(page).toHaveTitle(/Teams/i);

      await expect(page.getByTestId('teams-page')).toBeVisible();

      // There is always a way to add a team: the header action once teams
      // exist, or the empty-state call to action when none do.
      await expect(
        page
          .getByTestId('add-team-button')
          .or(page.getByTestId('empty-state-action'))
          .first()
      ).toBeVisible();
    }
  );

  test(
    'should create, edit, and delete a team via the UI',
    { tag: ['@ui', '@teams', '@crud'] },
    async ({ page, request }) => {
      // Start from a known-empty list so the assertions below are unambiguous.
      const existing = await (await request.get('/api/teams', { headers: getAuthHeader() })).json();
      for (const team of existing.teams ?? []) {
        await request.delete(`/api/teams/${team.id}`, { headers: getAuthHeader() });
      }

      await page.goto('/teams');
      await expect(page.getByTestId('teams-page')).toBeVisible();

      // --- Create ---
      const teamName = `UI Team ${Date.now()}`;
      await page
        .getByTestId('add-team-button')
        .or(page.getByTestId('empty-state-action'))
        .first()
        .click();

      const modal = page.getByTestId('team-modal');
      await expect(modal).toBeVisible();

      await page.getByTestId('team-name-input').fill(teamName);
      await page.getByTestId('team-tag-input').fill('UIT');
      await page.getByTestId('team-steam-id-input').fill('76561198000000500');
      await page.getByTestId('team-player-name-input').fill('UI Test Player');
      await page.getByTestId('team-add-player-button').click();

      await page.getByTestId('team-save-button').click();
      await expect(modal).not.toBeVisible();

      const card = page.getByTestId(teamCardId(teamName));
      await expect(card).toBeVisible();

      // --- Edit: the card itself opens the modal; there is no edit button ---
      const updatedName = `${teamName} Updated`;
      await card.click();
      await expect(modal).toBeVisible();

      await page.getByTestId('team-name-input').fill(updatedName);
      await page.getByTestId('team-save-button').click();
      await expect(modal).not.toBeVisible();

      const updatedCard = page.getByTestId(teamCardId(updatedName));
      await expect(updatedCard).toBeVisible();
      await expect(page.getByTestId(teamCardId(teamName))).toHaveCount(0);

      // Persisted, not just re-rendered.
      const afterEdit = await (
        await request.get('/api/teams', { headers: getAuthHeader() })
      ).json();
      expect(afterEdit.teams.map((t: { name: string }) => t.name)).toContain(updatedName);

      // --- Delete ---
      await updatedCard.click();
      await expect(modal).toBeVisible();

      await page.getByTestId('team-delete-button').click();
      await page.getByTestId('confirm-dialog-confirm-button').click();

      await expect(updatedCard).toHaveCount(0);

      const afterDelete = await (
        await request.get('/api/teams', { headers: getAuthHeader() })
      ).json();
      expect(afterDelete.teams.map((t: { name: string }) => t.name)).not.toContain(updatedName);
    }
  );

  test(
    'should display the empty state when no teams exist',
    { tag: ['@ui', '@teams'] },
    async ({ page, request }) => {
      const existing = await (await request.get('/api/teams', { headers: getAuthHeader() })).json();
      for (const team of existing.teams ?? []) {
        await request.delete(`/api/teams/${team.id}`, { headers: getAuthHeader() });
      }

      await page.goto('/teams');
      await expect(page.getByTestId('teams-empty-state')).toBeVisible();
    }
  );
});
