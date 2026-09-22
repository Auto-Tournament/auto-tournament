import { test, expect } from '@playwright/test';
import { signInViaRequest, signInAsPlayer } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { updateTeam } from '../helpers/teams';

/**
 * Home ("/"): the signed-in player's own landing page.
 *
 * A signed-in non-admin player used to be redirected straight to their
 * player page at "/"; Home replaces that. This only exercises the "your
 * team has a match" path — a fresh Steam id is added to a real tournament's
 * team roster (the same pattern `veto-admin-player.spec.ts` uses), then that
 * id signs in as a plain player and loads "/".
 *
 * @tag ui
 * @tag home
 */

function uniqueSteamId(): string {
  return `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
}

test.describe.serial('Home', () => {
  test.setTimeout(120000);

  test(
    'a signed-in player whose team has a match sees the next-match card and their tournament',
    { tag: ['@ui', '@home'] },
    async ({ page, request }) => {
      expect(await signInViaRequest(request)).toBe(true);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'home-page',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;

      const [team1] = setup.teams;
      const steamId = uniqueSteamId();
      const updated = await updateTeam(request, team1.id, {
        players: [...team1.players, { steamId, name: 'Home Test Player' }],
      });
      expect(updated).toBeTruthy();

      // Sign in as this player on the browser's own cookie jar (gamesPrompt
      // defaults to false, so the "What do you play?" dialog stays out of
      // the way).
      expect(await signInAsPlayer(page, steamId, 'Home Test Player')).toBe(true);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('home-page')).toBeVisible({ timeout: 15000 });

      await expect(page.getByTestId('home-next-match')).toBeVisible();
      await expect(page.getByTestId('home-next-match')).toContainText(team1.name);
      await expect(page.getByTestId('home-open-match')).toHaveAttribute('href', `/team/${team1.id}`);

      await expect(page.getByTestId('home-tournaments-list')).toBeVisible();
      await expect(page.getByTestId(`home-tournament-${setup.tournament.id}`)).toBeVisible();
      await expect(page.getByTestId(`home-tournament-${setup.tournament.id}`)).toContainText(
        setup.tournament.name
      );
    }
  );
});
