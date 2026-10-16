import { test, expect } from '@playwright/test';
import {
  ensureSignedIn,
  impersonatePlayer,
  signInViaRequest,
  stopImpersonating,
} from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';
import { openOwnMatchRoom } from '../helpers/matchRoom';

/**
 * The match room (`/match/:slug`) is the only place a match is played from:
 * a player in it gets the steps and the veto there; everyone else gets the
 * public view; the profile and the team page only link to it.
 *
 * @tag ui
 */

const TAGS = { tag: ['@ui', '@veto'] };

test.describe.serial('Match room', () => {
  test.setTimeout(120000);

  let slug: string;
  let team1Id: string;
  let player: string;

  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: [
        'de_mirage',
        'de_inferno',
        'de_ancient',
        'de_anubis',
        'de_dust2',
        'de_vertigo',
        'de_nuke',
      ],
      teamCount: 2,
      serverCount: 1,
      prefix: 'room',
    });
    expect(setup).toBeTruthy();
    const [team1, team2] = setup!.teams;
    team1Id = team1.id;
    player = actingSteamIdFor(team1);
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    slug = match!.slug;
  });

  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test.afterEach(async ({ page }) => {
    await stopImpersonating(page.request);
  });

  test('a player in the match gets the veto in the room', TAGS, async ({ page }) => {
    expect(await impersonatePlayer(page.request, player)).toBe(true);
    const path = await openOwnMatchRoom(page);
    expect(path).toBe(`/match/${encodeURIComponent(slug)}`);
    await expect(page.getByTestId('match-room-player')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('veto-interface')).toBeVisible({ timeout: 20000 });
    const back = page.getByTestId('match-room-tournament');
    // One way back (the drafts' match room): the tournament page.
    await expect(back.getByRole('link')).toHaveCount(1);
    await expect(back.getByRole('link').first()).toHaveAttribute('href', /^\/tournament\/\d+/);
  });

  test('someone not in the match sees the room and the veto, read-only', TAGS, async ({ page }) => {
    await page.goto(`/match/${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('match-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('match-room-player')).toHaveCount(0);
    // The MatchRoom board: steps, the server state and both rosters...
    await expect(page.getByTestId('match-spectator-room')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('match-step-veto')).toHaveAttribute('aria-current', 'step');
    // ...and the veto as it happens, never their turn.
    const veto = page.getByTestId('veto-interface');
    await expect(veto).toBeVisible({ timeout: 20000 });
    await expect(veto.locator('[data-my-turn="true"]')).toHaveCount(0);
  });

  test('the profile and the team page link to the room instead', TAGS, async ({ page }) => {
    expect(await impersonatePlayer(page.request, player)).toBe(true);
    const room = `/match/${encodeURIComponent(slug)}`;

    await page.goto(`/player/${player}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('next-match-open')).toHaveAttribute('href', room, {
      timeout: 20000,
    });
    await expect(page.getByTestId('veto-interface')).toHaveCount(0);

    await page.goto(`/team/${team1Id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('next-match-open')).toHaveAttribute('href', room, {
      timeout: 20000,
    });
    await expect(page.getByTestId('veto-interface')).toHaveCount(0);
  });
});
