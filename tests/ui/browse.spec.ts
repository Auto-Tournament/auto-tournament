import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * Browse ("/browse"): every tournament this instance runs, with search and
 * filters. Public route — this suite drives it as an admin session simply
 * because that's the easiest way to also set up the tournament fixture; the
 * page itself does not require sign-in.
 *
 * The Game filter's options are a small curated list (today's tournament
 * data carries no per-tournament game id at all, so there's nothing to build
 * "games present in the list" from beyond the one CS2 tournament this
 * instance ever has) — see the comment on `GAME_FILTER_OPTIONS` in
 * `client/src/pages/Browse.tsx`.
 *
 * @tag ui
 * @tag browse
 */

test.describe.serial('Browse', () => {
  test.setTimeout(120000);

  test(
    'lists the current tournament and the Game filter hides it for a non-matching game',
    { tag: ['@ui', '@browse'] },
    async ({ page, request }) => {
      expect(await signInViaRequest(request)).toBe(true);
      expect(await signInViaRequest(page.request)).toBe(true);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'browse-page',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;

      await page.goto('/browse', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('browse-page')).toBeVisible({ timeout: 15000 });

      const row = page.getByTestId(`browse-tournament-${setup.tournament.id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(setup.tournament.name);

      // This instance's tournament is CS2; picking a different game hides it.
      await page.getByTestId('browse-filter-game').click();
      await page.getByRole('option', { name: 'Rocket League' }).click();
      await expect(row).toHaveCount(0);

      // Back to "All games" brings it back.
      await page.getByTestId('browse-filter-game').click();
      await page.getByRole('option', { name: 'All games' }).click();
      await expect(row).toBeVisible();
    }
  );
});
