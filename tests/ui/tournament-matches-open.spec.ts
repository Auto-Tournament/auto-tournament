import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * A tournament's Matches tab: a row opens its match page (the label is a
 * link too); a team name in it still opens the team.
 *
 * @tag ui
 * @tag public
 * @tag tournament
 */
test.describe('Tournament matches tab', () => {
  test('a match row opens the match page', async ({ page, request }) => {
    await setupTestContext(page, request);
    const setup = await setupTournament(request, {
      teamCount: 2,
      serverCount: 1,
      prefix: 'matches-open',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;
    const match = await findMatchByTeams(request, setup.teams[0].id, setup.teams[1].id);
    expect(match?.slug).toBeTruthy();
    const slug = match!.slug;

    await page.goto(`/tournament/${setup.tournament.id}/matches`, {
      waitUntil: 'domcontentloaded',
    });
    const row = page.getByTestId(`public-match-${slug}`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByTestId(`public-match-link-${slug}`)).toHaveAttribute(
      'href',
      `/match/${slug}`
    );
    // The middle of the row (the score), not a link.
    await row.getByText(/vs|–/).first().click();
    await expect(page).toHaveURL(new RegExp(`/match/${slug}$`), { timeout: 10000 });
  });
});
