import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createTournament } from '../helpers/tournaments';

/**
 * Saving a changed tournament asks first: the dialog lists each change with
 * its old and new value (tournamentChanges).
 *
 * @tag ui
 * @tag tournament
 */
test.describe.serial('Tournament change preview', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test(
    'a format change is listed before it saves',
    { tag: ['@ui', '@tournament'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'change-preview-ui');
      expect(teams, 'test teams should be created').toBeTruthy();
      expect(
        await createTournament(request, {
          name: `Change preview ${Date.now()}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage'],
          teamIds: teams!.map((team) => team.id),
        })
      ).toBeTruthy();

      await page.goto('/manage/tournament');
      await page.getByTestId('tournament-setup-step-format').click();
      await page.getByTestId('tournament-format-option-bo3').click();
      await page.getByTestId('tournament-setup-step-review').click();
      await page.getByTestId('tournament-save-button').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Review Tournament Changes');
      await expect(dialog).toContainText('Best of 1');
      await expect(dialog).toContainText('Best of 3');
      await dialog.getByRole('button', { name: 'Apply Changes' }).click();

      await expect
        .poll(async () => {
          const res = await request.get('/api/tournament', { headers: getAuthHeader() });
          return ((await res.json()) as { tournament?: { format?: string } }).tournament?.format;
        })
        .toBe('bo3');
    }
  );
});
