import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Manage console UI tests.
 *
 * @tag ui
 * @tag manage
 */

test.describe.serial('Manage console', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;
  let matchSlug: string;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      teamCount: 2,
      serverCount: 1,
      prefix: 'manage-console',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    matchSlug = match!.slug;

    // Force the match into `needs_decision` the same way the exhausted-series
    // API spec verifies it, but directly via the test-only match-state helper
    // so this spec only exercises the Manage UI itself.
    const state = await request.post('/api/test/match-state', {
      data: { slug: matchSlug, status: 'needs_decision' },
    });
    expect(state.ok()).toBe(true);
  });

  test(
    'shows the status strip and a needs_decision match in the queue with a working Decide action',
    { tag: ['@ui', '@manage'] },
    async ({ page }) => {
      await page.goto('/manage');
      await expect(page.getByTestId('manage-page')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('manage-status-strip')).toBeVisible();

      const queue = page.getByTestId('manage-needs-you');
      await expect(queue).toBeVisible();
      await expect(queue.getByText(`${team1.name} vs ${team2.name}`, { exact: false })).toBeVisible({
        timeout: 15000,
      });

      await queue.getByRole('button', { name: /decide/i }).click();

      // The existing decide/set-winner dialog (MatchDetailsModal) opens.
      const winnerButton = page.getByRole('button', { name: `${team1.name} wins` });
      await expect(winnerButton).toBeVisible({ timeout: 10000 });
      await winnerButton.click();

      await page.getByTestId('confirm-dialog-confirm-button').click();

      await expect(page.getByText('Winner set')).toBeVisible({ timeout: 10000 });
    }
  );
});
