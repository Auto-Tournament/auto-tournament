import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * One tournament, one place in Manage (2026-10): its id in the address
 * (`/manage/tournaments/:id/<tab>`), so a link opens the right one; the old
 * one-tournament addresses go to the tournament Manage last had open.
 *
 * @tag ui
 */

const TAGS = { tag: ['@ui', '@navigation'] };

test.describe.serial('Manage: one tournament by its address', () => {
  test.setTimeout(120000);
  let id: number;

  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      teamCount: 2,
      prefix: 'scope',
    });
    expect(setup).toBeTruthy();
    id = setup!.tournament.id;
  });

  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test('a tab of one tournament opens by its address', TAGS, async ({ page }) => {
    await page.goto(`/manage/tournaments/${id}/bracket`);
    await expect(page).toHaveURL(new RegExp(`/manage/tournaments/${id}/bracket$`));
    await expect(page.getByTestId('tournament-bar-bracket')).toHaveAttribute(
      'aria-current',
      'page',
      {
        timeout: 15000,
      }
    );
    await expect(page.getByTestId('tournament-bar-matches')).toHaveAttribute(
      'href',
      `/manage/tournaments/${id}/matches`
    );
    // The bare tournament address opens its Matches.
    await page.goto(`/manage/tournaments/${id}`);
    await expect(page).toHaveURL(new RegExp(`/manage/tournaments/${id}/matches$`));
  });

  test('the old addresses go to the tournament Manage has open', TAGS, async ({ page }) => {
    await page.goto(`/manage/tournaments/${id}/matches`);
    await expect(page.getByTestId('tournament-bar-matches')).toBeVisible({ timeout: 15000 });
    await page.goto('/manage/bracket');
    await expect(page).toHaveURL(new RegExp(`/manage/tournaments/${id}/bracket$`));
    // An old shared match link opens that match's room.
    await page.goto('/manage/matches?match=abc');
    await expect(page).toHaveURL(new RegExp(`/manage/tournaments/${id}/matches/abc$`));
    // Creating from a template is the new one's setup.
    await page.goto('/manage/tournament?template=7');
    await expect(page).toHaveURL(/\/manage\/tournaments\/new\/setup\?template=7$/);
  });

  test('an id that is not a tournament says so', TAGS, async ({ page }) => {
    await page.goto('/manage/tournaments/999999/matches');
    await expect(page.getByTestId('manage-tournament-not-found')).toBeVisible({ timeout: 15000 });
  });

  test('the rail lists the tournament being run or set up', TAGS, async ({ page }) => {
    await page.goto('/manage');
    const item = page.getByTestId(`manage-rail-tournament-${id}`);
    await expect(item).toBeVisible({ timeout: 15000 });
    await expect(item).toHaveAttribute('href', `/manage/tournaments/${id}/matches`);
  });
});
